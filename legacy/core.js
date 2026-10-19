// Shared logic for the deeplink validator (browser: window.DLCore; Node/Bun: require/import).
(function (root) {
"use strict";

/* ---------- Port of glass-app URL handling (see note in page footer) ---------- */

const WALMART_SCHEME = "walmart";
const WALMART_HOSTS_STRIPPED = ["www.walmart.com", "walmart.com", "www-e16.walmart.com", "www-teflon.walmart.com"];

// UniversalLinkHost.swift hosts the router recognises as universal links.
const ROUTER_UNIVERSAL_HOSTS = new Set([
  "beta.walmart.com", "walmart.bttn.io", "goto.walmart.com", "goto.grocery.walmart.com", "mystore.walmart.com",
  "grocery.walmart.com", "walmart.onelink.me", "wmt02pay.io", "wmt03pay.io", "w-mt.co", "emlclk.walmart.com",
  "links.em.walmart.com", "rptrcks.walmart.com", "www-e16.walmart.com", "giftcards-locker.walmart.com",
  "giftcards-locker-uat.walmart.com", "www-teflon.walmart.com", "walmart.com", "www.walmart.com",
  "www.speedpassplus.info", "www.walmartpetrx.com", "affil.walmart.com"
]);
// Hosts seen as `applinks:` in the app entitlements (verified: goto.walmart.com only).
const VERIFIED_ASSOCIATED_DOMAINS = new Set(["goto.walmart.com"]);

// Third-party/campaign redirectors that are NOT app domains themselves but hand the user on to goto.walmart.com.
// Shared with trace.mjs (allowlist). Matches the domain and any subdomain.
const KNOWN_REDIRECTORS = ["click2cart.com", "pgbuynow.com"];
function redirectorFor(host) {
  const h = String(host || "").toLowerCase();
  return KNOWN_REDIRECTORS.find(d => h === d || h.endsWith("." + d)) || null;
}

function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

// Mirrors URLComponents.queryItems: split on &, first '=', percent-decode (no '+' handling).
function parseQuery(urlString) {
  const q = urlString.indexOf("?");
  if (q < 0) return [];
  let raw = urlString.slice(q + 1);
  const h = raw.indexOf("#");
  if (h >= 0) raw = raw.slice(0, h);
  const items = [];
  for (const pair of raw.split("&")) {
    if (pair === "") continue;
    const i = pair.indexOf("=");
    const name = safeDecode(i < 0 ? pair : pair.slice(0, i));
    const value = i < 0 ? null : safeDecode(pair.slice(i + 1));
    const rawValue = i < 0 ? null : pair.slice(i + 1);
    items.push({ name, value, rawValue });
  }
  return items;
}

// queryItemsDictionary: first value wins, nil values dropped.
function queryDict(items) {
  const d = new Map();
  for (const it of items) if (it.value !== null && !d.has(it.name)) d.set(it.name, it.value);
  return d;
}

// String.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
const URL_QUERY_ALLOWED = /[A-Za-z0-9\-._~!$&'()*+,;=:@\/?]/;
function percentEncodeQueryAllowed(s) {
  let out = "";
  for (const ch of Array.from(s)) {
    if (URL_QUERY_ALLOWED.test(ch)) out += ch;
    else { try { out += encodeURIComponent(ch); } catch (e) { out += "%EF%BF%BD"; } }
  }
  return out;
}

// URL.walmartSchemeURL (DeepLinkConfiguration.swift)
function walmartSchemeURL(str) {
  const m = /^([A-Za-z][A-Za-z0-9+.\-]*):/.exec(str);
  const scheme = m ? m[1] + "://" : "";
  if (scheme === WALMART_SCHEME + "://") return str;

  let path = str;
  const replaceAll = (s, a, b) => s.split(a).join(b);
  if (str.includes("walmart1h://")) {
    path = replaceAll(str, "walmart1h://", "");
  } else if (str.includes(scheme + "beta.walmart.com/")) {
    path = replaceAll(str, scheme + "beta.walmart.com/", "");
  } else if (str.includes(scheme + "www.walmart.com")) {
    path = replaceAll(str, scheme + "www.walmart.com", "");
  } else if (str.includes(scheme + "walmart.com")) {
    path = replaceAll(str, scheme + "walmart.com", "");
  } else if (str.includes(scheme + "www-e16.walmart.com")) {
    path = replaceAll(str, scheme + "www-e16.walmart.com", "");
  } else if (str.includes(scheme + "www-teflon.walmart.com")) {
    path = replaceAll(str, scheme + "www-teflon.walmart.com", "");
  }
  if (path.startsWith("/")) path = path.slice(1);
  if (path.endsWith("/")) path = path.slice(0, -1);
  return WALMART_SCHEME + "://" + path;
}

// URL.pathComponents
function pathComponents(urlString) {
  let p;
  try { p = new URL(urlString).pathname; } catch (e) { return []; }
  if (p === "") return [];
  return ["/"].concat(p.split("/").filter(Boolean));
}

// ImpactLink (Modules/TenantConfigurations/usa/.../ImpactLink.swift)
// Note: Swift iterates a Dictionary (unspecified order) for the filtered components; insertion order is used here.
class ImpactLink {
  constructor(urlString) {
    this.urlString0 = urlString;
    this.items = parseQuery(urlString);
    this.query = queryDict(this.items);
    if (!this.query.has("u")) { this.valid = false; return; }
    this.valid = true;
    this.urlString = this.query.get("u");
    this.uAfterOneDecode = this.urlString;
  }
  filtered() {
    const out = [];
    for (const [k, v] of this.query) if (!["u", "storeId", "items", "recipeIds"].includes(k)) out.push([k, v]);
    return out;
  }
  partnerId() {
    const pc = pathComponents(this.urlString0);
    return pc.length > 2 ? "wmlspartner=" + pc[2] : "";
  }
  updateUniversalLink() {
    const routes = ["/cart/0/2", "/cart/addToCart", "/cart/buynow"];
    if (routes.some(r => this.urlString.includes(r))) {
      let xRef = this.partnerId();
      for (const [k, v] of this.filtered()) {
        xRef += (this.query.size > 2 || xRef !== "") ? `;${k}=${v}` : `${k}=${v}`;
      }
      if (xRef !== "") this.urlString += "&xRef=" + xRef;
    }
    return this.urlString;
  }
  updateDeepLinkURLParameter() {
    let s = "&deepLinkURL";
    if (this.query.has("u")) s += this.urlString0.split("u=").pop();
    for (const [k, v] of this.filtered()) s += `&${k}=${v}`;
    const pid = this.partnerId();
    if (pid !== "") s += "&" + pid;
    return s;
  }
  manipulate() {
    if (!this.valid) return null;
    const impact = this.updateUniversalLink();
    const rep = (s, a, b) => s.split(a).join(b);
    let f = impact;
    f = rep(f, "affil.walmart.com", "beta.walmart.com");
    f = rep(f, "/affil/cart/addToCart", "/addToCart");
    f = rep(f, "/affil/cart/0/2", "/cart");
    f = rep(f, "/affil/cart/buynow", "/buynow");
    f = rep(f, "/sc/cart/addToCart", "/addToCart");
    f = rep(f, "/sc/cart/0/2", "/cart");
    f = rep(f, "/sc/cart/buynow", "/buynow");
    f = rep(f, "/cart/addToCart", "/addToCart");
    f = rep(f, "/cart/0/2", "/cart");
    f = rep(f, "/cart/buynow", "/buynow");
    if (f !== impact) f += this.updateDeepLinkURLParameter();
    this.afterReplace = f;
    this.urlString = percentEncodeQueryAllowed(f);
    return walmartSchemeURL(this.urlString);
  }
  manipulateGrocery() {
    if (!this.valid) return null;
    const impact = this.updateUniversalLink();
    let f = impact.replace(/(grocery|affil)\.walmart\.com/g, "beta.walmart.com/mystore").split("/cart/0/2").join("/cart");
    if (f !== impact) f += this.updateDeepLinkURLParameter();
    this.urlString = f;
    return walmartSchemeURL(f);
  }
}

/* ---------- Validation ---------- */

function check(status, title, detail, extra) { return { status, title, detail: detail || "", extra }; }

function validate(input, expectType, expectId, ctx) {
  ctx = ctx || {};
  const groups = [];
  const g = (name) => { const o = { name, checks: [] }; groups.push(o); return o.checks; };
  const url = input.trim();

  /* 1. Structure */
  const s = g("1. Link structure");
  let parsed = null;
  if (!url) { s.push(check("fail", "No URL provided")); return { groups }; }
  if (/\s/.test(url)) s.push(check("fail", "URL contains whitespace", "Likely a copy/paste line break; remove it."));
  try { parsed = new URL(url); } catch (e) { s.push(check("fail", "Not a valid absolute URL", String(e.message))); return { groups }; }
  s.push(parsed.protocol === "https:" ? check("pass", "Uses https") :
    check("warn", "Scheme is " + parsed.protocol.replace(":", ""), "Universal links only open the app for https URLs."));
  const items = parseQuery(url);
  const dups = dupes(items);
  s.push(dups.length ? check("warn", "Duplicate query parameters (outer)", dups.join(", ")) : check("pass", "No duplicate outer query parameters"));
  const empties = items.filter(i => i.value === "" ).map(i => i.name);
  if (empties.length) s.push(check("info", "Empty outer parameter values", empties.join(", ")));

  /* 2. Host */
  const h = g("2. Host & app eligibility");
  const host = parsed.hostname.toLowerCase();
  const redirector = redirectorFor(host);
  if (redirector) {
    h.push(check("warn", `${redirector} is a redirector, not an app domain`,
      "It hands the user on (usually to goto.walmart.com). Turn on “Trace redirects” so the next hops are followed and validated, or fetch the Location header yourself and validate that.",
      { curl: `curl -sI -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' '${url.replace(/'/g, "'\\''")}' | grep -i '^location'` }));
  } else {
    if (ROUTER_UNIVERSAL_HOSTS.has(host)) h.push(check("pass", "Host is recognised by the app's universal-link router", host));
    else if (ctx.traceIncomplete) h.push(check("warn", "Could not confirm where this host leads",
      host + " is not a universal-link host, but the redirect trace did not complete, so the final destination is unknown. Fix the trace (see “Redirect chain”) rather than the host."));
    else h.push(check("fail", "Host is not a universal-link host the router recognises",
      host + " (UniversalLinkHost.swift). If this link redirects on to a Walmart link, turn on “Trace redirects” (the tracer must be allowed to reach this host); otherwise the app will not rewrite it."));
    h.push(VERIFIED_ASSOCIATED_DOMAINS.has(host)
      ? check("pass", "Host is an `applinks:` associated domain in the app entitlements", host)
      : check("info", "Associated-domain status not verified", host + " is not in the list this tool verified (only goto.walmart.com). Check the entitlements and the host's apple-app-site-association file."));
  }
  const flagHits = ["gbo", "oab", "auth"].filter(k => { const v = queryDict(items).get(k); return v === "1" || v === "true"; });
  h.push(flagHits.length
    ? check("fail", "Parameters that force web / external handling", flagHits.map(k => k + "=1").join(", ") + " (routeUniversalLink / handleLinkOut).")
    : check("pass", "No gbo / oab / auth flags on the outer link"));

  const isImpact = host === "goto.walmart.com" || host === "goto.grocery.walmart.com";
  if (!isImpact) {
    if (!h.some(c => c.status === "fail")) groups.push({ name: "Further checks", checks: [check("info",
      "Only goto.walmart.com / goto.grocery.walmart.com links are analysed deeper", "Paste the Impact link to continue.")] });
    return { groups };
  }

  /* 3. Encoding */
  const e = g("3. Encoding of the u= destination");
  const impact = new ImpactLink(url);
  const rawU = items.find(i => i.name === "u");
  if (!impact.valid) {
    e.push(check("fail", "Missing u= parameter", "ImpactLink returns nil without it, so the app cannot unwrap a destination."));
    return { groups };
  }
  const once = impact.uAfterOneDecode;
  const startsUrl = /^https?:\/\//i.test(once);
  let fixed = null;
  if (startsUrl) {
    e.push(check("pass", "u= is a valid URL after exactly one decode", once));
  } else if (/^https?(%3A|%253A)/i.test(once) || /%25[0-9A-Fa-f]{2}/.test(once)) {
    const full = fullyDecode(once);
    e.push(check("fail", "u= is double-encoded",
      "After the app's single decode it is still an encoded string, so it cannot be turned into a route.",
      { show: [["After one decode (what the app sees)", once], ["Fully decoded", full]] }));
    if (/^https?:\/\//i.test(full)) {
      fixed = replaceUParam(url, full);
      e.push(check("info", "Corrected link (u= encoded once)", "", { show: [["Corrected", fixed]], copy: fixed }));
    }
  } else {
    e.push(check("fail", "u= does not decode to an http(s) URL", once));
  }
  const inner = startsUrl ? once : (fixed ? fullyDecode(once) : null);
  if (inner && /%3F|%26|%3D|%2F/i.test(inner.split("#")[0]) && startsUrl) {
    e.push(check("warn", "Destination still contains encoded separators (%3F, %26, %2F …)", "Inner query/path should use plain ? & /."));
  }

  /* 4. Destination */
  const d = g("4. Destination URL");
  let innerUrl = null;
  if (inner) { try { innerUrl = new URL(inner); } catch (er) { /* handled below */ } }
  if (!innerUrl) {
    d.push(check("fail", "Destination could not be parsed", "Fix the encoding first."));
  } else {
    const ih = innerUrl.hostname.toLowerCase();
    d.push(WALMART_HOSTS_STRIPPED.includes(ih) || ih === "beta.walmart.com" || ih === "affil.walmart.com"
      ? check("pass", "Destination host is one the app can convert to walmart://", ih)
      : check("fail", "Destination host is not converted to walmart://", ih + " would stay as an https URL and open on web."));
    const iItems = parseQuery(inner);
    const iDups = dupes(iItems);
    d.push(iDups.length ? check("warn", "Duplicate parameters in destination", iDups.join(", ") + " — which value wins depends on the consumer; keep one set.")
      : check("pass", "No duplicate parameters in destination"));
    const iEmpty = iItems.filter(i => i.value === "").map(i => i.name);
    if (iEmpty.length) d.push(check("info", "Empty values in destination", iEmpty.join(", ")));
    if (/\?&/.test(inner)) d.push(check("info", "Destination query starts with ?&", "Harmless, but usually unintended."));
    const iFlags = ["gbo", "oab", "auth"].filter(k => { const v = queryDict(iItems).get(k); return v === "1" || v === "true"; });
    if (iFlags.length) d.push(check("fail", "Destination has web-forcing flags", iFlags.map(k => k + "=1").join(", ")));
    d.push(check("info", "Parsed destination", "", { show: [["Host", ih], ["Path", innerUrl.pathname]] }));
  }

  /* 5. App simulation */
  const a = g("5. App simulation (port of ImpactLink + walmartSchemeURL)");
  const sim = new ImpactLink(url);
  const result = host === "goto.grocery.walmart.com" ? sim.manipulateGrocery() : sim.manipulate();
  a.push(check("info", "Resulting deeplink the router would try to route", "", { show: [["walmart:// URL", result || "(nil)"]] }));
  const rpath = (result || "").replace(/^walmart:\/\//, "");
  const malformed = /^https?(%3A|%253A|:)/i.test(rpath) || /%25(2F|3A)/i.test(rpath) || /%2F/i.test(rpath.split("?")[0]);
  if (!result) a.push(check("fail", "No deeplink produced"));
  else if (malformed) a.push(check("fail", "Deeplink is malformed — it embeds an encoded URL where a route path should be",
    "This is the signature of the bounce: no route matches, the router logs “CANNOT ROUTE” and opens the original goto link in Safari."));
  else a.push(check("pass", "Deeplink looks like a clean app route"));

  /* 6. Route heuristic */
  const r = g("6. Route & destination (heuristic)");
  if (result && !malformed) {
    const cleanPath = rpath.split("?")[0].split("&")[0];
    const segs = cleanPath.split("/").filter(Boolean);
    const info = classify(segs);
    r.push(info.known
      ? check("info", `Looks like a ${info.type} route`, info.note, { show: [["Path", cleanPath], ["ID", info.id || "(none)"]] })
      : check("warn", "Route not recognised by this tool's small table", "Not necessarily a failure — confirm with the canRoute log. Path: " + cleanPath));
    if (expectType) {
      const exp = expectId.trim();
      if (expectType === "path") {
        r.push(cleanPath === exp.replace(/^\/+|\/+$/g, "")
          ? check("pass", "Path matches expected", exp) : check("fail", "Path differs from expected", `expected “${exp}”, got “${cleanPath}”`));
      } else if (info.type !== expectType) {
        r.push(check("fail", "Destination type differs from expected", `expected ${expectType}, got ${info.type || "unknown"}`));
      } else if (exp) {
        r.push(info.id === exp ? check("pass", "ID matches expected", exp)
          : check("fail", "ID differs from expected", `expected ${exp}, got ${info.id || "(none)"}`));
      } else r.push(check("pass", "Type matches expected", expectType));
    }
  } else {
    r.push(check("info", "Skipped", "Fix the earlier failures first."));
  }
  return { groups, fixed };
}

function dupes(items) {
  const seen = new Map();
  for (const it of items) seen.set(it.name, (seen.get(it.name) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
}
function fullyDecode(s) {
  let prev = s, cur = safeDecode(s), n = 0;
  while (cur !== prev && n++ < 5) { prev = cur; cur = safeDecode(cur); }
  return cur;
}
function replaceUParam(url, fullyDecoded) {
  const q = url.indexOf("?");
  const base = url.slice(0, q + 1);
  const parts = url.slice(q + 1).split("&").map(p => p.startsWith("u=") ? "u=" + encodeURIComponent(fullyDecoded) : p);
  return base + parts.join("&");
}
function classify(segs) {
  if (segs[0] === "brand" && segs.length >= 2) return { known: true, type: "brand", id: segs[segs.length - 1],
    note: "App pattern is /brand/{brandId}; slugged paths (/brand/<name>/<slug>/<id>) were observed to route in-app. ID taken from the last segment." };
  if (segs[0] === "ip" && segs.length >= 2) return { known: true, type: "ip", id: segs[segs.length - 1],
    note: "Item page. Web format is /ip/<slug>/<itemId>; the app route pattern for it was not verified here." };
  if (segs[0] === "cp" && segs.length >= 2) return { known: true, type: "cp", id: segs[segs.length - 1],
    note: "App pattern /cp/{pageId}." };
  return { known: false };
}

/* ---------- Self-tests (vectors from ImpactLinkTests.swift + the logged failure) ---------- */

const LOGGED = "https://goto.walmart.com/c/2194827/568844/9383?u=https%253A%252F%252Fwww.walmart.com%252Fbrand%252Ffebreze%252Fcrisp-fall-breeze%252F20084619%253F%2526utm_source%253DMeta%2526utm_medium%253Dsocial%2526utm_campaign%253Devg_shelf%2526utm_term%253D%2526utm_content%253D%2526utm_wmc_ver%253Dpg-0c%2526utm_medium%253Dpaid%2526utm_source%253Dfb%2526utm_campaign%253D120246649283180662&subid1=c1801773-0645-44de-920b-2bc61b75b3c4&veh=aff&sourceid=imp_000011112222333344";
const TESTS = [
  { name: "Impact cart with partner id (ImpactLinkTests)", run: () => new ImpactLink("https://goto.walmart.com/c/100?u=https://affil.walmart.com/cart/0/2").manipulate(),
    expect: "walmart://cart&xRef=wmlspartner=100&deepLinkURLhttps://affil.walmart.com/cart/0/2&wmlspartner=100" },
  { name: "Impact general link (ImpactLinkTests)", run: () => new ImpactLink("https://goto.walmart.com/c/100?u=https%3A%2F%2Fwww.walmart.com%2Fgrocery").manipulate(),
    expect: "walmart://grocery" },
  { name: "Impact grocery (ImpactLinkTests)", run: () => new ImpactLink("https://goto.grocery.walmart.com/?veh=aff&u=https://affil.walmart.com/cart/0/2").manipulateGrocery(),
    expect: "walmart://mystore/cart&xRef=veh=aff&deepLinkURLhttps://affil.walmart.com/cart/0/2&veh=aff" },
  { name: "No u= returns nil (ImpactLinkTests)", run: () => new ImpactLink("https://goto.walmart.com/c/100").manipulate(), expect: null },
  { name: "Logged double-encoded link reproduces the malformed app URL", run: () => new ImpactLink(LOGGED).manipulate(),
    match: s => s.startsWith("walmart://https%253A%252F%252F%252Fbrand%252Ffebreze%252Fcrisp-fall-breeze%252F20084619%253F%2526utm_source%253DMeta") &&
      s.endsWith("%2526utm_campaign%253D120246649283180662") },
  { name: "Single-encoded brand link gives a clean route (hand-derived, not from Swift tests)",
    run: () => new ImpactLink("https://goto.walmart.com/c/2194827/568844/9383?u=" + encodeURIComponent("https://www.walmart.com/brand/febreze/crisp-fall-breeze/20084619?utm_source=fb")).manipulate(),
    expect: "walmart://brand/febreze/crisp-fall-breeze/20084619?utm_source=fb" }
];


/* ---------- Redirect-chain analysis (works on the output of trace.mjs) ---------- */

function isWalmartHost(h) { h = String(h || "").toLowerCase(); return h === "walmart.com" || h.endsWith(".walmart.com"); }
function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ""; } }

// true = u= present and still encoded after the app's single decode; false = fine; null = no u=
function isDoubleEncodedU(urlStr) {
  const u = queryDict(parseQuery(urlStr)).get("u");
  if (u == null) return null;
  return !/^https?:\/\//i.test(u) && (/^https?(%3A|%253A)/i.test(u) || /%25[0-9A-Fa-f]{2}/.test(u));
}

// Index of the first hop on a verified associated domain: the URL iOS hands to the app.
function appTakeoverIndex(hops) {
  return hops.findIndex(h => VERIFIED_ASSOCIATED_DOMAINS.has((h.host || hostOf(h.url) || "").toLowerCase()));
}

function analyzeChain(trace) {
  const hops = trace.hops || [];
  const checks = [];
  const chainText = hops.map(h => h.host || hostOf(h.url)).join(" → ");
  checks.push(check("info", `${hops.length} hop${hops.length === 1 ? "" : "s"}`, chainText));

  const last = hops[hops.length - 1];
  if (trace.stopped === "loop") checks.push(check("fail", "Redirect loop", last ? last.url : ""));
  else if (trace.stopped === "max-hops") checks.push(check("fail", "Too many redirects", "Stopped after " + hops.length + " hops."));
  else if (trace.stopped === "error" && hops.length === 1) checks.push(check("warn", "Tracer could not reach the pasted host",
    ((last && last.error) || "") + ". This usually means the tracer's network (DNS / egress proxy) cannot reach it, not that the link is broken. Check the host is reachable from where the tracer runs."));
  else if (trace.stopped === "error") checks.push(check("fail", "A hop failed", ((last && last.error) || "") +
    (/DNS lookup failed/.test((last && last.error) || "") ? ". If the tracer runs behind an egress proxy, set SKIP_DNS_CHECK=1 so the proxy resolves names." : "")));
  else if (trace.stopped === "blocked") checks.push(check("warn", "Trace stopped: next host was not fetched",
    (last && last.reason) || "Host not allowed by the tracer. The URL is shown but was not requested."));
  else if (last && last.appScheme) checks.push(check("pass", "Chain ends by launching the app",
    "The last redirect is a custom-scheme URL (" + last.url.split("?")[0] + "); it was not requested."));
  else if (last && last.status === 407) checks.push(check(isWalmartHost(last.host) ? "fail" : "warn", "Tracer's egress proxy rejected the request (HTTP 407)",
    "The proxy the tracer runs behind refused " + last.host + ". That is a problem with where the tracer runs (or a proxy allowlist), not necessarily with the link."));
  else if (last && last.status >= 400) checks.push(check("fail", `Chain ends in HTTP ${last.status} at ${last.host}`,
    "The final response is an error page, so the link is broken for web users too."));
  else checks.push(check("pass", "Chain ended normally", last ? `final status ${last.status} at ${last.host}` : ""));

  const ti = appTakeoverIndex(hops);
  const touchesWalmart = hops.some(h => ROUTER_UNIVERSAL_HOSTS.has((h.host || hostOf(h.url) || "").toLowerCase()));
  const completed = trace.stopped === "done" && last && !last.error;
  if (ti >= 0) checks.push(check("pass", `Reaches an approved Walmart deeplink at hop ${ti + 1} (${hops[ti].host})`,
    "This is the URL iOS passes to the app (see the UniversalLink INCOMING log). Validation below runs on it."));
  else if (last && last.appScheme) checks.push(check("info", "No associated-domain hop; the app is opened by a custom scheme",
    "Fine if intended, but custom schemes need the app installed and show a prompt on iOS."));
  else if (completed && last.htmlNoRedirect && !touchesWalmart) checks.push(check("warn", "Chain ended on a web page the tracer could not read a redirect from",
    `${last.host} returned a page with no static redirect. If it redirects with JavaScript that builds the URL at runtime, it cannot be followed here, so the destination is unknown.`));
  else if (completed && !touchesWalmart) checks.push(check("fail", "Never reaches an approved Walmart link",
    `The chain ended at ${last.host} (HTTP ${last.status}) without passing through any host the app handles, so tapping this link will not open the app.`));
  else checks.push(check("warn", "No associated-domain host in the chain",
    "No hop is on a verified associated domain (goto.walmart.com), so iOS has nothing to open the app with."));

  let firstBad = -1;
  for (let i = 0; i < hops.length; i++) if (isDoubleEncodedU(hops[i].url) === true) { firstBad = i; break; }
  if (firstBad === 0) checks.push(check("fail", "Double-encoded u= is already in the pasted link", hops[0].host));
  else if (firstBad > 0) checks.push(check("fail",
    `Double-encoding introduced by the redirect from ${hops[firstBad - 1].host} to ${hops[firstBad].host}`,
    `The Location header returned by ${hops[firstBad - 1].host} (HTTP ${hops[firstBad - 1].status}) contains the double-encoded u=. Hop ${firstBad} had none.`));
  else if (hops.some(h => isDoubleEncodedU(h.url) === false)) checks.push(check("pass", "No hop has a double-encoded u="));

  const flagHops = hops.filter(h => ["gbo", "oab", "auth"].some(k => { const v = queryDict(parseQuery(h.url)).get(k); return v === "1" || v === "true"; }));
  if (flagHops.length) checks.push(check("fail", "A hop carries a web-forcing flag (gbo / oab / auth)", flagHops.map(h => h.host).join(", ")));
  return { name: "0. Redirect chain", checks };
}

const api = { KNOWN_REDIRECTORS, redirectorFor, validate, ImpactLink, walmartSchemeURL, TESTS, LOGGED, analyzeChain, appTakeoverIndex, isDoubleEncodedU,
  VERIFIED_ASSOCIATED_DOMAINS, ROUTER_UNIVERSAL_HOSTS, parseQuery, queryDict, check };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.DLCore = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
