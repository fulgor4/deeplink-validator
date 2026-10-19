// Hops API for the Deeplink Checker: follows every redirect of a link (HTTP redirects, meta refresh, and JavaScript-only
// pages run in headless Chrome) and returns the list of hops. It replaces redirectcheck.org for the web page.
//
// It holds NO Walmart logic: the checks, the app route tables and the wording live in ../public/js and run in the browser.
// This folder (server/) is self-contained: deploy it on its own (see Dockerfile).
//
//   GET /api/hops?url=…[&ua=ios|android|desktop]  -> { startUrl, hops:[…], finalUrl, stopped, source:"hops-api" }
//   GET /healthz                                  -> { ok:true, service:"deeplink-hops", runsJs }
//
// Environment:
//   PORT (8080)  HOST (127.0.0.1; use 0.0.0.0 in a container)
//   ALLOWED_ORIGINS    comma-separated web page origins allowed to call the API, e.g. https://gecgithub01.walmart.com
//                      (an origin is scheme://host[:port], no path). When set, requests from any other page, and requests
//                      with no browser origin at all (curl, scripts), are refused. "*" allows every origin.
//   RATE_LIMIT_PER_MIN (100) per client IP     TRUST_PROXY=1  take the client IP from X-Forwarded-For (set it when the host
//                      puts a reverse proxy / load balancer in front, which most do; otherwise all users share one limit)
//   MAX_INFLIGHT (10)  traces running at once
//   RUN_JS=0           don't run JavaScript-only pages     CHROME_PATH  browser to use     CHROME_NO_SANDBOX=1  see README
//   ALLOWLIST_ONLY=1   only follow Walmart / known-redirector hosts (default: any public host)
//   SKIP_DNS_CHECK=1|0 default: on when HTTP(S)_PROXY is set (see trace.mjs envTraceOptions)
//   SERVE_SITE=1       also serve the web page from ../public (local development; ./serve sets it)
// There is no login: put it behind your host's access control / SSO if it must not be public.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { traceRedirects, USER_AGENTS, envTraceOptions } from "./trace.mjs";
import { createJsRunner } from "./headless.mjs";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const env = process.env;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

const API_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store" };
const SITE_HEADERS = {
  ...API_HEADERS,
  "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://www.redirectcheck.org; frame-ancestors 'none'",
};

// Static files for SERVE_SITE: exactly what is in public/ at startup, nothing else, so no path is ever built from the request.
function siteFiles() {
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
  if (!existsSync(PUBLIC)) return null;
  const files = { "/": ["index.html", TYPES[".html"]] };
  (function add(rel) { // manual walk: recursive readdir needs Node 20+
    for (const e of readdirSync(path.join(PUBLIC, rel), { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) add(r);
      else if (e.isFile() && TYPES[path.extname(e.name)]) files["/" + r] = [r, TYPES[path.extname(e.name)]];
    }
  })("");
  return files;
}

/**
 * @param {object} o  test/embedding overrides: jsRunner, fetchImpl, lookup, skipDnsCheck, allowedOrigins:string[],
 *                    rateLimitPerMin, maxInflight, trustProxy, serveSite
 */
export function createServer(o = {}) {
  const { skipDnsCheck } = envTraceOptions();
  const allowedOrigins = o.allowedOrigins ?? (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  const limitPerMin = o.rateLimitPerMin ?? num(env.RATE_LIMIT_PER_MIN, 100);
  const maxInflight = o.maxInflight ?? num(env.MAX_INFLIGHT, 10);
  const trustProxy = o.trustProxy ?? env.TRUST_PROXY === "1";
  const files = (o.serveSite ?? env.SERVE_SITE === "1") ? siteFiles() : null;
  // One shared headless browser (started on first use, one private context per page).
  const jsRunner = o.jsRunner !== undefined ? o.jsRunner : env.RUN_JS === "0" ? null : createJsRunner();
  const traceOpts = { allowAnyPublic: env.ALLOWLIST_ONLY !== "1", skipDnsCheck, jsRunner };
  for (const k of ["fetchImpl", "lookup", "skipDnsCheck", "allowPrivate", "allowAnyPort"]) if (o[k] !== undefined) traceOpts[k] = o[k];

  const hits = new Map(); // ip -> timestamps in the last minute
  let inflight = 0;
  const limited = (ip) => {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    arr.push(now);
    hits.set(ip, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
    return arr.length > limitPerMin;
  };
  const clientIp = (req) => {
    if (trustProxy) { // the proxy in front appends the real client IP last; earlier entries can be forged by the client
      const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || "?";
  };
  // Which pages may call the API. Browsers always send Origin on cross-origin requests and Sec-Fetch-Site on all of them.
  // This keeps other websites (and casual scripts) out; it is not authentication, since a script can fake both headers.
  const originCheck = (req) => {
    const origin = req.headers.origin ? String(req.headers.origin).replace(/\/+$/, "") : null;
    if (!allowedOrigins.length) return { ok: true, cors: null }; // not configured: same-origin pages only (no CORS header)
    if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) return { ok: true, cors: allowedOrigins.includes("*") ? "*" : origin };
    if (!origin && req.headers["sec-fetch-site"] === "same-origin") return { ok: true, cors: null };
    return { ok: false, cors: null };
  };
  const send = (res, code, body, cors, headers = API_HEADERS) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", ...headers,
      ...(cors ? { "access-control-allow-origin": cors, vary: "Origin" } : {}) });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://x");
      if (u.pathname === "/api/hops" || u.pathname === "/healthz") {
        const oc = originCheck(req);
        if (req.method === "OPTIONS") { // not needed for a plain GET, answered for completeness
          res.writeHead(oc.ok ? 204 : 403, { ...API_HEADERS, ...(oc.cors ? { "access-control-allow-origin": oc.cors, "access-control-allow-methods": "GET", vary: "Origin" } : {}) });
          return res.end();
        }
        if (req.method !== "GET") return send(res, 405, { error: "method not allowed" }, oc.cors);
        if (u.pathname === "/healthz") return send(res, 200, { ok: true, service: "deeplink-hops", runsJs: !!(jsRunner && jsRunner.available) }, oc.cors);
        if (!oc.ok) return send(res, 403, { error: "this page is not allowed to use the API" }, null);
        if (limited(clientIp(req))) return send(res, 429, { error: "rate limit exceeded, try again in a minute" }, oc.cors);
        if (inflight >= maxInflight) return send(res, 503, { error: "busy, retry shortly" }, oc.cors);
        const target = (u.searchParams.get("url") || "").trim();
        if (!target || target.length > 8192) return send(res, 400, { error: "missing or oversized url parameter" }, oc.cors);
        const uaKey = u.searchParams.get("ua") || "ios";
        if (!Object.hasOwn(USER_AGENTS, uaKey)) return send(res, 400, { error: "ua must be ios, android or desktop" }, oc.cors);
        inflight++;
        try {
          const chain = await traceRedirects(target, { ...traceOpts, userAgent: USER_AGENTS[uaKey] });
          return send(res, 200, { ...chain, source: "hops-api" }, oc.cors);
        } finally { inflight--; }
      }
      if (req.method !== "GET") return send(res, 405, { error: "method not allowed" }, null);
      const f = files && files[u.pathname];
      if (!f) return send(res, 404, { error: "not found" }, null);
      res.writeHead(200, { "content-type": f[1], ...SITE_HEADERS });
      res.end(await readFile(path.join(PUBLIC, f[0])));
    } catch {
      send(res, 500, { error: "internal error" }, null);
    }
  });
  server.jsRunner = jsRunner;
  server.settings = { allowedOrigins, limitPerMin, maxInflight, trustProxy, servesSite: !!files };
  server.on("close", () => { if (jsRunner) jsRunner.close(); });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = num(env.PORT, 8080), HOST = env.HOST || "127.0.0.1";
  const { proxyEnv } = envTraceOptions();
  if (proxyEnv && !process.versions.bun && !env.NODE_USE_ENV_PROXY) console.log("note: a proxy is configured but Node's fetch ignores HTTP(S)_PROXY before Node 24; start with ./serve (prefers Bun) or Node >= 22.21 / 24 with NODE_USE_ENV_PROXY=1.");
  const srv = createServer();
  const stop = () => { srv.close(); if (srv.jsRunner) srv.jsRunner.close().finally(() => process.exit(0)); else process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  srv.listen(PORT, HOST, () => {
    const s = srv.settings;
    console.log(`deeplink hops API on http://${HOST}:${PORT}/api/hops  follows=${env.ALLOWLIST_ONLY === "1" ? "Walmart/known redirectors only" : "any public host"}  rate=${s.limitPerMin}/min/IP${s.trustProxy ? " (X-Forwarded-For)" : ""}  inflight<=${s.maxInflight}`);
    console.log(s.allowedOrigins.length ? `allowed pages: ${s.allowedOrigins.join(", ")}` : "allowed pages: same origin only (set ALLOWED_ORIGINS to let a page on another address, e.g. GitHub Pages, call it)");
    console.log(srv.jsRunner && srv.jsRunner.available ? `JavaScript redirect pages: run in headless ${srv.jsRunner.chromePath}`
      : "JavaScript redirect pages: not run (" + (srv.jsRunner ? "no Chrome/Chromium/Edge found; set CHROME_PATH" : "RUN_JS=0") + "); known pages are emulated, others reported as unknown");
    if (s.servesSite) console.log(`web page: http://${HOST}:${PORT}/`);
  });
}
