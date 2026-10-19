// Serves the validator page and a same-origin /trace endpoint.
//   PORT (8080)  HOST (127.0.0.1; use 0.0.0.0 in a container)
//   ALLOWED_HOSTS  comma list, supports *.example.com  (default: click2cart + walmart hosts)
//   ALLOW_ANY_PUBLIC  default ON: trace any public host (private addresses are still blocked). 0 = only ALLOWED_HOSTS
//   SKIP_DNS_CHECK=1  skip local DNS vetting (tracer behind an egress proxy that resolves names; the proxy must block internal targets)
//   RATE_LIMIT_PER_MIN (30)
// No authentication here: deploy behind your internal ingress / SSO.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { traceRedirects, DEFAULT_ALLOW } from "./trace.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const allowHosts = process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_ALLOW;
// Default: follow redirects through ANY public host (third-party redirectors are unpredictable). ALLOW_ANY_PUBLIC=0 restricts to ALLOWED_HOSTS.
const allowAnyPublic = process.env.ALLOW_ANY_PUBLIC !== "0";
const skipDnsCheck = process.env.SKIP_DNS_CHECK === "1"; // for hosts that reach the internet only via an egress proxy
const limitPerMin = Number(process.env.RATE_LIMIT_PER_MIN || 30);
const MAX_INFLIGHT = 10;

const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/core.js": ["core.js", "text/javascript; charset=utf-8"],
};
const SEC = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  "cache-control": "no-store",
};

const hits = new Map(); // ip -> timestamps
let inflight = 0;
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
  return arr.length > limitPerMin;
}
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", ...SEC });
  res.end(JSON.stringify(body));
}

export function createServer(overrides = {}) {
  return http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://x");
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
      if (u.pathname === "/healthz") return json(res, 200, { ok: true });
      if (u.pathname === "/trace") {
        const ip = req.socket.remoteAddress || "?";
        if (limited(ip)) return json(res, 429, { error: "rate limit exceeded" });
        if (inflight >= MAX_INFLIGHT) return json(res, 503, { error: "busy, retry shortly" });
        const target = u.searchParams.get("url");
        if (!target || target.length > 8192) return json(res, 400, { error: "missing or oversized url parameter" });
        inflight++;
        try {
          const result = await traceRedirects(target, { allowHosts, allowAnyPublic, skipDnsCheck, ...overrides });
          return json(res, 200, result);
        } finally { inflight--; }
      }
      const f = FILES[u.pathname];
      if (!f) return json(res, 404, { error: "not found" });
      const body = await readFile(path.join(dir, f[0]));
      res.writeHead(200, { "content-type": f[1], ...SEC });
      res.end(body);
    } catch (e) {
      json(res, 500, { error: "internal error" });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Deeplink validator on http://${HOST}:${PORT}  allow=${allowAnyPublic ? "any public" : allowHosts.join(",")}`);
  });
}
