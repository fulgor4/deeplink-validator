// Shared logic for the deeplink validator (browser: window.DLCore; Node/Bun: require/import).
// In the browser load app-routes-android.generated.js and app-routes.js first (where the link lands in each app).
(function (root) {
"use strict";

const ROUTES = (() => {
  try { return typeof module !== "undefined" && module.exports ? require("./app-routes.js") : root.DLRoutes || null; } catch (e) { return null; }
})();

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

// Hosts/schemes that open the Walmart app (as defined by the team): walmart://, goto.walmart.com, www.walmart.com.
// Only goto.walmart.com is a *verified* applinks: domain in the entitlements; the others are handled by the router.
const APP_OPEN_HOSTS = new Set(["goto.walmart.com", "goto.grocery.walmart.com", "www.walmart.com"]);

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
  const malformed = isMalformedRoute(result || "");
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

// A route is malformed when the path part still holds an encoded URL (the app then logs CANNOT ROUTE and bounces to web).
function isMalformedRoute(route) {
  const rpath = String(route || "").replace(/^walmart:\/\//, "");
  return /^https?(%3A|%253A|:)/i.test(rpath) || /%25(2F|3A)/i.test(rpath) || /%2F/i.test(rpath.split("?")[0]);
}
function sameOriginPath(a, b) {
  try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, ""); } catch (e) { return false; }
}

/**
 * What the app itself does with the URL that opens it (the app-opening hop), as opposed to what a web redirect does:
 * hop N is the URL iOS hands to the app, untouched. For goto links the u= value is shown as written, after the app's single
 * decode (that is all the app does), and fully decoded (what a server that decodes repeatedly produces, e.g. the next hop's URL).
 */
function buildAppView(hops, ti) {
  if (ti < 0 || !hops[ti]) return null;
  const h = hops[ti], view = { hop: ti + 1, host: h.host, appReceives: h.url, kind: "other", route: null, malformed: false, levels: [], webNext: null, webMatchesFull: null };
  const next = hops[ti + 1] && !hops[ti + 1].appScheme ? hops[ti + 1].url : null;
  if (h.appScheme) { view.kind = "scheme"; view.route = h.url; view.malformed = isMalformedRoute(h.url); return view; }
  if (/^goto(\.grocery)?\.walmart\.com$/.test(h.host)) {
    view.kind = "goto";
    const imp = new ImpactLink(h.url);
    if (!imp.valid) { view.note = "No u= parameter, so the app cannot unwrap a destination."; return view; }
    const first = parseQuery(h.url).find((i) => i.name === "u" && i.value !== null);
    const once = imp.uAfterOneDecode, full = fullyDecode(once);
    view.levels.push({ label: "u= as written in the link", value: first ? first.rawValue : once });
    view.levels.push({ label: "After the app's one decode (this is what it routes)", value: once, app: true });
    if (full !== once) view.levels.push({ label: "Fully decoded", value: full });
    const sim = new ImpactLink(h.url);
    view.route = h.host === "goto.grocery.walmart.com" ? sim.manipulateGrocery() : sim.manipulate();
    view.malformed = isMalformedRoute(view.route);
    if (next) { view.webNext = next; view.webMatchesFull = sameOriginPath(full, next); }
    return view;
  }
  // www.walmart.com & co: the router turns the https URL into a walmart:// route (approximate port of walmartSchemeURL).
  view.route = walmartSchemeURL(h.url); view.malformed = isMalformedRoute(view.route); view.approximate = true;
  return view;
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
function pathOf(u) { try { return new URL(u).pathname; } catch (e) { return ""; } }
function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ""; } }

// true = u= present and still encoded after the app's single decode; false = fine; null = no u=
function isDoubleEncodedU(urlStr) {
  const u = queryDict(parseQuery(urlStr)).get("u");
  if (u == null) return null;
  return !/^https?:\/\//i.test(u) && (/^https?(%3A|%253A)/i.test(u) || /%25[0-9A-Fa-f]{2}/.test(u));
}

// Index of the first hop that can open the app: a walmart:// redirect or an app-opening host. -1 if none.
function appTakeoverIndex(hops) {
  // Universal links only work for https, so an http:// hop on these hosts does not count (it normally redirects to https next).
  return hops.findIndex(h => h.appScheme ||
    (APP_OPEN_HOSTS.has((h.host || hostOf(h.url) || "").toLowerCase()) && (!h.url || /^https:/i.test(h.url))));
}

function analyzeChain(trace) {
  const hops = trace.hops || [];
  const checks = [];
  const chainText = hops.map(h => h.host || hostOf(h.url)).join(" → ");
  checks.push(check("info", `${hops.length} hop${hops.length === 1 ? "" : "s"}`, chainText));

  const last = hops[hops.length - 1];
  const ti = appTakeoverIndex(hops);
  if (trace.stopped === "loop") checks.push(check("fail", "Redirect loop", last ? last.url : ""));
  else if (trace.stopped === "max-hops") checks.push(check("fail", "Too many redirects", "Stopped after " + hops.length + " hops."));
  else if (trace.stopped === "error" && hops.length === 1) checks.push(check("warn", "Tracer could not reach the pasted host",
    ((last && last.error) || "") + ". This usually means the tracer's network (DNS / egress proxy) cannot reach it, not that the link is broken. Check the host is reachable from where the tracer runs."));
  else if (trace.stopped === "error" && ti >= 0 && last === hops[ti]) checks.push(check("warn", "Could not fetch the app-opening hop",
    ((last && last.error) || "") + ". The app opens at this hop, so the verdict does not depend on fetching it; this is the tracer's network (an egress proxy may block " + last.host + "), not the link."));
  else if (trace.stopped === "error") checks.push(check("fail", "A hop failed", ((last && last.error) || "") +
    (/DNS lookup failed/.test((last && last.error) || "") ? ". If the tracer runs behind an egress proxy, set SKIP_DNS_CHECK=1 so the proxy resolves names." : "")));
  else if (trace.stopped === "blocked") checks.push(check("warn", "Trace stopped: next host was not fetched",
    (last && last.reason) || "Host not allowed by the tracer. The URL is shown but was not requested."));
  else if (last && last.notFetched) checks.push(check("info", "The last address was not fetched",
    "The page before it sends people here with JavaScript, which the redirect service can't run, so this step is filled in and not requested."));
  else if (last && last.appScheme) checks.push(check("pass", "Chain ends by launching the app",
    "The last redirect is a custom-scheme URL (" + last.url.split("?")[0] + "); it was not requested."));
  else if (last && last.status === 407) checks.push(check(isWalmartHost(last.host) ? "fail" : "warn", "Tracer's egress proxy rejected the request (HTTP 407)",
    "The proxy the tracer runs behind refused " + last.host + ". That is a problem with where the tracer runs (or a proxy allowlist), not necessarily with the link."));
  else if (last && last.status >= 400) checks.push(check("fail", `Chain ends in HTTP ${last.status} at ${last.host}`,
    "The final response is an error page, so the link is broken for web users too."));
  else checks.push(check("pass", "Chain ended normally", last ? `final status ${last.status} at ${last.host}` : ""));

  if (last && isWalmartHost(last.host) && /^\/blocked(\/|$)/.test(pathOf(last.url))) checks.push(check("info", "Walmart's bot protection answered at the end of the chain (/blocked)",
    "The tracer was served a bot-check page instead of the real page, which is normal for non-phone clients and says nothing about the link. What matters is the redirects before it."));
  const touchesWalmart = hops.some(h => ROUTER_UNIVERSAL_HOSTS.has((h.host || hostOf(h.url) || "").toLowerCase()));
  const completed = trace.stopped === "done" && last && !last.error && last.status !== 407; // a proxy 407 says nothing about the destination
  if (ti >= 0) checks.push(check("pass", `Reaches an app-opening Walmart URL at hop ${ti + 1} (${hops[ti].host})`,
    hops[ti].appScheme ? "A walmart:// URL opens the app directly (requires the app to be installed)."
      : VERIFIED_ASSOCIATED_DOMAINS.has(hops[ti].host) ? "Verified applinks: associated domain; this is the URL iOS passes to the app."
      : hops[ti].host + " is handled by the app's router but is not a verified applinks: domain in the entitlements (only goto.walmart.com is), so iOS may open it in the browser instead."));
  else if (last && last.appScheme) checks.push(check("info", "No associated-domain hop; the app is opened by a custom scheme",
    "Fine if intended, but custom schemes need the app installed and show a prompt on iOS."));
  else if (completed && last.htmlNoRedirect && !touchesWalmart) checks.push(check("warn", "Chain ended on a web page the tracer could not read a redirect from",
    (last.jsRan
      ? `${last.host} returned a page with no static redirect, and running its JavaScript in headless Chrome for ${Math.round((last.js && last.js.ms || 0) / 1000)} s didn't send the visitor anywhere. It may wait for a tap, or detect headless browsers, so the destination is unknown.`
      : `${last.host} returned a page with no static redirect. It probably redirects with JavaScript that builds the URL at runtime; that cannot be followed here, so the destination is unknown.`) +
    (last.mentions && last.mentions.length ? ` The page's script does mention ${last.mentions.join(", ")}, which suggests it launches the app, but that is evidence, not proof. Open the link in a real browser/device to confirm.` : "")));
  else if (completed && !touchesWalmart) checks.push(check("fail", "Never reaches an approved Walmart link",
    `The chain ended at ${last.host} (HTTP ${last.status}) without passing through any host the app handles, so tapping this link will not open the app.`));
  else if (hops.length === 1 && (last.status === 407 || ["error", "blocked"].includes(trace.stopped))) checks.push(check("info", "Whether the app opens is not determined",
    "The first host could not be fetched from here, so no redirects were seen and nothing can be said about where the link leads."));
  else checks.push(check("warn", "No associated-domain host in the chain",
    "No hop is walmart://, goto.walmart.com or www.walmart.com, so nothing in this chain opens the Walmart app."));

  hops.forEach((h, i) => { if (h.emulated) checks.push(check("info", `Hop ${i + 1} (${h.host}) is a JavaScript page that was emulated, not executed`,
    (h.unverified ? "The redirect service can't run JavaScript or return the page, so the redirect was filled in from how this page is known to work (not checked against the live page). The Deeplink Checker's own server checks this for real when it is available. "
      : "The redirect was derived from the page's own code (fingerprint matched). If the page is changed, the tool reports it as unknown instead. ") + (h.note || ""))); });
  hops.forEach((h, i) => { if (h.jsExecuted) checks.push(check("info", `Hop ${i + 1} (${h.host}) redirects with JavaScript; it was run in headless Chrome as an iPhone`,
    "Where the page sends people was recorded from the running page (nothing was opened or followed by the browser; the tracer then followed it). " +
    "Pages that branch by device may send Android phones elsewhere. " + (h.note || ""))); });
  hops.forEach((h, i) => { if (h.fallbackUrl) checks.push(check("info", `Hop ${i + 1} is launched by a hidden iframe; the page then navigates to the web URL`,
    "Fallback if the app is not installed or does not take over: " + h.fallbackUrl)); });

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

/* ---------- Encoding analysis (every hop) ---------- */

// Hosts whose own page script consumes everything after url= as the destination.
const REST_CONSUMERS = [/(^|\.)pgbuynow\.com$/i];
const NESTED_URL = /^(?:https?|walmart[a-z0-9]*):\/\//i;

// How many percent-decodes until the value is a URL. null if it never becomes one.
function decodeDepth(raw) {
  let cur = raw;
  for (let k = 0; k < 6; k++) {
    if (NESTED_URL.test(cur)) return { k, value: cur };
    const next = safeDecode(cur);
    if (next === cur) return null;
    cur = next;
  }
  return null;
}

/**
 * Looks at every query parameter whose value is (or encodes) a URL and reports how many times it is encoded:
 * 0 = plain, 1 = encoded once (correct: consumers decode once), 2+ = double/triple encoded (broken).
 * Recurses into the decoded nested URL (max depth 3). Returns an array of checks.
 */
function analyzeEncoding(urlStr, host, depth, label) {
  depth = depth || 0; label = label || "";
  const out = [];
  const where = (n) => (label ? label + " → " : "") + n + "=";
  if (/\s/.test(urlStr)) out.push(check("fail", "URL contains whitespace", "Likely a copy/paste line break."));
  if (/%(?![0-9A-Fa-f]{2})/.test(urlStr)) out.push(check("warn", "Contains a '%' that is not a valid escape", "Either a literal % that should be %25, or truncated encoding."));
  if (/[^\x00-\x7F]/.test(urlStr)) out.push(check("warn", "Contains non-ASCII characters", "They should be percent-encoded."));
  const items = parseQuery(urlStr);
  // Redirectors whose page JS treats EVERYTHING after the first "url=" as the destination (then decodes it once):
  // an unencoded nested URL is expected there, so the "outer params leak" warning would be a false positive.
  if (host && REST_CONSUMERS.some(re => re.test(host))) {
    const qi = urlStr.indexOf("?"), rest0 = qi < 0 ? "" : urlStr.slice(qi + 1).split("#")[0], ui = rest0.indexOf("url=");
    if (ui >= 0) {
      const rest = rest0.slice(ui + 4), res = decodeDepth(rest);
      const nm = (label ? label + " → " : "") + "url=";
      if (!res) out.push(check("fail", `${nm} remainder does not decode to a URL`, rest.slice(0, 120)));
      else if (res.k <= 1) out.push(check("pass", `${nm} destination is ${res.k === 0 ? "plain" : "encoded once"} (level ${res.k}) and this host takes everything after url= as the destination`,
        "Its page script decodes once, so both forms work and the remaining parameters stay with the destination."));
      else out.push(check("fail", `${nm} destination is encoded ${res.k} times (level ${res.k})`, "This host decodes once, leaving an encoded string instead of a URL.",
        { show: [["As received", rest], ["After one decode (what the page uses)", safeDecode(rest)], ["Fully decoded", fullyDecode(rest)]] }));
      const dest = res.value;
      if (((dest.split("#")[0].split("?").length - 1)) > 1) out.push(check("warn", `${nm} destination has more than one '?'`,
        "The second '?' ends up inside a parameter value (e.g. selectedSellerId=0?utm_source=meta), so the parameters after it are not read by the destination.", { show: [["Destination", dest]] }));
    }
    return out;
  }
  const hostIsWalmart = host && (host === "walmart.com" || host.endsWith(".walmart.com"));
  items.forEach((it, idx) => {
    if (it.rawValue == null) return;
    const res = decodeDepth(it.rawValue);
    if (!res) return;
    const name = where(it.name);
    if (res.k === 0) {
      const after = items.slice(idx + 1).map(i => i.name);
      if (after.length) out.push(check("warn", `${name} nested URL is NOT encoded (level 0)`,
        `The '&' in the nested URL ends the ${it.name} value, so ${after.length} following parameter(s) (${after.slice(0, 6).join(", ")}${after.length > 6 ? ", …" : ""}) are parsed as parameters of the OUTER link, and the nested URL is cut short. Encode the nested URL once (encodeURIComponent).`,
        { show: [["Nested value as received", it.rawValue]], leaked: after }));
      else out.push(check("info", `${name} nested URL is not encoded (level 0)`, "Fine only if it contains no & or #; encoding it once is safer."));
      if ((it.rawValue.match(/\?/g) || []).length > 1) out.push(check("warn", `${name} nested URL has more than one '?'`,
        "The second '?' becomes part of a parameter value (e.g. a=0?utm_source=x), so those parameters are not read.", { show: [["Nested value", it.rawValue]] }));
    } else if (res.k === 1) {
      out.push(check("pass", `${name} nested URL is encoded once (level 1, correct)`, "Consumers decode once and get a clean URL."));
      if (/%3F|%26/i.test(res.value.split("#")[0])) out.push(check("warn", `${name} nested URL still contains encoded ? or &`, "The inner query should use plain ? and &."));
    } else {
      const full = fullyDecode(it.rawValue);
      out.push(check(hostIsWalmart || !host ? "fail" : "warn", `${name} nested URL is encoded ${res.k} times (level ${res.k})`,
        `One decode by the consumer still leaves an encoded string, not a URL, so routing it fails${hostIsWalmart ? " (this is the goto bounce)" : " (if this host decodes it once and forwards it, the next hop gets a valid URL — check the next hop)"}.`,
        { show: [["As received", it.rawValue], ["After one decode (what the consumer sees)", safeDecode(it.rawValue)], ["Fully decoded", full]] }));
    }
    if (depth < 3) {
      const inner = res.value; // decoded just far enough to be a URL, so deeper levels stay visible
      if (NESTED_URL.test(inner) && parseQuery(inner).some(i => i.rawValue != null && decodeDepth(i.rawValue))) {
        let ih = ""; try { ih = new URL(inner).hostname.toLowerCase(); } catch (e) { /* non-special scheme */ }
        out.push(...analyzeEncoding(inner, ih, depth + 1, (label ? label + " → " : "") + it.name));
      }
    }
  });
  return out;
}

// A level-0 "leaked parameters" warning is harmless when the next hop's URL still carries those parameters
// (the redirector re-attached them), so nothing is lost. Returns the checks with such warnings downgraded to info.
function downgradeLeaks(checks, nextUrl) {
  if (!nextUrl) return checks;
  const have = new Set(parseQuery(nextUrl).map(i => i.name));
  return checks.map(c => (c.status === "warn" && c.extra && c.extra.leaked && c.extra.leaked.every(n => have.has(n)))
    ? { ...c, status: "info", title: c.title + " — but the next hop carries those parameters, so nothing is lost",
      detail: "The nested URL is cut at the first '&', but the next hop's URL still has " + c.extra.leaked.join(", ") + ". Encoding it once is still safer." }
    : c);
}

/* ---------- Path checks for an app-opening URL (https or walmart://) ---------- */

function analyzePath(urlStr, expectType, expectId) {
  const checks = [];
  let path, scheme;
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^?#]*)/i.exec(urlStr);
  if (!m) return [check("fail", "Not a URL")];
  scheme = m[1].toLowerCase();
  if (scheme === "http" || scheme === "https") { try { path = new URL(urlStr).pathname.replace(/^\//, ""); } catch (e) { return [check("fail", "Unparseable URL")]; } }
  else path = m[2];
  if (scheme !== "http" && scheme !== "https" && path.startsWith("/")) {
    checks.push(check("info", `${scheme}:/// has three slashes (empty host)`,
      "Happens when a script builds `walmart://${path}` with a path that already starts with '/'. walmartSchemeURL (as ported here) returns walmart:// URLs unchanged, so confirm the route still matches in a debug build ([DL-DEBUG] canRoute=)."));
    path = path.replace(/^\/+/, "");
  }
  const rawPath = path;
  checks.push(check("info", "Path", "", { show: [["Path", "/" + rawPath]] }));
  if (/%2F/i.test(rawPath)) checks.push(check("fail", "Path contains an encoded slash (%2F)", "The router splits on '/', so this will not match a route. Usually the nested URL was pasted into the path double-encoded."));
  if (/%25/.test(rawPath)) checks.push(check("fail", "Path contains %25 (encoded %)", "The path is double-encoded."));
  if (/\/\//.test(rawPath)) checks.push(check("warn", "Path has an empty segment ('//')"));
  if (/^https?(%3A|:)/i.test(rawPath)) checks.push(check("fail", "Path is an embedded URL, not a route", "No app route matches this; the router will fall back to the browser."));
  const segs = rawPath.split("/").filter(Boolean);
  const info = classify(segs);
  checks.push(info.known ? check("info", `Looks like a ${info.type} route`, info.note, { show: [["ID", info.id || "(none)"]] })
    : check("info", "Route not in this tool's small table (brand / ip / cp)", "Not necessarily wrong; path validity is not verified here."));
  if (expectType) {
    const exp = (expectId || "").trim();
    if (expectType === "path") checks.push(rawPath.replace(/\/+$/, "") === exp.replace(/^\/+|\/+$/g, "") ? check("pass", "Path matches expected", exp) : check("fail", "Path differs from expected", `expected “${exp}”, got “${rawPath}”`));
    else if (info.type !== expectType) checks.push(check("fail", "Destination type differs from expected", `expected ${expectType}, got ${info.type || "unknown"}`));
    else if (exp) checks.push(info.id === exp ? check("pass", "ID matches expected", exp) : check("fail", "ID differs from expected", `expected ${exp}, got ${info.id || "(none)"}`));
    else checks.push(check("pass", "Type matches expected", expectType));
  }
  return checks;
}

/**
 * Known JavaScript-only redirector pages, modelled from their page source. openapp.pgbuynow.com:
 *   dest = decodeURIComponent(everything after the first "url="); iPhone: hidden iframe walmart://{path}{query}, then
 *   location = dest; Android: intent://www.walmart.com/{path}{query}, then location = dest.
 * Returns { dest, deeplink|null, androidIntent|null, via } or null. The caller decides whether the page still matches
 * (the tracer checks a fingerprint of the page's code; redirectcheck.org gives no page body, so that result is unverified).
 */
function emulateKnownRedirector(url, ua) {
  let u; try { u = new URL(url); } catch (e) { return null; }
  if (!/(^|\.)pgbuynow\.com$/i.test(u.hostname)) return null;
  const qs = u.search, i = qs.indexOf("url=");
  if (i < 0) return null;
  let dest, d;
  try { dest = decodeURIComponent(qs.slice(i + 4)); d = new URL(dest); } catch (e) { return null; }
  if (!dest.includes("https://www.walmart.com/")) return null;
  const ios = /iPad|iPhone|iPod/.test(ua || ""), android = /Android/i.test(ua || "");
  return {
    via: "page JS (emulated pgbuynow)", dest,
    deeplink: ios ? `walmart://${d.pathname}${d.search}` : null,
    androidIntent: android ? `intent://www.walmart.com/${d.pathname}${d.search}` : null,
  };
}
const IPHONE_UA_HINT = "iPhone";

/**
 * Turns a redirectcheck.org /api/check response ({ url, redirects:[{from,to,status_code,type,duration,headers}], final_result, loop, warnings })
 * into the chain shape the rest of this file analyses. Hop i is redirects[i].from with that redirect's status; the last hop is the
 * final `to`. Throws on an unusable response. That service cannot run JavaScript, so a final non-Walmart HTML page is flagged
 * htmlNoRedirect ("unknown", not "never reaches Walmart").
 */
function chainFromRedirectCheck(resp) {
  if (!resp || typeof resp !== "object" || Array.isArray(resp)) throw new Error("Unexpected response from redirectcheck.org (not a JSON object).");
  if (resp.error) throw new Error("redirectcheck.org: " + (typeof resp.error === "string" ? resp.error : JSON.stringify(resp.error)).slice(0, 300));
  if (!Array.isArray(resp.redirects)) throw new Error("Unexpected response from redirectcheck.org (no redirects array).");
  const reds = resp.redirects, fin = resp.final_result || {};
  const startUrl = String(resp.url || (reds[0] && reds[0].from) || "");
  const mk = (url, status) => {
    url = String(url == null ? "" : url);
    let host = "", scheme = "";
    try { const u = new URL(url); host = u.hostname.toLowerCase(); scheme = u.protocol; } catch (e) { /* leave empty */ }
    const hop = { url, host, status: typeof status === "number" ? status : null };
    if (/^walmart[a-z0-9]*:$/.test(scheme)) { hop.appScheme = true; hop.host = scheme + "//"; hop.status = null; }
    return hop;
  };
  const hops = [], warnings = Array.isArray(resp.warnings) ? resp.warnings.map(String) : [];
  if (!reds.length) hops.push(mk(startUrl, fin.status_code));
  else {
    reds.forEach((r, i) => {
      const hop = mk(r.from, r.status_code);
      if (typeof r.duration === "number") hop.ms = r.duration;
      if (r.headers && r.headers.server) hop.server = String(r.headers.server);
      if (r.type && r.type !== "http") hop.via = String(r.type);
      hop.location = r.to; hop.nextUrl = r.to; hops.push(hop);
    });
    // The next hop's URL is the Location header the server really sent (resolved against `from`). `to` should be identical;
    // if it is not, the header wins because it is what a client follows.
    const targets = reds.map((r) => {
      const loc = r.headers && r.headers.location;
      if (!loc) return r.to;
      let fromHeader; try { fromHeader = new URL(String(loc), String(r.from)).href; } catch (e) { return r.to; }
      let toNorm; try { toNorm = new URL(String(r.to)).href; } catch (e) { toNorm = null; }
      if (toNorm === fromHeader) return r.to;
      warnings.push("The API's `to` differs from the Location header for " + String(r.from).slice(0, 80) + "…; the Location header was used.");
      return fromHeader;
    });
    reds.forEach((r, i) => { hops[i].location = targets[i]; hops[i].nextUrl = targets[i]; });
    hops.push(mk(targets[targets.length - 1], fin.status_code));
    targets.slice(0, -1).forEach((u, i) => { if (hops[i + 1].url !== u) { hops[i + 1].url = String(u); try { hops[i + 1].host = new URL(u).hostname.toLowerCase(); } catch (e) { /* keep */ } } });
  }
  hops.forEach((h, i) => { h.index = i; });
  const last = hops[hops.length - 1];
  if (!last.appScheme && last.status === 200 && /html/i.test(String(fin.content_type || "")) && !isWalmartHost(last.host)) last.htmlNoRedirect = true;
  // That service can't run the page's JavaScript; for a known redirector page apply what its code does (unverified: no page body).
  const emu = last.htmlNoRedirect ? emulateKnownRedirector(last.url, IPHONE_UA_HINT) : null;
  if (emu && emu.deeplink) {
    delete last.htmlNoRedirect;
    Object.assign(last, { via: emu.via, emulated: true, unverified: true, location: emu.deeplink, nextUrl: emu.deeplink });
    hops.push({ url: emu.deeplink, host: "walmart://", status: null, appScheme: true, via: emu.via + ", hidden iframe", fallbackUrl: emu.dest });
    const end = mk(emu.dest, null); end.notFetched = true; hops.push(end);
    warnings.push("redirectcheck.org can't run JavaScript, so the " + last.host + " step was filled in from how that page is known to work. The Deeplink Checker's own server checks this for real when it is available.");
    hops.forEach((h, i) => { h.index = i; });
  }
  const fin2 = hops[hops.length - 1];
  const stopped = resp.loop && resp.loop.detected ? "loop" : "done";
  return { startUrl, hops, finalUrl: fin2.url, stopped, source: "redirectcheck.org", warnings };
}

/**
 * Plain-English view of a report for non-technical users (product managers, advertisers).
 * Three pillars: 1 valid link, 2 opens the app, 3 where it lands in the app (not built yet).
 * Pillar states: "ok" | "warn" | "bad" | "cant" (could not tell) | "soon". Driven by report fields
 * (appOpensAtHop, appView, exitCode, chain, encoding); check titles are only used to word the explanation.
 * Works on a buildReport() result or on the JSON the CLI / server returns.
 */
function friendlySummary(d) {
  const chain = d.chain || {}, hops = chain.hops || [], untraced = !!d.untraced;
  const ti = d.appOpensAtHop ? d.appOpensAtHop - 1 : -1, V = d.appView || null;
  const unreachable = !untraced && hops.length === 1 && (d.exitCode === 3 || ["error", "blocked"].includes(chain.stopped) || (hops[0] && hops[0].status === 407));
  const chainChecks = d.chainChecks || [];
  const enc = (d.encoding || []).flatMap((e) => (e.checks || []).map((c) => ({ c, hop: e.i })));
  const take = (d.takeover || []).flatMap((g) => g.checks || []);
  const failed = (c) => c.status === "fail";
  const find = (list, re, st) => list.find((c) => (!st || c.status === st) && re.test(c.title));
  const encFail = enc.find((x) => failed(x.c) && /encoded (\d+) times|encoded more than once/i.test(x.c.title));
  const doubleEncoded = !!encFail || chainChecks.some((c) => failed(c) && /Double-encoding/.test(c.title)) || take.some((c) => failed(c) && /double-encoded/.test(c.title)) || !!(V && V.malformed);
  const p1 = [], p2 = [];
  const add = (list, tone, text, fix, extra) => list.push({ tone, text, fix: fix || "", ...(extra || {}) });

  if (doubleEncoded) {
    const times = encFail && /encoded (\d+) times/i.exec(encFail.c.title);
    const intro = chainChecks.find((c) => failed(c) && /introduced by the redirect from/.test(c.title));
    const m = intro && /redirect from (\S+) to (\S+)/.exec(intro.title);
    const already = chainChecks.some((c) => failed(c) && /already in the pasted link/.test(c.title));
    const fixed = take.find((c) => c.extra && c.extra.copy);
    add(p1, "bad", "The part of the link that says where to send people is encoded" + (times ? " " + times[1] + " times" : " more than once") +
      ". Walmart's app unwraps it only once, so it can't read where it is supposed to go." +
      (m ? " This extra encoding is added when " + m[1] + " redirects to " + m[2] + "." : already ? " It is already in the link you pasted." : ""),
      "Ask whoever built the link (your agency or ad platform" + (m ? ", starting with " + m[1] : "") + ") to encode the destination only once, then check it again.",
      fixed ? { copy: fixed.extra.copy, copyLabel: "A corrected version of the Walmart link" } : null);
  }
  const never = find(chainChecks, /Never reaches an approved Walmart link/, "fail");
  if (never) add(p1, "bad", "This link doesn't end up on a Walmart address that can open the app.", "Check that the link is built to go to goto.walmart.com or www.walmart.com.");
  const loop = find(chainChecks, /Redirect loop|Too many redirects/, "fail");
  if (loop) add(p1, "bad", "The link keeps redirecting in circles, so it never reaches a page.", "Ask whoever built the link to fix the redirect setup.");
  const err = find(chainChecks, /Chain ends in HTTP (\d+)/, "fail");
  if (err) add(p1, "bad", "The link leads to an error page (" + /HTTP (\d+)/.exec(err.title)[0] + "), so it is broken even in a web browser.", "Check the link was copied completely and the page still exists.");
  const hopFail = find(chainChecks, /A hop failed/, "fail");
  if (hopFail) add(p1, "bad", "One of the websites the link passes through didn't respond.", "Try again in a moment. If it keeps happening, ask whoever built the link.");
  const noU = take.find((c) => failed(c) && /Missing u=/.test(c.title));
  if (noU) add(p1, "bad", "The link doesn't say where to send people (its destination is missing).", "Ask whoever built the link to include the destination.");
  const ws = [...take, ...enc.map((x) => x.c)].find((c) => failed(c) && /whitespace/i.test(c.title));
  if (ws) add(p1, "bad", "The link contains spaces or line breaks, usually from copy and paste.", "Copy the link again as one single line.");
  const bad = take.find((c) => failed(c) && /Not a valid absolute URL|No URL provided/.test(c.title));
  if (bad) add(p1, "bad", "This doesn't look like a complete web link.", "Paste the full link, starting with https://");
  const q = enc.find((x) => x.c.status === "warn" && /more than one '\?'/.test(x.c.title));
  if (q) add(p1, "warn", "The destination has a stray question mark, so tracking tags after it may be ignored.", "Ask whoever built the link to use & between settings and only one ? in the destination.");
  const dup = [...take, ...enc.map((x) => x.c)].find((c) => c.status === "warn" && /Duplicate parameters/.test(c.title));
  if (dup) add(p1, "warn", "The same tracking setting appears twice in the destination, so it's unclear which value is used.", "Keep one copy of each tracking setting.");

  const web = take.find((c) => failed(c) && /web-forcing|Parameters that force web/.test(c.title));
  if (web) add(p2, "bad", "The link is set to open in the browser instead of the app.", "Remove the settings that force the web version (gbo, oab or auth set to 1).");
  const dest = take.find((c) => failed(c) && /Destination host is not converted/.test(c.title));
  if (dest) add(p2, "bad", "The destination isn't a Walmart address the app opens, so it stays on the website.", "Point the destination at www.walmart.com.");

  const lastHop = hops[hops.length - 1];
  const ended = !untraced && ti < 0 && !!lastHop && (lastHop.htmlNoRedirect === true || chainChecks.some((c) => /could not read a redirect from/.test(c.title)));
  const issues = (l, tone) => l.filter((i) => i.tone === tone);
  const emulated = hops.some((h) => h.emulated);
  const pillars = [];
  // 1. valid link
  let s1, t1, h1;
  if (issues(p1, "bad").length) { s1 = "bad"; h1 = "There's a problem with the link"; t1 = ""; }
  else if (unreachable) { s1 = "cant"; h1 = "We couldn't check this"; t1 = "We couldn't reach the first website in the link from here (usually a network or proxy issue), so we can't tell. Nothing looks wrong with the link itself."; }
  else if (ended) { s1 = "cant"; h1 = "We couldn't check this"; t1 = lastHop.jsRan
    ? "The link ends on a web page that didn't send us anywhere, even after running its JavaScript. It may wait for a tap or block automated browsers, so we can't tell where the link leads. Nothing looks wrong with the link itself."
    : "The link ends on a web page that probably sends people on with JavaScript. " + (d.chain && d.chain.source === "redirectcheck.org" ? "The redirect service used here (redirectcheck.org) can't run JavaScript; the Deeplink Checker's own server can, when it is available." : "This tool can't follow that here (no Chrome found to run it), so it can't tell where the link leads.") + " Nothing looks wrong with the link itself."; }
  else if (untraced && ti < 0) { s1 = "cant"; h1 = "We couldn't check this"; t1 = "We couldn't follow the link's redirects from here, so we can't tell whether it leads to Walmart. Nothing looks wrong with the link itself."; }
  else if (issues(p1, "warn").length) { s1 = "warn"; h1 = "Works, but could be cleaner"; t1 = ""; }
  else { s1 = "ok"; h1 = "The link is valid"; t1 = untraced ? "The link itself looks fine. We couldn't follow where it redirects, so that part isn't checked." : "It is well formed and leads to a Walmart address."; }
  pillars.push({ id: 1, title: "Valid link for Walmart", state: s1, headline: h1, text: t1, issues: p1 });
  // 2. opens the app
  let s2, t2, h2;
  const host = ti >= 0 && hops[ti] ? hops[ti].host : "";
  if (issues(p2, "bad").length) { s2 = "bad"; h2 = "It won't open the app"; t2 = ""; }
  else if (V && V.malformed) { s2 = "bad"; h2 = "It opens the app, then falls back to the website"; t2 = "The app starts, but it can't make sense of the link, so it gives up and shows the Walmart website instead. This is caused by the encoding problem above."; }
  else if (unreachable) { s2 = "cant"; h2 = "We couldn't check this"; t2 = "We couldn't follow the link from here, so we can't tell whether it reaches the app."; }
  else if (ended) { s2 = "cant"; h2 = "We couldn't check this"; t2 = "The link ends on a web page that may open the app with JavaScript, and we couldn't see it do so. Test it by tapping the link on a phone with the Walmart app."; }
  else if (ti < 0) {
    if (untraced) { s2 = "cant"; h2 = "We couldn't check this"; t2 = "We couldn't follow the link's redirects from here, so we can't tell whether it ends in the app."; }
    else { s2 = "bad"; h2 = "It won't open the app"; t2 = "Nothing along the link's path is an address the Walmart app opens (goto.walmart.com, www.walmart.com or walmart://)."; }
  } else {
    s2 = "ok"; h2 = "It opens the Walmart app";
    t2 = hops[ti].appScheme ? "The link launches the app directly. This only works if the app is installed on the phone."
      : "On a phone with the Walmart app, tapping the link opens the app (via " + host + ")." + (/^goto\./.test(host) ? "" : " It uses a standard walmart.com address; a quick test on a phone is the surest check.");
    if (emulated) t2 += hops.some((h) => h.unverified) ? " The redirect page's step is filled in from how it is known to work (the redirect service used here can't run JavaScript); the Deeplink Checker's own server checks it for real when it is available."
      : " This is based on how the redirect page is built; confirm on a phone.";
  }
  pillars.push({ id: 2, title: "Opens the Walmart app", state: s2, headline: h2, text: t2, issues: p2 });
  // 3. where it lands in each app
  const D = d.appDestination !== undefined ? d.appDestination : appDestination(hops, ti);
  let s3, h3, t3 = "", rows = [];
  if (!D || D.error) { s3 = "cant"; h3 = "We couldn't work this out"; t3 = D && D.error ? "The app route tables failed to load (" + D.error + ")." : "The app route tables aren't loaded on this page."; }
  else if (s2 === "cant" || (unreachable || ended) || (untraced && ti < 0)) { s3 = "cant"; h3 = "We couldn't check this"; t3 = "We need to know where the link ends up before we can tell which app page it opens."; }
  else {
    rows = [destinationRow(D.ios), destinationRow(D.android)];
    s3 = rows.reduce((a, r) => (STATE_RANK[r.state] > STATE_RANK[a] ? r.state : a), "ok");
    const [ri, ra] = rows;
    if (ri.short === ra.short) h3 = ri.short === "the Home page" ? "The Home page" : ri.short.charAt(0).toUpperCase() + ri.short.slice(1);
    else h3 = "iPhone: " + ri.short + " · Android: " + ra.short;
    if (s3 === "warn") t3 = "The link technically works, but at least one app can't show the page and sends people to the website instead.";
    if (V && V.malformed && D.android && D.android.outcome === "page") t2 += " On Android the app follows the web redirect instead, so it does reach the " + D.android.page + ".";
    if (pillars[1]) pillars[1].text = t2;
  }
  pillars.push({ id: 3, title: "Where it lands in the app", state: s3, headline: h3, text: t3, issues: [], rows });

  const bads = pillars.filter((p) => p.state === "bad"), warns = pillars.filter((p) => p.state === "warn"), cants = pillars.filter((p) => p.state === "cant");
  const causes = p1.filter((i) => i.tone === "bad").length + p2.filter((i) => i.tone === "bad").length + (s2 === "bad" && !p2.some((i) => i.tone === "bad") && !doubleEncoded ? 1 : 0);
  const overall = bads.length ? { state: "bad", title: "This link has a problem", text: causes <= 1 ? "One thing needs fixing before you send it." : "A few things need fixing before you send it." }
    : cants.length ? { state: "cant", title: "We couldn't fully check this link", text: "Nothing looks wrong, but we couldn't follow the whole link from here." }
    : warns.length === 1 && warns[0].id === 3 ? { state: "warn", title: "This link opens the app, but not the right page", text: "At least one app shows the Walmart website instead of a page in the app. Check the details below." }
    : warns.length ? { state: "warn", title: "This link should work, with something to tidy", text: "It's fine to send, but it could be cleaner." }
    : { state: "ok", title: "This link works", text: "It's valid and it opens the Walmart app" + (pillars[2] && pillars[2].state === "ok" && pillars[2].rows.length && !/·/.test(pillars[2].headline) ? " on the " + pillars[2].headline.replace(/^The /, "") + "." : ".") };

  const stText = (h) => (h.appScheme ? "Opens the app" : h.error ? "Didn't respond" : h.reason ? "Not checked" : h.status == null ? "Not checked" : h.status >= 400 ? "Error " + h.status : h.status >= 300 ? "Redirects" : "Loads");
  const journey = hops.map((h, i) => {
    const e = enc.filter((x) => x.hop === i);
    const f = e.find((x) => failed(x.c)), w = e.find((x) => x.c.status === "warn");
    return { n: i + 1, label: h.appScheme ? String(h.url).split("?")[0].slice(0, 40) : h.host || "(invalid)", url: String(h.url || ""), status: stText(h), opens: i === ti,
      flag: f ? { tone: "bad", text: "Encoded too many times" } : w ? { tone: "warn", text: "Worth a look" } : null };
  });
  return { overall, pillars, journey, source: chain.source || null, notes: chain.warnings || [] };
}

// The walmart:// URL the iPhone app builds from an https app-opening address (what DeepLinkRouter routes).
function iosRoute(url, kind) {
  if (kind === "goto") { const imp = new ImpactLink(url); return /^https?:\/\/goto\.grocery\./i.test(url) ? imp.manipulateGrocery() : imp.manipulate(); }
  return walmartSchemeURL(url);
}
// Which page each app (iPhone, Android) ends up on. null when the route tables aren't loaded.
function appDestination(hops, ti) {
  if (!ROUTES || !hops || !hops.length) return null;
  try { return ROUTES.resolveDestinations(hops, ti, iosRoute); } catch (e) { return { error: String(e && e.message || e) }; }
}

const DEST_STATE = { page: "ok", home: "ok", webview: "ok", web: "warn", unknown: "cant", error: "bad" };
const STATE_RANK = { bad: 3, warn: 2, cant: 1, ok: 0 };
// Plain-English line per platform for the "Where it lands in the app" answer.
function destinationRow(p) {
  const name = p.platform === "ios" ? "iPhone" : "Android";
  const where = p.page ? p.page + (p.detail ? " (" + p.detail + ")" : "") : "";
  let short, text;
  if (p.outcome === "page") { short = where; text = "Opens the " + where + "."; }
  else if (p.outcome === "webview") { short = (where || "a web page") + ", as a web page inside the app"; text = (where ? "Opens the " + where + ", shown as a web page inside the app." : (p.why || "Opens a web page inside the app.")); }
  else if (p.outcome === "home") { short = "the Home page"; text = p.page === "Home" ? "Opens the app on the Home page." : "Opens the app on the Home page. " + (p.why || ""); }
  else if (p.outcome === "web") { short = p.opensApp === false ? "the website (the app doesn't open)" : "the website"; text = p.why || "Ends up on the Walmart website instead of a page in the app."; }
  else if (p.outcome === "error") { short = "an error message"; text = p.why || "The app shows an error."; }
  else { short = "unknown"; text = p.why || "We couldn't tell."; }
  if (p.alt && p.alt.page && p.alt.page !== p.page) text += " " + (p.alt.page === "Home" ? "It would open the Home page instead " : "It would open the " + p.alt.page + (p.alt.detail ? " (" + p.alt.detail + ")" : "") + " instead ") + p.alt.when + ".";
  const notes = (p.notes || []).filter(Boolean);
  return { platform: name, state: DEST_STATE[p.outcome] || "cant", short, text: text.trim(), notes, matched: p.matched || null, src: p.src || null, route: p.route || null };
}

// Destination as checks (so the CLI verdict / exit code agree with the page): web fallback = WARN, app error = FAIL.
function destinationChecksFor(D, chain, ti) {
  if (!D || D.error || chain.untraced) return [];
  if (ti < 0 && !(D.android && D.android.opensApp)) return []; // "Never reaches an approved Walmart link" already says it
  const ST = { page: "pass", home: "pass", webview: "pass", web: "warn", error: "fail", unknown: "info" };
  return [D.ios, D.android].filter(Boolean).map((p) => {
    const r = destinationRow(p);
    const extra = { show: [] };
    if (r.route) extra.show.push(["Route", r.route]);
    if (r.matched) extra.show.push(["Matched pattern", r.matched + (r.src ? "  (" + r.src + ")" : "")]);
    const i = r.text.indexOf(". "), first = (i < 0 ? r.text : r.text.slice(0, i)).replace(/\.$/, ""), rest = i < 0 ? "" : r.text.slice(i + 2);
    return check(ST[p.outcome] || "info", `${r.platform}: ${first}`, [rest, ...r.notes].filter(Boolean).join(" "), extra);
  });
}

/**
 * Everything the CLI / server / web page report for a traced chain. Pure: works in Node, Bun and the browser.
 * chain.untraced = true means redirects were NOT followed (browser without a server): only the pasted link is analysed.
 */
function buildReport(chain, { etype = "", eid = "" } = {}) {
  const hops = chain.hops;
  const ti = appTakeoverIndex(hops);
  const chainChecks = chain.untraced
    ? [check("info", "Redirects were not followed", "Only the pasted link was analysed. Turn on “Trace redirects” (needs the tool's server) or use the CLI to see the call path and where the app opens.")]
    : analyzeChain(chain).checks;
  const encoding = hops.map((h, i) => ({ i, hop: h,
    checks: h.appScheme ? [] : downgradeLeaks(analyzeEncoding(h.url, h.host), hops[i + 1] && hops[i + 1].url) }));
  let takeover = null;
  if (ti >= 0) {
    const h = hops[ti];
    takeover = /^goto(\.grocery)?\.walmart\.com$/.test(h.host)
      ? validate(h.url, etype, eid).groups
      : [{ name: "App URL path", checks: analyzePath(h.url, etype, eid) }];
  }
  const dest = appDestination(hops, ti);
  const destinationChecks = destinationChecksFor(dest, chain, ti);
  const all = [...chainChecks, ...encoding.flatMap((e) => e.checks), ...(takeover || []).flatMap((g) => g.checks), ...destinationChecks];
  const fails = all.filter((c) => c.status === "fail"), warns = all.filter((c) => c.status === "warn");
  // exitCode 3 = the pasted host could not be reached at all (network/proxy), so there is no verdict about the link itself.
  const exitCode = fails.length ? 1 : (["error", "blocked"].includes(chain.stopped) || (hops[0] && hops[0].status === 407)) && hops.length === 1 ? 3 : 0;
  return { verdict: fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", exitCode, fails, warns,
    appOpensAtHop: ti >= 0 ? ti + 1 : null, appView: buildAppView(hops, ti), appDestination: dest, destinationChecks,
    chain, chainChecks, encoding, takeover, untraced: !!chain.untraced };
}

const api = { emulateKnownRedirector, appDestination, destinationRow, destinationChecksFor, iosRoute, friendlySummary, buildAppView, isMalformedRoute, chainFromRedirectCheck, buildReport, APP_OPEN_HOSTS, downgradeLeaks, analyzeEncoding, analyzePath, decodeDepth, fullyDecode, classify, KNOWN_REDIRECTORS, redirectorFor, validate, ImpactLink, walmartSchemeURL, TESTS, LOGGED, analyzeChain, appTakeoverIndex, isDoubleEncodedU,
  VERIFIED_ASSOCIATED_DOMAINS, ROUTER_UNIVERSAL_HOSTS, parseQuery, queryDict, check };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.DLCore = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
