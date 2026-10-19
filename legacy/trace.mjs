// Redirect tracer: follows HTTP redirects one hop at a time and reports every hop.
// Safe-by-default: http(s) on 80/443 only, no credentials, every hop host must be allowlisted
// (or public if allowAnyPublic), and every resolved address must be public. Headers only; bodies are never read.
import dns from "node:dns/promises";
import net from "node:net";
import core from "./core.js";

// Known redirector domains (click2cart, pgbuynow, ...) live in core.js so the validator and tracer agree.
export const DEFAULT_ALLOW = [
  ...core.KNOWN_REDIRECTORS.flatMap((d) => [d, `*.${d}`]),
  "goto.walmart.com", "goto.grocery.walmart.com",
  "walmart.com", "*.walmart.com",
];
const APP_SCHEME = /^walmart[a-z0-9]*:$/; // a redirect INTO the app; recorded, never requested
const MAX_BODY_BYTES = 64 * 1024;

// Read at most `max` bytes of a response body (then cancel). Never buffers more than that.
async function readCapped(res, max) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const dec = new TextDecoder();
  let out = "", n = 0;
  try {
    while (n < max) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      out += dec.decode(value, { stream: true });
    }
  } finally { try { await reader.cancel(); } catch { /* ignore */ } }
  return out;
}

/**
 * Static client-side redirect detection (nothing is executed): <meta http-equiv=refresh> and literal
 * location assignments. Pages often branch by platform, so ALL literal candidates are collected and the most
 * Walmart-relevant one wins (walmart:// or a walmart/goto host, then the first http(s), never intent:/javascript:/data:).
 * Returns { via, target, candidates } or null. Runtime-built URLs cannot be found.
 */
export function findClientRedirect(html) {
  const cands = [];
  for (const m of html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi)) {
    const c = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0]);
    const u = c && /url\s*=\s*['"]?([^'";]+)/i.exec(c[1] ?? c[2] ?? "");
    if (u) cands.push({ via: "meta-refresh", target: u[1].trim() });
  }
  const unesc = (x) => x.replace(/\\u0026|\\x26/g, "&").replace(/\\\//g, "/");
  for (const m of html.matchAll(/\b(?:window\.|document\.|top\.|self\.)?location(?:\.href)?\s*=\s*(?:"([^"\n]+)"|'([^'\n]+)')/g)) cands.push({ via: "javascript", target: unesc(m[1] || m[2]) });
  for (const m of html.matchAll(/\blocation\.(?:replace|assign)\(\s*(?:"([^"\n]+)"|'([^'\n]+)')\s*\)/g)) cands.push({ via: "javascript", target: unesc(m[1] || m[2]) });
  const usable = cands.filter((c) => !/^\s*(?:#|intent:|javascript:|data:|mailto:|tel:|market:|itms)/i.test(c.target));
  const wmt = (t) => {
    if (/^walmart[a-z0-9]*:/i.test(t)) return true;
    try { const h = new URL(t, "https://x.invalid").hostname; return h === "walmart.com" || h.endsWith(".walmart.com"); } catch { return false; }
  };
  const best = usable.find((c) => wmt(c.target)) || usable.find((c) => /^https?:/i.test(c.target)) || usable[0];
  return best ? { ...best, candidates: usable.map((c) => c.target) } : null;
}
export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function hostAllowed(host, patterns) {
  const h = host.toLowerCase();
  return patterns.some((p) => {
    p = p.toLowerCase();
    return p.startsWith("*.") ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p;
  });
}

export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0)
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true; // not an IP: treat as unsafe
}

async function vet(url, { allowHosts, allowAnyPublic, allowPrivate, allowAnyPort, skipDnsCheck, lookup }) {
  if (!["http:", "https:"].includes(url.protocol)) return `scheme ${url.protocol} not allowed`;
  if (url.username || url.password) return "credentials in URL not allowed";
  if (url.port && !allowAnyPort && !["80", "443"].includes(url.port)) return `port ${url.port} not allowed`;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowAnyPublic && !hostAllowed(host, allowHosts)) {
    return `host ${host} is not in the allowlist (set ALLOWED_HOSTS, or ALLOW_ANY_PUBLIC=1 for public hosts)`;
  }
  // Behind an egress proxy the proxy resolves names, so local DNS can't be vetted (or may not work at all).
  // Literal IPs are always checked. With allowAnyPublic the egress proxy must itself refuse internal destinations.
  // With any-public the proxy is the only thing guarding internal targets, so local-looking names are still refused here.
  if (skipDnsCheck && !net.isIP(host)) {
    if (allowAnyPublic && (!host.includes(".") || /(^|\.)(localhost|local|internal|localdomain|lan|home|corp)$/i.test(host))) {
      return `host ${host} looks like an internal name`;
    }
    return null;
  }
  let addrs;
  try {
    addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch (e) {
    return { dns: `DNS lookup failed: ${e.code || e.message}` };
  }
  if (!allowPrivate && addrs.some((a) => isPrivateIp(a.address))) {
    return `host ${host} resolves to a private/link-local address`;
  }
  return null;
}

/**
 * @returns {{startUrl:string, hops:object[], finalUrl:string|null, stopped:"done"|"loop"|"max-hops"|"blocked"|"error"}}
 * Each hop: { index, url, host, status, location, nextUrl, ms, server, error?, reason? }
 */
export async function traceRedirects(startUrl, opts = {}) {
  const o = {
    allowHosts: opts.allowHosts || DEFAULT_ALLOW,
    allowAnyPublic: !!opts.allowAnyPublic,
    allowPrivate: !!opts.allowPrivate, // tests only
    allowAnyPort: !!opts.allowAnyPort, // tests only
    skipDnsCheck: !!opts.skipDnsCheck,
    maxHops: opts.maxHops ?? 10,
    timeoutMs: opts.timeoutMs ?? 8000,
    userAgent: opts.userAgent || IPHONE_UA,
    lookup: opts.lookup || ((h, x) => dns.lookup(h, x)),
    fetchImpl: opts.fetchImpl || fetch,
  };
  const hops = [];
  const seen = new Set();
  let current;
  try { current = new URL(startUrl); } catch {
    return { startUrl, hops: [{ index: 0, url: startUrl, host: "", status: null, error: "Invalid URL" }], finalUrl: null, stopped: "error" };
  }

  for (let i = 0; ; i++) {
    const hop = { index: i, url: current.href, host: current.hostname.toLowerCase(), status: null };
    hops.push(hop);

    if (seen.has(current.href)) { hop.error = "Redirect loop"; return done("loop"); }
    seen.add(current.href);
    if (i >= o.maxHops) { hop.error = `Exceeded ${o.maxHops} hops`; return done("max-hops"); }

    const problem = await vet(current, o);
    if (problem) {
      if (problem.dns) { hop.error = problem.dns; return done("error"); }
      hop.reason = problem; // shown but never requested
      return done("blocked");
    }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs);
    const t0 = Date.now();
    let res;
    try {
      res = await o.fetchImpl(current.href, {
        method: "GET", redirect: "manual", signal: ctl.signal,
        headers: { "user-agent": o.userAgent, accept: "text/html,*/*;q=0.8" },
      });
    } catch (e) {
      clearTimeout(timer);
      hop.ms = Date.now() - t0;
      hop.error = e.name === "AbortError" ? `Timed out after ${o.timeoutMs}ms` : `Request failed: ${e.cause?.code || e.message}`;
      return done("error");
    }
    hop.ms = Date.now() - t0;
    hop.status = res.status;
    hop.server = res.headers.get("server") || undefined;
    const loc = res.headers.get("location");
    let next = null; // [raw target, via]
    if (REDIRECT_STATUSES.has(res.status) && loc) next = [loc, "http"];
    // Walmart's own hosts do real HTTP redirects; their inline JS is not a hop (and would only add false hops).
    else if (res.status === 200 && !/(^|\.)walmart\.com$/.test(hop.host) && /html/i.test(res.headers.get("content-type") || "")) {
      // 200 HTML: look (bounded, static) for a meta-refresh / literal location redirect.
      let found = null;
      try { found = findClientRedirect(await readCapped(res, MAX_BODY_BYTES)); } catch { /* unreadable body */ }
      if (found) { next = [found.target, found.via]; hop.via = found.via; } else hop.htmlNoRedirect = true;
    }
    clearTimeout(timer); // the same timer also bounds the capped body read above
    try { await res.body?.cancel(); } catch { /* already consumed/locked */ }
    if (!next) return done("done");
    hop.location = next[0];
    let target;
    try { target = new URL(next[0], current); } catch { hop.error = "Unparseable redirect target"; return done("error"); }
    hop.nextUrl = target.href;
    if (APP_SCHEME.test(target.protocol)) { // redirect into the app: record it as the final hop, do not request it
      hops.push({ index: i + 1, url: target.href, host: target.protocol + "//", status: null, appScheme: true });
      return done("done");
    }
    current = target;
    continue;
  }

  function done(stopped) {
    const last = hops[hops.length - 1];
    return { startUrl, hops, finalUrl: last ? last.url : null, stopped };
  }
}
