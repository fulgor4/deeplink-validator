// Offline tests for the hops API (server/) and the web page (public/). Run: node test/server.test.mjs  (or bun)
import fs from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "../server/server.mjs";

let failed = 0;
const t = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };
const require = createRequire(import.meta.url);
globalThis.DLCore = require("../public/js/core.js");
const GOTO = "https://goto.walmart.com/c/1/2/3?u=https%253A%252F%252Fwww.walmart.com%252Fbrand%252F20045132";
const GOOD = "https://goto.walmart.com/c/1/2/3?u=" + encodeURIComponent("https://www.walmart.com/brand/20045132");
const routes = {
  "https://redirector.example/dbl": [302, GOTO], [GOTO]: [200, null],
  "https://redirector.example/ok": [302, GOOD], [GOOD]: [200, null],
};
const fetchImpl = async (u) => { const [s, l] = routes[u] || [404, null]; return new Response("", { status: s, headers: l ? { location: l } : {} }); };
const base = { fetchImpl, lookup: async () => [{ address: "8.8.8.8" }], skipDnsCheck: false, jsRunner: null };
const listen = async (o) => { const s = createServer({ ...base, ...o }); await new Promise((r) => s.listen(0, "127.0.0.1", r)); return [s, `http://127.0.0.1:${s.address().port}`]; };
const [srv, S] = await listen({ allowedOrigins: [] });
const get = (p, init) => fetch(S + p, init);
const hops = async (u, extra = "", at = S, init) => { const r = await fetch(`${at}/api/hops?url=${encodeURIComponent(u)}${extra}`, init); return [r, await r.json()]; };

// --- the API returns hops only; the checks run in the browser (core.js)
let [r, b] = await hops("https://redirector.example/dbl");
t("api: returns the hops and nothing Walmart-specific", r.status === 200 && b.hops.length === 2 && b.stopped === "done" && b.source === "hops-api" && !("chainChecks" in b) && !("verdict" in b) && !("appDestination" in b), JSON.stringify(b).slice(0, 300));
let R = DLCore.buildReport(b);
t("api: the page's own checks find the double encoding (FAIL)", R.verdict === "FAIL" && JSON.stringify(R).includes("encoded 2 times") && R.appOpensAtHop === 2);
[r, b] = await hops("https://redirector.example/ok");
t("api: correctly encoded link is not a FAIL", DLCore.buildReport(b).verdict !== "FAIL");
t("api: expected destination is checked in the browser", JSON.stringify(DLCore.buildReport(b, { etype: "brand", eid: "20045132" })).includes("ID matches expected"));
[r] = await hops("https://redirector.example/ok", "&ua=android"); t("api: ua=android accepted", r.status === 200);
[r] = await hops("https://redirector.example/ok", "&ua=__proto__"); t("api: ua=__proto__ rejected", r.status === 400);
[r] = await hops("https://redirector.example/ok", "&ua=nokia"); t("api: unknown ua -> 400", r.status === 400);
r = await get("/api/hops"); t("api: missing url -> 400", r.status === 400);
r = await get("/api/hops?url=" + "a".repeat(9000)); t("api: oversized url -> 400", r.status === 400);
[r, b] = await hops("file:///etc/passwd"); t("api: file:// is refused, not read", r.status === 200 && b.hops[0].status === null && b.stopped === "blocked", JSON.stringify(b));
[r, b] = await hops("http://127.0.0.1:1/"); t("api: private address refused", b.stopped === "blocked" && DLCore.buildReport(b).exitCode === 3, JSON.stringify(b));
r = await get("/api/hops?url=x", { method: "POST" }); t("api: POST -> 405", r.status === 405);
r = await get("/healthz"); b = await r.json(); t("healthz identifies the service", r.status === 200 && b.ok === true && b.service === "deeplink-hops" && b.runsJs === false);
r = await get("/trace?url=x"); t("old /trace endpoint is gone", r.status === 404);

// --- API-only by default: no web page, no route tables
for (const p of ["/", "/index.html", "/js/core.js", "/js/app-routes.js", "/js/app-routes-android.generated.js", "/server.mjs", "/package.json", "/../package.json"]) { r = await get(p); t("api-only server does not serve " + p, r.status === 404); }

// --- which pages may call it (ALLOWED_ORIGINS)
{
  const PAGES = "https://gecgithub01.walmart.com";
  const [s2, S2] = await listen({ allowedOrigins: [PAGES] });
  let [x] = await hops("https://redirector.example/ok", "", S2, { headers: { origin: PAGES } });
  t("origins: the allowed page gets an answer with CORS", x.status === 200 && x.headers.get("access-control-allow-origin") === PAGES && /Origin/.test(x.headers.get("vary") || ""));
  [x] = await hops("https://redirector.example/ok", "", S2, { headers: { origin: "https://evil.example" } });
  t("origins: another website is refused (403, no CORS)", x.status === 403 && !x.headers.get("access-control-allow-origin"));
  [x] = await hops("https://redirector.example/ok", "", S2);
  t("origins: no browser origin at all (curl/script) is refused", x.status === 403);
  [x] = await hops("https://redirector.example/ok", "", S2, { headers: { "sec-fetch-site": "same-origin" } });
  t("origins: same-origin page (served by the server itself) is allowed", x.status === 200);
  x = await fetch(S2 + "/healthz", { headers: { origin: PAGES } });
  t("origins: healthz carries CORS for the allowed page", x.status === 200 && x.headers.get("access-control-allow-origin") === PAGES);
  x = await fetch(S2 + "/healthz", { headers: { origin: "https://evil.example" } });
  t("origins: healthz gives other websites no CORS (their page can't read it)", !x.headers.get("access-control-allow-origin"));
  s2.close();
  [x] = await hops("https://redirector.example/ok", "", S, { headers: { origin: "https://any.example" } });
  t("origins: not configured = open: any page gets an answer with CORS *", x.status === 200 && x.headers.get("access-control-allow-origin") === "*");
  [x] = await hops("https://redirector.example/ok", "", S);
  t("origins: not configured = open: curl/scripts (no origin) get an answer", x.status === 200);
  x = await fetch(S + "/api/health");
  t("health: /api/health answers like /healthz (Cloud Run reserves /healthz)", x.status === 200 && (await x.json()).service === "deeplink-hops");
  const [s3, S3] = await listen({ allowedOrigins: ["*"] });
  [x] = await hops("https://redirector.example/ok", "", S3, { headers: { origin: "https://any.example" } });
  t("origins: * allows any page", x.status === 200 && x.headers.get("access-control-allow-origin") === "*");
  s3.close();
}

// --- rate limit (per client IP; X-Forwarded-For only with trustProxy)
{
  const [s4, S4] = await listen({ rateLimitPerMin: 2 });
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await hops("https://redirector.example/ok", "", S4))[0].status);
  t("rate limit: request 3 of 2/min is refused (429)", codes.join() === "200,200,429", codes.join());
  const [x] = await hops("https://redirector.example/ok", "", S4, { headers: { "x-forwarded-for": "9.9.9.9" } });
  t("rate limit: X-Forwarded-For is ignored without trustProxy (can't dodge the limit)", x.status === 429);
  s4.close();
  const [s5, S5] = await listen({ rateLimitPerMin: 1, trustProxy: true });
  const a1 = (await hops("https://redirector.example/ok", "", S5, { headers: { "x-forwarded-for": "1.1.1.1" } }))[0].status;
  const a2 = (await hops("https://redirector.example/ok", "", S5, { headers: { "x-forwarded-for": "1.1.1.1" } }))[0].status;
  const b1 = (await hops("https://redirector.example/ok", "", S5, { headers: { "x-forwarded-for": "2.2.2.2" } }))[0].status;
  const forged = (await hops("https://redirector.example/ok", "", S5, { headers: { "x-forwarded-for": "7.7.7.7, 1.1.1.1" } }))[0].status;
  t("rate limit: behind a proxy each client IP gets its own limit; a forged first entry doesn't help", a1 === 200 && a2 === 429 && b1 === 200 && forged === 429, [a1, a2, b1, forged].join());
  s5.close();
  t("rate limit: default is 100 per minute", createServer({ jsRunner: null }).settings.limitPerMin === 100);
}

// --- local development: SERVE_SITE also serves the web page
const [site, SITE] = await listen({ serveSite: true });
r = await fetch(SITE + "/"); const html = await r.text();
t("site: serves index.html with CSP + nosniff", r.status === 200 && /Deeplink Checker/.test(html) && /default-src 'self'/.test(r.headers.get("content-security-policy")) && r.headers.get("x-content-type-options") === "nosniff");
r = await fetch(SITE + "/js/core.js"); t("site: serves core.js to the page", r.status === 200 && /DLCore/.test(await r.text()));
for (const f of ["app-routes.js", "app-routes-android.generated.js"]) { r = await fetch(SITE + "/js/" + f); t("site: serves " + f + " to the page", r.status === 200 && /DLRoutes|DLAndroidRoutes/.test(await r.text())); }
r = await fetch(SITE + "/config.js"); t("site: serves config.js", r.status === 200 && /DL_CONFIG/.test(await r.text()));
t("page loads config, then the route tables, then core.js", html.indexOf("config.js") < html.indexOf("app-routes-android.generated.js") && html.indexOf("app-routes-android.generated.js") < html.indexOf("app-routes.js\"") && html.indexOf("app-routes.js\"") < html.indexOf("js/core.js"));
for (const p of ["/server.mjs", "/server/server.mjs", "/server/trace.mjs", "/package.json", "/../server/server.mjs", "/js/../../package.json", "/legacy/core.js", "/public/index.html"]) { r = await fetch(SITE + p); t("site: does not serve " + p, r.status === 404); }
t("site: CSP allows the redirectcheck.org fallback", /connect-src 'self' https:\/\/www\.redirectcheck\.org/.test((await fetch(SITE + "/")).headers.get("content-security-policy")));
site.close();

/* ---- the page's own script, with a minimal DOM shim ---- */
class N { constructor(t){this.tag=t;this.children=[];this.className="";this._t="";this.style={};this.value="";this.checked=false;this.disabled=false;this.open=false;this.L={};}
  appendChild(c){this.children.push(c);return c;} get lastChild(){return this.children[this.children.length-1];} set textContent(v){this._t=v;this.children=[];} get textContent(){return this._t+this.children.map(c=>c.textContent).join("");}
  addEventListener(e,f){this.L[e]=f;} setAttribute(k,v){(this.attrs=this.attrs||{})[k]=String(v);} }
const ids = {}; globalThis.document = { getElementById:(i)=>ids[i]||(ids[i]=new N("#"+i)), createElement:(x)=>new N(x), createTextNode:(x)=>{const n=new N("#text");n._t=String(x);return n;} };
globalThis.window = {}; globalThis.navigator = {}; globalThis.location = { protocol: "file:" };
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\ndetectServer\(\);\s*$/, "\n");
new Function(script + "\nglobalThis.__p = { renderReport, parseReport, checkInBrowser, run, setServer: (v) => { serverOk = v; } };")();
const p = globalThis.__p;
for (const i of ["url", "msg", "out", "go", "tracenote"]) document.getElementById(i);
const walk = (n, f, out = []) => { if (f(n)) out.push(n); (n.children || []).forEach((c) => walk(c, f, out)); return out; };
const realFetch = globalThis.fetch;
const netDown = async () => { throw new TypeError("Failed to fetch"); };

t("page: the technical controls are gone (no Trace with / user agent / expected destination)", !/id="(how|ua|etype|eid|dotrace|fallback|json|showjson)"/.test(html) && !/Pretend to be|Trace with|Expected destination|Can't run the check/.test(html));
t("page: no unsafe DOM sinks", !/innerHTML|outerHTML|insertAdjacentHTML|eval\(|document\.write/.test(html));

const realChain = (await hops("https://redirector.example/dbl"))[1];
const real = DLCore.buildReport(realChain);
// Nothing can follow the link: falls back to checking the pasted link itself, with a plain-English note
globalThis.fetch = netDown;
ids.url.value = GOTO; await p.run();
let o = ids.out.textContent;
t("page: when the checker can't be reached it says to leave the Walmart VPN, and still checks the pasted link", ids.msg.textContent === "" && /We couldn't follow the link\./.test(o) && /only works outside the Walmart VPN/.test(o) && /This link has a problem/.test(o) && /encoded 2 times/.test(o), ids.msg.textContent + o.slice(0, 400));
t("page: that fallback does not claim the link never reaches Walmart", !/doesn't end up on a Walmart address/.test(o));
ids.url.value = "not a url"; await p.run();
t("page: invalid link gives a friendly message", /doesn't look like a complete web link/.test(ids.msg.textContent) && ids.out.textContent === "");

// Server answer (the double-encoded goto chain)
p.renderReport(p.parseReport(JSON.stringify(real)));
o = ids.out.textContent;
t("page: shows the verdict banner and the three pillars", /This link has a problem/.test(o) && /Valid link for Walmart/.test(o) && /Opens the Walmart app/.test(o) && /Where it lands in the app/.test(o) && /iPhone/.test(o) && /Android/.test(o) && !/Coming soon/.test(o), o.slice(0, 300));
t("page: pillar 3 lists each app with where it lands", walk(ids.out, (n) => n.tag === "li" && /^land /.test(n.className)).length === 2 && walk(ids.out, (n) => n.className === "plat").map((n) => n.textContent).join() === "iPhone,Android", o.slice(0, 300));
t("page: explains the problem in plain words with a what-to-do", /encoded 2 times/.test(o) && /Walmart's app unwraps it only once/.test(o) && /What to do: /.test(o) && /opens the app, then falls back to the website/.test(o), o.slice(0, 700));
t("page: offers the corrected link with a copy button", walk(ids.out, (n) => n.className === "copybox").length === 1 && walk(ids.out, (n) => n.tag === "button" && /Copy corrected link/.test(n.textContent)).length === 1);
t("page: technical details are offered (collapsed) when something is wrong", walk(ids.out, (n) => n.tag === "details" && n.className === "tech").length === 1 && /What the app receives at step 2/.test(o) && /the app stops here/.test(o));
t("page-side report has appView for the double-encoded goto chain", !!real.appView && real.appView.hop === 2 && real.appView.malformed === true && real.appView.levels.length === 3, JSON.stringify(real.appView));
p.renderReport(p.parseReport(JSON.stringify({ verdict: "FAIL", chainChecks: [{ status: "fail", title: "<img src=x onerror=alert(1)>" }], chain: { hops: [{ url: "https://e/<b>", host: "<b>x</b>", status: 200 }] } })));
t("page: hostile strings stay text", ids.out.textContent.includes("<b>x</b>") && !walk(ids.out, (n) => n.tag === "img").length);

{ // proxy 407 on the first hop: "couldn't check", never a false problem
  const sp = createServer({ fetchImpl: async () => new Response("", { status: 407 }), lookup: async () => [{ address: "8.8.8.8" }], skipDnsCheck: false, jsRunner: null });
  await new Promise((r) => sp.listen(0, "127.0.0.1", r));
  const j = DLCore.buildReport(await (await realFetch(`http://127.0.0.1:${sp.address().port}/api/hops?url=${encodeURIComponent("https://click2cart.com/pdp?a=1")}`)).json());
  p.renderReport(p.parseReport(JSON.stringify(j)));
  o = ids.out.textContent;
  t("page: 407 on hop 1 says 'couldn't fully check', not a false problem", j.exitCode === 3 && /We couldn't fully check this link/.test(o) && /We couldn't check this/.test(o) && !/This link has a problem/.test(o), o.slice(0, 300));
  sp.close();
}
{ // Server mode: used when /healthz answered
  let hit = null;
  globalThis.fetch = async (u) => { hit = String(u); return new Response(JSON.stringify(realChain), { status: 200, headers: { "content-type": "application/json" } }); };
  p.setServer(true); ids.url.value = "https://redirector.example/dbl"; await p.run();
  t("page: uses the hops API when it is available and runs the checks itself", /^\/api\/hops\?/.test(hit || "") && /This link has a problem/.test(ids.out.textContent), String(hit));
  p.setServer(false);
}
{ // API mode: a redirectcheck.org response rendered by the page (fetch is mocked; no network)
  const CLICK = "https://click2cart.com/pdp?service=sc&linkid=95799&pid=31183685";
  const GOTO2 = "https://goto.walmart.com/c/2194827/568844/9383?u=https%253A%252F%252Fwww.walmart.com%252Fbrand%252Ffebreze%252Fcrisp-fall-breeze%252F20084619%253F%2526utm_source%253DMeta&veh=aff";
  const WM = "https://www.walmart.com/brand/febreze/crisp-fall-breeze/20084619?&utm_source=Meta";
  const api = { url: CLICK, warnings: [], loop: { detected: false }, redirects: [
    { from: CLICK, to: GOTO2, status_code: 302, type: "http", duration: 324, headers: {} },
    { from: GOTO2, to: WM, status_code: 301, type: "http", duration: 78, headers: {} }], final_result: { status_code: 200, content_type: "text/html" } };
  let seen = null;
  globalThis.fetch = async (u, init) => { seen = { u, init }; return new Response(JSON.stringify(api), { status: 200, headers: { "content-type": "application/json" } }); };
  ids.url.value = CLICK; await p.run();
  const btns = walk(ids.out, (n) => n.className === "dom"); o = ids.out.textContent;
  t("page api: POSTs the pasted url to redirectcheck.org with followMetaRefresh", seen && seen.u === "https://www.redirectcheck.org/api/check" && seen.init.method === "POST" && JSON.parse(seen.init.body).url === CLICK && JSON.parse(seen.init.body).followMetaRefresh === true && JSON.parse(seen.init.body).method === "GET", JSON.stringify(seen));
  t("page api: journey shows one compact domain per step", btns.length === 3 && btns.map((b) => b.children[0]._t).join() === "click2cart.com,goto.walmart.com,www.walmart.com", btns.map((b) => b.textContent).join("|"));
  t("page api: domain carries the full URL on hover and starts collapsed", btns[1].attrs.title === GOTO2 && btns[1].attrs["aria-expanded"] === "false");
  const box = walk(ids.out, (n) => n.className === "j-full")[1];
  btns[1].L.click();
  t("page api: click expands the full URL", box.style.display === "" && btns[1].attrs["aria-expanded"] === "true" && box.textContent.includes(GOTO2));
  btns[1].L.click(); t("page api: second click collapses it", box.style.display === "none");
  t("page api: flags the goto step and says where the app opens", /Encoded too many times/.test(o) && /App opens here/.test(o) && /This link has a problem/.test(o), o.slice(0, 500));
  t("page api: names the service that followed the link", /Followed by redirectcheck\.org/.test(o));
  globalThis.fetch = netDown; ids.url.value = CLICK; await p.run();
  t("page api: unreachable checker => just 'only works outside the Walmart VPN' (no pillars, no CORS talk)", /only works outside the Walmart VPN/.test(ids.out.textContent) && !/CORS/.test(ids.out.textContent) && !/Valid link for Walmart/.test(ids.out.textContent) && !/We couldn't fully check/.test(ids.out.textContent) && ids.msg.textContent === "", ids.out.textContent.slice(0, 300));
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400 });
  ids.url.value = CLICK; await p.run();
  t("page api: an HTTP error from the checker is surfaced", /HTTP 400.*Invalid URL/.test(ids.out.textContent), ids.out.textContent.slice(0, 300));
}
globalThis.fetch = realFetch;

{ // finding the hops API: config.js hopsApi, else the page's own origin; only a real deeplink-hops /healthz counts
  const mk = (cfg, proto) => {
    globalThis.window = cfg ? { DL_CONFIG: cfg } : {}; globalThis.location = { protocol: proto };
    new Function(script + "\nglobalThis.__q = { detectServer, checkOnServer, state: () => ({ serverOk, apiBase, runsJs }) };")();
    return globalThis.__q;
  };
  const answer = (body) => async (u) => { answer.hit = String(u); return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); };
  let q = mk({ hopsApi: "https://hops.example/" }, "https:");
  globalThis.fetch = answer({ ok: true, service: "deeplink-hops", runsJs: true }); await q.detectServer();
  t("page: uses config.js hopsApi (trailing slash trimmed)", answer.hit === "https://hops.example/api/health" && q.state().serverOk && q.state().runsJs && q.state().apiBase === "https://hops.example" && /headless browser/.test(ids.tracenote.textContent), answer.hit + JSON.stringify(q.state()));
  globalThis.fetch = answer(realChain); await q.checkOnServer("https://redirector.example/dbl");
  t("page: calls <hopsApi>/api/hops", /^https:\/\/hops\.example\/api\/hops\?url=/.test(answer.hit), answer.hit);
  q = mk(null, "https:");
  globalThis.fetch = answer({ ok: true }); await q.detectServer();
  t("page: an /api/health that isn't ours (e.g. GitHub's) is not mistaken for the API", answer.hit === "/api/health" && !q.state().serverOk && /redirectcheck\.org/.test(ids.tracenote.textContent));
  q = mk(null, "file:"); answer.hit = null; await q.detectServer();
  t("page: opened from a file with no hopsApi, it doesn't probe anything", answer.hit === null && !q.state().serverOk);
  globalThis.window = {}; globalThis.location = { protocol: "file:" }; globalThis.fetch = realFetch;
}

{ // a good link reads as a success
  const G1 = "https://goto.walmart.com/c/1/2/3?u=https%3A%2F%2Fwww.walmart.com%2Fbrand%2F20084619", W = "https://www.walmart.com/brand/20084619";
  p.renderReport(DLCore.buildReport(DLCore.chainFromRedirectCheck({ url: "https://click2cart.com/x", redirects: [{ from: "https://click2cart.com/x", to: G1, status_code: 302, type: "http", headers: {} }, { from: G1, to: W, status_code: 301, type: "http", headers: {} }], final_result: { status_code: 200, content_type: "text/html" } })));
  o = ids.out.textContent;
  t("page: a good link shows 'This link works', no problems and no technical details", /This link works/.test(o) && !/This link has a problem/.test(o) && !walk(ids.out, (n) => /^issue/.test(n.className)).length && !walk(ids.out, (n) => n.tag === "details").length && !/Technical details/.test(o), o.slice(0, 300));
}

srv.close();
console.log(failed ? `\n${failed} FAILED` : "\nAll tests passed");
process.exit(failed ? 1 : 0);
