// Redirect tracer: follows HTTP redirects one hop at a time and reports every hop.
// Safe-by-default: http(s) on 80/443 only, no credentials, every hop host must be allowlisted
// (or public if allowAnyPublic), and every resolved address must be public. Headers only; bodies are never read.
import dns from "node:dns/promises";
import net from "node:net";
import { summarizeRun } from "./headless.mjs";

// Self-contained on purpose: the hops API holds no Walmart logic (checks, app routes and wording live in public/js and run in
// the browser). Keep KNOWN_REDIRECTORS in step with core.js (test/core.test.mjs checks they match).
export const KNOWN_REDIRECTORS = ["click2cart.com", "pgbuynow.com"];
export const DEFAULT_ALLOW = [
  ...KNOWN_REDIRECTORS.flatMap((d) => [d, `*.${d}`]),
  "goto.walmart.com", "goto.grocery.walmart.com",
  "walmart.com", "*.walmart.com",
];
const APP_SCHEME = /^walmart[a-z0-9]*:$/; // a redirect INTO the app; recorded, never requested
const MAX_BODY_BYTES = 256 * 1024;

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
 * Known JavaScript-only redirector pages, emulated from their own source ONLY if the page still contains the exact code we
 * modelled (fingerprint), so a changed page is reported as "unknown", never guessed. Used when no headless browser is
 * available (see headless.mjs) or it found nothing. openapp.pgbuynow.com: dest = decodeURIComponent(everything after the
 * first "url="); iPhone: hidden iframe walmart://{path}{query}, then location = dest; Android: intent://www.walmart.com/{path}{query}.
 * (core.js emulateKnownRedirector applies the same logic without the fingerprint for the redirectcheck.org fallback.)
 * Returns { dest, deeplink|null, androidIntent|null, via } or null.
 */
export function emulateKnownPage(url, html, ua) {
  if (!/(^|\.)pgbuynow\.com$/i.test(url.hostname)) return null;
  if (!html.includes("function getDestinationUrl") || !html.includes("walmart://${path}${query}") || !html.includes('validWalmartURL')) return null;
  const qs = url.search, i = qs.indexOf("url=");
  if (i < 0) return null;
  let dest, d;
  try { dest = decodeURIComponent(qs.slice(i + 4)); d = new URL(dest); } catch { return null; }
  if (!dest.includes("https://www.walmart.com/")) return null;
  const ios = /iPad|iPhone|iPod/.test(ua || ""), android = /Android/i.test(ua || "");
  return {
    via: "page JS (emulated pgbuynow)", dest,
    deeplink: ios ? `walmart://${d.pathname}${d.search}` : null,
    androidIntent: android ? `intent://www.walmart.com/${d.pathname}${d.search}` : null,
  };
}

// Evidence only: app-opening strings present in a page's JS when no redirect could be read statically.
export function pageMentions(html) {
  const hits = [];
  for (const [re, name] of [[/walmart:\/\/|walmart:\\?\/\\?\//i, "walmart://"], [/goto\.walmart\.com/i, "goto.walmart.com"], [/intent:\/\/[^"'\s]*walmart/i, "intent://…walmart"]])
    if (re.test(html)) hits.push(name);
  return hits;
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
    jsRunner: opts.jsRunner || null, // headless.mjs createJsRunner(): runs JavaScript-only redirect pages
  };
  const hops = [];
  const seen = new Set();
  let current;
  try { current = new URL(startUrl); } catch {
    return { startUrl, hops: [{ index: 0, url: startUrl, host: "", status: null, error: "Invalid URL" }], finalUrl: null, stopped: "error" };
  }

  for (let i = 0; ; i++) {
    const hop = { index: hops.length, url: current.href, host: current.hostname.toLowerCase(), status: null };
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
      let found = null, html = "";
      try { html = await readCapped(res, MAX_BODY_BYTES); found = findClientRedirect(html); } catch { /* unreadable body */ }
      clearTimeout(timer);
      try { await res.body?.cancel(); } catch { /* consumed */ }
      // No static redirect: run the page in headless Chrome (when available); else (or if it found nothing) emulate a known page.
      let scripted = null;
      if (!found && o.jsRunner && o.jsRunner.available) {
        const run = await o.jsRunner.run(current.href, o.userAgent, { vetUrl: (u) => vet(u, o) });
        const js = summarizeRun(run);
        hop.js = { ms: run.ms, error: run.error || undefined, blocked: run.blocked.length || undefined };
        if (js.app || js.next) scripted = { via: "page JS (run in headless Chrome)", appUrl: js.app && js.app.url, appKind: js.app && js.app.kind, dest: js.next && js.next.url,
          note: js.intent ? "The page also tries " + js.intent.url + " (an Android intent link)." : undefined };
        else if (!run.error) hop.jsRan = true;
      }
      if (!found && !scripted) {
        const e = emulateKnownPage(current, html, o.userAgent);
        if (e) scripted = { via: e.via, emulated: true, appUrl: e.deeplink, appKind: "iframe", dest: e.dest,
          note: e.androidIntent ? "Android: page tries " + e.androidIntent + " (not an app-opening URL by this tool's definition), then navigates to the web URL." : undefined };
      }
      if (found) { next = [found.target, found.via]; hop.via = found.via; }
      else if (scripted) {
        hop.via = scripted.via;
        if (scripted.emulated) { hop.emulated = true; delete hop.jsRan; } else hop.jsExecuted = true;
        if (scripted.note) hop.note = scripted.note;
        if (scripted.appUrl && (scripted.appKind !== "iframe" || !scripted.dest)) next = [scripted.appUrl, scripted.via]; // the page itself goes to the app
        else {
          if (scripted.appUrl) { // hidden-iframe app launch happens before the page navigates on
            hop.location = scripted.appUrl; hop.nextUrl = scripted.appUrl;
            let proto = "walmart:"; try { proto = new URL(scripted.appUrl).protocol; } catch { /* keep */ }
            hops.push({ index: hops.length, url: scripted.appUrl, host: proto + "//", status: null, appScheme: true, via: scripted.via + ", hidden iframe", fallbackUrl: scripted.dest });
          }
          hop.location = scripted.dest; hop.nextUrl = scripted.dest;
          let t2; try { t2 = new URL(scripted.dest); } catch { hop.error = "Unparseable redirect target"; return done("error"); }
          current = t2;
          continue;
        }
      } else { hop.htmlNoRedirect = true; hop.mentions = pageMentions(html); }
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

/** Proxy-aware defaults shared by the CLI and the server. Behind an egress proxy the proxy resolves names, so local DNS is skipped. */
export function envTraceOptions(env = process.env) {
  const proxyEnv = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].some((k) => env[k]);
  return { proxyEnv, skipDnsCheck: env.SKIP_DNS_CHECK ? env.SKIP_DNS_CHECK === "1" : proxyEnv };
}
export const USER_AGENTS = {
  ios: IPHONE_UA,
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
};
