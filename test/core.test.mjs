// Offline tests for the checking logic (no network; the headless-Chrome tests use local pages). Run: node test/core.test.mjs
import core from "../public/js/core.js";
import routes from "../public/js/app-routes.js";
import { traceRedirects } from "../server/trace.mjs";

let failed = 0;
const t = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };
const find = (cs, st, re) => cs.find((c) => c.status === st && re.test(c.title));

const PG = "https://openapp.pgbuynow.com/?url=https://www.walmart.com/brand/febreze/febreze-bathroom/20045132?selectedSellerId=0?utm_source=meta&utm_medium=traffic&utm_campaign=bath_evergreen_092026&utm_term=febreze&fbclid=IwAB&utm_medium=paid&utm_source=fb";
const ENC1 = "https://goto.walmart.com/c/1/2/3?u=" + encodeURIComponent("https://www.walmart.com/brand/20045132?utm_source=fb");
const ENC2 = "https://goto.walmart.com/c/1/2/3?u=" + encodeURIComponent(encodeURIComponent("https://www.walmart.com/brand/20045132?utm_source=fb"));
const ENC3 = "https://x.example/r?next=" + encodeURIComponent(encodeURIComponent(encodeURIComponent("https://www.walmart.com/ip/1")));

// --- encoding levels
let e = core.analyzeEncoding(PG, "redirect.example");
t("level 0: unencoded nested url= is flagged and names the truncated params", find(e, "warn", /url= nested URL is NOT encoded \(level 0\)/) && /utm_medium/.test(find(e, "warn", /level 0/).detail), JSON.stringify(e.map((c) => c.title)));
t("level 0: second '?' inside nested URL is flagged", !!find(e, "warn", /more than one '\?'/));
e = core.analyzeEncoding(ENC1, "goto.walmart.com");
t("level 1: encoded once passes", !!find(e, "pass", /encoded once \(level 1, correct\)/) && !e.some((c) => c.status === "fail"));
e = core.analyzeEncoding(ENC2, "goto.walmart.com");
t("level 2: double-encoded fails on a Walmart host", !!find(e, "fail", /encoded 2 times \(level 2\)/));
e = core.analyzeEncoding(ENC3, "x.example");
t("level 3 on a third-party host: warns, says 3 times", !!find(e, "warn", /encoded 3 times/));
e = core.analyzeEncoding("https://goto.walmart.com/c/1?u=" + encodeURIComponent("https://www.walmart.com/x?url=" + encodeURIComponent(encodeURIComponent("https://www.walmart.com/ip/1"))), "goto.walmart.com");
t("recurses into the nested URL's own url= (u → url=)", !!find(e, "fail", /u → url= nested URL is encoded 2 times/), JSON.stringify(e.map((c) => c.title)));
t("whitespace, bad %, non-ASCII", !!find(core.analyzeEncoding("https://a.example/?a=1 2", "a.example"), "fail", /whitespace/) &&
  !!find(core.analyzeEncoding("https://a.example/?a=100%", "a.example"), "warn", /not a valid escape/) &&
  !!find(core.analyzeEncoding("https://a.example/?a=é", "a.example"), "warn", /non-ASCII/));

// --- leaked-params downgrade
e = core.analyzeEncoding(PG, "redirect.example");
const kept = core.downgradeLeaks(e, "https://goto.walmart.com/c/1?u=x&utm_medium=paid&utm_campaign=c&utm_term=t&fbclid=I&utm_source=fb");
const lost = core.downgradeLeaks(e, "https://goto.walmart.com/c/1?u=x");
t("leak: next hop carries the params -> info", !!find(kept, "info", /level 0.*nothing is lost/) && !find(kept, "warn", /level 0/));
t("leak: next hop dropped the params -> still warn", !!find(lost, "warn", /level 0/));

// --- app-opening detection
t("takeover: walmart:// hop", core.appTakeoverIndex([{ host: "a.example" }, { host: "walmart://", appScheme: true }]) === 1);
t("takeover: goto first", core.appTakeoverIndex([{ host: "a.example" }, { host: "goto.walmart.com" }, { host: "www.walmart.com" }]) === 1);
t("takeover: www.walmart.com counts", core.appTakeoverIndex([{ host: "a.example" }, { host: "www.walmart.com" }]) === 1);
t("takeover: http:// hop on www.walmart.com does not count, https does", core.appTakeoverIndex([{ host: "www.walmart.com", url: "http://www.walmart.com/x" }, { host: "www.walmart.com", url: "https://www.walmart.com/x" }]) === 1);
t("takeover: bare walmart.com is not in the app-opening list", core.appTakeoverIndex([{ host: "walmart.com", url: "https://walmart.com/x" }]) === -1);
t("takeover: none", core.appTakeoverIndex([{ host: "a.example" }, { host: "b.example" }]) === -1);

// --- path checks
t("path: brand route recognised", core.analyzePath("https://www.walmart.com/brand/febreze/20045132").some((c) => /brand route/.test(c.title)));
t("path: encoded slash fails", core.analyzePath("https://www.walmart.com/brand%2Ffebreze%2F1").some((c) => c.status === "fail" && /%2F/.test(c.title)));
t("path: walmart:// embedded URL fails", core.analyzePath("walmart://https%3A%2F%2Fwww.walmart.com%2Fbrand").some((c) => c.status === "fail"));
t("path: walmart:/// noted, path shown without a doubled slash", core.analyzePath("walmart:///brand/febreze/111").some((c) => /three slashes/.test(c.title)) && core.analyzePath("walmart:///brand/febreze/111").some((c) => c.extra && c.extra.show && c.extra.show[0][1] === "/brand/febreze/111"));
t("path: expect id mismatch", core.analyzePath("walmart://brand/febreze/111", "brand", "222").some((c) => c.status === "fail" && /ID differs/.test(c.title)));

// --- full chains with a fake network
const net = (routes) => async (u) => { const [st, loc, body] = routes[u] || [404]; return new Response(body || "", { status: st, headers: { ...(loc ? { location: loc } : {}), ...(body ? { "content-type": "text/html" } : {}) } }); };
const base = { allowAnyPublic: true, lookup: async () => [{ address: "8.8.8.8" }] };
let r = await traceRedirects("https://openapp.pgbuynow.com/?url=x", { ...base, fetchImpl: net({
  "https://openapp.pgbuynow.com/?url=x": [200, null, `<script>window.location.href = "${ENC1}";</script>`],
  [ENC1]: [302, "https://www.walmart.com/brand/20045132?utm_source=fb"],
  "https://www.walmart.com/brand/20045132?utm_source=fb": [200] }) });
t("chain: pgbuynow (JS) → goto → www.walmart.com: app opens at hop 2", r.hops.length === 3 && r.hops[0].via === "javascript" && core.appTakeoverIndex(r.hops) === 1, JSON.stringify(r.hops.map((h) => h.host)));
t("chain: passes with no failures", !core.analyzeChain(r).checks.some((c) => c.status === "fail"), JSON.stringify(core.analyzeChain(r)));
r = await traceRedirects("https://a.example/1", { ...base, fetchImpl: net({ "https://a.example/1": [302, "https://b.example/2"], "https://b.example/2": [302, "https://c.example/3"], "https://c.example/3": [200] }) });
t("chain: three third-party hops, no Walmart → FAIL 'Never reaches'", r.hops.length === 3 && !!find(core.analyzeChain(r).checks, "fail", /Never reaches/));
r = await traceRedirects("https://a.example/1", { ...base, fetchImpl: net({ "https://a.example/1": [302, "walmart://brand/febreze/20045132?utm_source=fb"] }) });
t("chain: ends at walmart:// → app opens at hop 2, pass", core.appTakeoverIndex(r.hops) === 1 && !!find(core.analyzeChain(r).checks, "pass", /app-opening Walmart URL at hop 2/), JSON.stringify(core.analyzeChain(r)));
r = await traceRedirects("https://a.example/1", { ...base, fetchImpl: net({ "https://a.example/1": [302, "https://www.walmart.com/brand/1"], "https://www.walmart.com/brand/1": [200] }) });
t("chain: www.walmart.com opens the app but is flagged as not a verified applinks domain", !!find(core.analyzeChain(r).checks, "pass", /hop 2 \(www\.walmart\.com\)/) && /not a verified applinks/.test(core.analyzeChain(r).checks.find((c) => /hop 2/.test(c.title)).detail));

// --- pgbuynow-style JS page (synthetic fixture holding only the fingerprinted code)
const PG_HTML = `<html><script>function getDestinationUrl(){ /* everything after url= */ }
function validWalmartURL(u){return u.includes("https://www.walmart.com/")}
const x = \`walmart://\${path}\${query}\`;</script></html>`;
const PGU = "https://openapp.pgbuynow.com/?url=https://www.walmart.com/brand/febreze/20045132?selectedSellerId=0?utm_source=meta&utm_medium=paid&fbclid=abc";
const DEST = "https://www.walmart.com/brand/febreze/20045132?selectedSellerId=0?utm_source=meta&utm_medium=paid&fbclid=abc";
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const pgNet = (html) => net({ [PGU]: [200, null, html], [DEST]: [200] });
r = await traceRedirects(PGU, { ...base, userAgent: IOS, fetchImpl: pgNet(PG_HTML) });
t("pgbuynow iOS: page → walmart:// (hidden iframe) → www.walmart.com", r.hops.length === 3 && r.hops[1].appScheme && r.hops[1].url === "walmart:///brand/febreze/20045132?selectedSellerId=0?utm_source=meta&utm_medium=paid&fbclid=abc" && r.hops[2].host === "www.walmart.com", JSON.stringify(r.hops.map((h) => h.url)));
t("pgbuynow iOS: app opens at the walmart:// hop (2), not at www.walmart.com", core.appTakeoverIndex(r.hops) === 1);
t("pgbuynow: chain notes emulation and the web fallback", core.analyzeChain(r).checks.some((c) => /emulated, not executed/.test(c.title)) && core.analyzeChain(r).checks.some((c) => /hidden iframe/.test(c.title)));
r = await traceRedirects(PGU, { ...base, userAgent: "Mozilla/5.0 (Macintosh) Safari/605", fetchImpl: pgNet(PG_HTML) });
t("pgbuynow desktop: no walmart:// launch, goes to www.walmart.com", r.hops.length === 2 && !r.hops.some((h) => h.appScheme) && core.appTakeoverIndex(r.hops) === 1);
r = await traceRedirects(PGU, { ...base, userAgent: IOS, fetchImpl: pgNet(PG_HTML.replace("getDestinationUrl", "somethingElse")) });
t("pgbuynow: changed page is NOT guessed (reported unknown, with mentions)", r.hops.length === 1 && r.hops[0].htmlNoRedirect && r.hops[0].mentions.includes("walmart://"), JSON.stringify(r.hops));
e = core.analyzeEncoding(PGU, "openapp.pgbuynow.com");
t("pgbuynow: unencoded url= is NOT a false-positive warning, but the second '?' is flagged", !e.some((c) => /NOT encoded/.test(c.title)) && !!find(e, "pass", /plain \(level 0\)/) && !!find(e, "warn", /more than one '\?'/), JSON.stringify(e.map((c) => c.title)));
e = core.analyzeEncoding("https://openapp.pgbuynow.com/?url=" + encodeURIComponent(encodeURIComponent("https://www.walmart.com/ip/1")), "openapp.pgbuynow.com");
t("pgbuynow: double-encoded url= fails (page decodes once)", !!find(e, "fail", /encoded 2 times/));

// --- JavaScript pages run in a (stub) headless browser
{
  const JSU = "https://jsredir.example/go";
  const jsNet = net({ [JSU]: [200, null, "<html><script>/* builds the URL at runtime */</script></html>"], [DEST]: [200], [ENC1]: [302, "https://www.walmart.com/brand/20045132?utm_source=fb"], "https://www.walmart.com/brand/20045132?utm_source=fb": [200] });
  const stub = (navigations, extra = {}) => { const calls = []; return { calls, available: true, run: async (u, ua, o) => { calls.push({ u, ua, vet: typeof (o && o.vetUrl) }); return { navigations, blocked: [], ms: 1200, error: null, ...extra }; } }; };
  let s = stub([{ kind: "iframe", url: "walmart://brand/20045132", top: true }, { kind: "navigate", url: DEST, top: true }]);
  r = await traceRedirects(JSU, { ...base, userAgent: IOS, fetchImpl: jsNet, jsRunner: s });
  t("js: iframe walmart:// then location → app hop + web hop, marked executed", r.hops.length === 3 && r.hops[0].jsExecuted && r.hops[1].appScheme && /hidden iframe/.test(r.hops[1].via) && r.hops[1].fallbackUrl === DEST && r.hops[2].url === DEST && s.calls[0].vet === "function", JSON.stringify(r.hops));
  t("js: chain says it was run in headless Chrome", core.analyzeChain(r).checks.some((c) => /run in headless Chrome as an iPhone/.test(c.title)));
  const rep = core.buildReport(r);
  t("js: Android judged on the web hop (generic note, not the pgbuynow one)", rep.appDestination.android.notes.some((n) => /was run as an iPhone/.test(n)), JSON.stringify(rep.appDestination.android.notes));
  r = await traceRedirects(JSU, { ...base, userAgent: IOS, fetchImpl: jsNet, jsRunner: stub([{ kind: "navigate", url: ENC1, top: true }]) });
  t("js: location → goto.walmart.com is followed with real HTTP from there", r.hops.length === 3 && r.hops[1].host === "goto.walmart.com" && r.hops[1].status === 302 && core.appTakeoverIndex(r.hops) === 1, JSON.stringify(r.hops.map((h) => h.url)));
  r = await traceRedirects(JSU, { ...base, userAgent: IOS, fetchImpl: jsNet, jsRunner: stub([{ kind: "navigate", url: "walmart://ip/5", top: true }]) });
  t("js: location → walmart:// ends the chain at the app", r.hops.length === 2 && r.hops[1].appScheme && r.hops[1].url === "walmart://ip/5");
  r = await traceRedirects(JSU, { ...base, userAgent: IOS, fetchImpl: jsNet, jsRunner: stub([]) });
  t("js: page that goes nowhere → unknown, says JS was run", r.hops.length === 1 && r.hops[0].htmlNoRedirect && r.hops[0].jsRan && /running its JavaScript in headless Chrome/.test(find(core.analyzeChain(r).checks, "warn", /could not read a redirect/).detail));
  t("js: summary says it didn't go anywhere even after running JS", /even after running its JavaScript/.test(core.friendlySummary(core.buildReport(r)).pillars[0].text));
  r = await traceRedirects(PGU, { ...base, userAgent: IOS, fetchImpl: pgNet(PG_HTML), jsRunner: stub([], { error: "browser exited" }) });
  t("js: browser failure falls back to the pgbuynow emulation", r.hops.length === 3 && r.hops[0].emulated && !r.hops[0].jsRan && r.hops[0].js.error === "browser exited");
  r = await traceRedirects(JSU, { ...base, userAgent: IOS, fetchImpl: net({ [JSU]: [200, null, `<meta http-equiv="refresh" content="0;url=${DEST}">`], [DEST]: [200] }), jsRunner: s = stub([]) });
  t("js: static redirects never start the browser", s.calls.length === 0 && r.hops.length === 2);
  r = await traceRedirects(DEST, { ...base, userAgent: IOS, fetchImpl: net({ [DEST]: [200, null, "<html></html>"] }), jsRunner: s = stub([]) });
  t("js: walmart.com pages are never run", s.calls.length === 0);
}

// --- the server keeps its own copy of the redirector list and the pgbuynow logic (it doesn't load core.js): they must match
{
  const T = await import("../server/trace.mjs");
  t("server copy: KNOWN_REDIRECTORS match core.js", JSON.stringify(T.KNOWN_REDIRECTORS) === JSON.stringify(core.KNOWN_REDIRECTORS));
  const AND = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/124.0 Mobile Safari/537.36";
  const same = [IOS, AND, "Mozilla/5.0 (Macintosh) Safari/605"].every((ua) => JSON.stringify(T.emulateKnownPage(new URL(PGU), PG_HTML, ua)) === JSON.stringify(core.emulateKnownRedirector(PGU, ua)));
  t("server copy: pgbuynow emulation matches core.js for iPhone, Android and desktop", same);
}

// --- redirectcheck.org can't run JavaScript: a known redirector page is filled in (unverified)
{
  const resp = { url: PGU, redirects: [], final_result: { status_code: 200, content_type: "text/html" } };
  const ch = core.chainFromRedirectCheck(resp);
  t("redirectcheck: pgbuynow end page is filled in → walmart:// → www (not fetched)", ch.hops.length === 3 && ch.hops[0].emulated && ch.hops[0].unverified && ch.hops[1].appScheme && ch.hops[2].notFetched && ch.hops[2].host === "www.walmart.com" && ch.warnings.some((w) => /can't run JavaScript/.test(w)), JSON.stringify(ch.hops));
  const rep = core.buildReport(ch), F = core.friendlySummary(rep);
  t("redirectcheck: pillars are answered, not 'couldn't check'", F.pillars[0].state !== "cant" && F.pillars[1].state === "ok" && /own server/.test(F.pillars[1].text), JSON.stringify(F.pillars.map((p) => [p.state, p.text])));
  t("redirectcheck: last hop flagged as not fetched, not 'ended normally'", core.analyzeChain(ch).checks.some((c) => /not fetched/.test(c.title)) && !core.analyzeChain(ch).checks.some((c) => /ended normally/.test(c.title)));
  const other = core.chainFromRedirectCheck({ url: "https://jsredir.example/go", redirects: [], final_result: { status_code: 200, content_type: "text/html" } });
  t("redirectcheck: unknown JS page stays 'unknown' and points to ./serve", other.hops.length === 1 && other.hops[0].htmlNoRedirect && /own server/.test(core.friendlySummary(core.buildReport(other)).pillars[0].text));
}

// --- real headless Chrome against local fixture pages (skipped when no Chrome/Chromium/Edge is installed)
{
  const { createJsRunner, findChrome } = await import("../server/headless.mjs");
  if (!findChrome() || process.env.SKIP_BROWSER_TESTS === "1") console.log("SKIP  headless Chrome tests (no browser found or SKIP_BROWSER_TESTS=1)");
  else {
    const http = await import("node:http");
    const pages = {
      "/iframe": `<script>var f=document.createElement('iframe');f.style.display='none';f.src="walmart://brand/x/"+(40+2);document.documentElement.appendChild(f);setTimeout(function(){location.href="https://www.walmart.com/brand/x/42"},300)</script>`,
      "/replace": `<script>location.replace(["walmart:", "", "ip", 7].join("/"))</script>`,
      "/nowhere": `<p>hello</p>`,
      "/internal": `<script>fetch("http://10.1.2.3/secret").catch(()=>{});setTimeout(function(){location.href="https://www.walmart.com/ip/1"},200)</script>`,
    };
    const srv = http.createServer((q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(pages[q.url] || ""); });
    await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
    const B = `http://127.0.0.1:${srv.address().port}`;
    const R = createJsRunner({ settleMs: 800, proxy: null, vetUrl: async (u) => (u.hostname === "127.0.0.1" ? null : /^10\./.test(u.hostname) ? "private address" : null) });
    try {
      let x = await R.run(B + "/iframe", IOS);
      t("chrome: hidden iframe app link and the next page are both recorded", x.navigations.length === 2 && x.navigations[0].kind === "iframe" && x.navigations[0].url === "walmart://brand/x/42" && x.navigations[1].url === "https://www.walmart.com/brand/x/42", JSON.stringify(x));
      x = await R.run(B + "/replace", IOS);
      t("chrome: location.replace to walmart:// is recorded (and cancelled)", x.navigations.length === 1 && x.navigations[0].url === "walmart://ip/7", JSON.stringify(x));
      x = await R.run(B + "/nowhere", IOS);
      t("chrome: a page that goes nowhere settles with no navigations", !x.error && x.navigations.length === 0 && x.ended === "settled", JSON.stringify(x));
      x = await R.run(B + "/internal", IOS);
      t("chrome: requests to private addresses are blocked", x.blocked.some((b) => /10\.1\.2\.3/.test(b.url)) && x.navigations.some((n) => n.url === "https://www.walmart.com/ip/1"), JSON.stringify(x));
    } finally { await R.close(); srv.close(); }
  }
}

{ // proxy 407 on the first hop says nothing about the destination: warn, never "Never reaches an approved Walmart link"
  const c407 = core.analyzeChain({ stopped: "done", hops: [{ url: "https://third-party.example/x", host: "third-party.example", status: 407 }] }).checks;
  t("chain: 407 on hop 1 warns and does not claim the link never reaches Walmart", !!find(c407, "warn", /407/) && !c407.some((c) => c.status === "fail"), JSON.stringify(c407));
  // failing to FETCH the app-opening hop (goto) is the tracer's network, the verdict does not depend on it
  const GOTO = "https://goto.walmart.com/c/1/2/3?u=" + encodeURIComponent("https://www.walmart.com/brand/20045132");
  const cg = core.analyzeChain({ stopped: "error", hops: [{ url: "https://click2cart.com/pdp", host: "click2cart.com", status: 302 }, { url: GOTO, host: "goto.walmart.com", status: null, error: "Request failed: Unable to connect" }] }).checks;
  t("chain: failed fetch of the app-opening hop is a warning, app-open still passes", !!find(cg, "warn", /Could not fetch the app-opening hop/) && !!find(cg, "pass", /Reaches an app-opening/) && !cg.some((c) => c.status === "fail"), JSON.stringify(cg));
  const cm = core.analyzeChain({ stopped: "error", hops: [{ url: "https://click2cart.com/pdp", host: "click2cart.com", status: 302 }, { url: "https://mid.example/", host: "mid.example", status: null, error: "Request failed: ECONNRESET" }] }).checks;
  t("chain: failed fetch of a middle hop is still a failure", !!find(cm, "fail", /A hop failed/), JSON.stringify(cm));
}

{ /* ---- redirectcheck.org API response -> chain (fixture = a real response for the click2cart campaign link, URLs shortened) ---- */
  const CLICK = "https://click2cart.com/pdp?service=sc&linkid=95799&pid=31183685&utm_medium=paid&utm_source=fb";
  const GOTO2 = "https://goto.walmart.com/c/2194827/568844/9383?u=https%253A%252F%252Fwww.walmart.com%252Fbrand%252Ffebreze%252Fcrisp-fall-breeze%252F20084619%253F%2526utm_source%253DMeta%2526utm_medium%253Dsocial&subid1=d0540a45&veh=aff&sourceid=imp_000011112222333344";
  const WM = "https://www.walmart.com/brand/febreze/crisp-fall-breeze/20084619?&utm_source=Meta&utm_medium=social&clickid=zVNX&irgwc=1";
  const BLK = "https://www.walmart.com/blocked?url=L2JyYW5kL2Zl&uuid=33807e39&vid=&g=b";
  const API = { url: CLICK, warnings: [], loop: { detected: false, start_step: null }, total_duration: 778,
    redirects: [
      { from: CLICK, to: GOTO2, status_code: 302, type: "http", duration: 324, headers: { server: "cloudflare", location: GOTO2 } },
      { from: GOTO2, to: WM, status_code: 301, type: "http", duration: 78, headers: { server: "cloudflare" } },
      { from: WM, to: BLK, status_code: 307, type: "http", duration: 287, headers: { server: "cloudflare" } }],
    final_result: { final_url: BLK, status_code: 200, server: "cloudflare", content_type: "text/html; charset=utf-8" } };
  const ch = core.chainFromRedirectCheck(API);
  t("api: 3 redirects become 4 hops with each hop's own status", ch.hops.map((h) => h.host + ":" + h.status).join() === "click2cart.com:302,goto.walmart.com:301,www.walmart.com:307,www.walmart.com:200", JSON.stringify(ch.hops.map((h) => [h.host, h.status])));
  t("api: hop 1 is the pasted link, hop 2 is the Location it returned", ch.hops[0].url === CLICK && ch.hops[1].url === GOTO2 && ch.hops[0].nextUrl === GOTO2 && ch.hops[0].ms === 324);
  const R = core.buildReport(ch);
  t("api: the app takes over at goto (hop 2)", R.appOpensAtHop === 2, String(R.appOpensAtHop));
  const encFail = (i) => R.encoding.find((e) => e.i === i).checks.find((c) => c.status === "fail" && /encoded 2 times/.test(c.title));
  t("api: double-encoded u= is flagged FAIL on the goto hop", !!encFail(1) && R.verdict === "FAIL" && R.exitCode === 1, JSON.stringify(R.encoding.map((e) => [e.i, e.checks.map((c) => c.status + ":" + c.title)])));
  t("api: the clean www.walmart.com hop after it is NOT flagged for encoding (the redirect decoded it, the app never sees that)", !R.encoding.find((e) => e.i === 2).checks.some((c) => c.status === "fail"));
  t("api: blames the redirect that introduced the double-encoding", R.chainChecks.some((c) => c.status === "fail" && /introduced by the redirect from click2cart\.com to goto\.walmart\.com/.test(c.title)));
  t("api: Walmart /blocked page is info, not a failure", R.chainChecks.some((c) => c.status === "info" && /bot protection/.test(c.title)) && !R.chainChecks.some((c) => c.status === "fail" && /blocked|HTTP/.test(c.title)));
  t("api: takeover section reports the malformed app deeplink", (R.takeover || []).flatMap((g) => g.checks).some((c) => c.status === "fail" && /malformed/.test(c.title)));
  // single-encoded variant passes
  const OK = GOTO2.replace(/%25/g, "%");
  const R2 = core.buildReport(core.chainFromRedirectCheck({ ...API, redirects: [{ ...API.redirects[0], to: OK, headers: { server: "cloudflare", location: OK } }, { ...API.redirects[1], from: OK }, API.redirects[2]] }));
  t("api: the same link encoded once has no FAIL", R2.verdict !== "FAIL", JSON.stringify(R2.fails.map((c) => c.title)));
  // edge cases
  t("api: no redirects -> single hop", core.chainFromRedirectCheck({ url: "https://www.walmart.com/ip/1", redirects: [], final_result: { status_code: 200 } }).hops.length === 1);
  const sch = core.chainFromRedirectCheck({ url: "https://x.example/a", redirects: [{ from: "https://x.example/a", to: "walmart://brand/1", status_code: 302, type: "http" }], final_result: {} });
  t("api: redirect to walmart:// is an app-scheme hop", sch.hops[1].appScheme === true && core.appTakeoverIndex(sch.hops) === 1);
  const mr = core.chainFromRedirectCheck({ url: "https://x.example/a", redirects: [{ from: "https://x.example/a", to: "https://goto.walmart.com/c/1", status_code: 200, type: "meta" }], final_result: { status_code: 200 } });
  t("api: meta-refresh redirects are marked via meta", mr.hops[0].via === "meta");
  t("api: loop is reported", core.chainFromRedirectCheck({ url: "https://a.example/", redirects: [], loop: { detected: true }, final_result: {} }).stopped === "loop");
  const third = core.chainFromRedirectCheck({ url: "https://a.example/", redirects: [{ from: "https://a.example/", to: "https://b.example/", status_code: 302, type: "http" }], final_result: { status_code: 200, content_type: "text/html" } });
  const tc = core.analyzeChain(third).checks;
  t("api: ends on a non-Walmart HTML page => unknown (warn), not 'Never reaches'", tc.some((c) => c.status === "warn" && /could not read a redirect/.test(c.title)) && !tc.some((c) => /Never reaches/.test(c.title)), JSON.stringify(tc.map((c) => c.status + ":" + c.title)));
  let threw = ""; try { core.chainFromRedirectCheck({ error: "Invalid URL" }); } catch (e) { threw = e.message; }
  t("api: error response throws a readable message", /redirectcheck\.org: Invalid URL/.test(threw), threw);
  threw = ""; try { core.chainFromRedirectCheck("<html>"); } catch (e) { threw = e.message; }
  t("api: non-JSON-object response throws", /Unexpected response/.test(threw), threw);
}

{ /* ---- "what does the app get before the next hop decodes it" ---- */
  const CLICK = "https://click2cart.com/pdp?service=sc&linkid=95799";
  const G2 = "https://goto.walmart.com/c/2194827/568844/9383?u=https%253A%252F%252Fwww.walmart.com%252Fbrand%252Ffebreze%252Fcrisp-fall-breeze%252F20084619%253F%2526utm_source%253DMeta&veh=aff";
  const WMD = "https://www.walmart.com/brand/febreze/crisp-fall-breeze/20084619?&utm_source=Meta&clickid=zVNX&irgwc=1";
  const mk = (g) => core.chainFromRedirectCheck({ url: CLICK, redirects: [{ from: CLICK, to: g, status_code: 302, type: "http", headers: { location: g } }, { from: g, to: WMD, status_code: 301, type: "http", headers: { location: WMD } }], final_result: { status_code: 200 } });
  const V = core.buildReport(mk(G2)).appView;
  t("appView: app is handed the raw goto URL from hop 1's Location, never the decoded next hop", V.hop === 2 && V.kind === "goto" && V.appReceives === G2);
  t("appView: shows u= as written, after the app's ONE decode (still an encoded string), and fully decoded", V.levels.length === 3 && V.levels[0].value.startsWith("https%253A") && V.levels[1].value.startsWith("https%3A%2F%2F") && V.levels[1].app === true && V.levels[2].value.startsWith("https://www.walmart.com/brand/"), JSON.stringify(V.levels.map((l) => l.value.slice(0, 30))));
  t("appView: the walmart:// route the app builds is malformed", V.malformed === true && /^walmart:\/\/https%253A/.test(V.route), V.route);
  t("appView: next hop (web redirect) matches the fully decoded URL, so web works while the app bounces", V.webNext === WMD && V.webMatchesFull === true);
  const V1 = core.buildReport(mk(G2.replace(/%25/g, "%"))).appView;
  t("appView: encoded once -> clean route, 2 levels, not malformed", V1.malformed === false && V1.levels.length === 2 && /^walmart:\/\/brand\/febreze\/crisp-fall-breeze\/20084619/.test(V1.route), JSON.stringify(V1));
  t("appView: none when the chain never opens the app", core.buildReport(core.chainFromRedirectCheck({ url: "https://a.example/", redirects: [], final_result: { status_code: 200 } })).appView === null);
  const W = core.buildAppView([{ url: "https://www.walmart.com/brand/x/1?utm=a", host: "www.walmart.com" }], 0);
  t("appView: plain www.walmart.com hop gets an (approximate) route", W.kind === "other" && W.approximate === true && W.route === "walmart://brand/x/1?utm=a" && !W.malformed, JSON.stringify(W));
  // `to` and Location disagree: the header is what a client follows
  const odd = core.chainFromRedirectCheck({ url: CLICK, redirects: [{ from: CLICK, to: "https://goto.walmart.com/decoded-by-api", status_code: 302, type: "http", headers: { location: G2 } }], final_result: { status_code: 200 } });
  t("api: Location header wins over `to` when they differ, with a note", odd.hops[1].url === G2 && odd.warnings.some((w) => /Location header was used/.test(w)), JSON.stringify([odd.hops[1].url, odd.warnings]));
  const rel = core.chainFromRedirectCheck({ url: "https://www.walmart.com/a", redirects: [{ from: "https://www.walmart.com/a", to: "https://www.walmart.com/b?x=1", status_code: 307, type: "http", headers: { location: "/b?x=1" } }], final_result: { status_code: 200 } });
  t("api: relative Location resolving to `to` raises no warning", rel.warnings.length === 0 && rel.hops[1].url === "https://www.walmart.com/b?x=1");
}

{ /* ---- plain-English summary (three pillars) ---- */
  const CLICK = "https://click2cart.com/pdp?service=sc&linkid=95799";
  const G2 = "https://goto.walmart.com/c/2194827/568844/9383?u=https%253A%252F%252Fwww.walmart.com%252Fbrand%252Ffebreze%252Fcrisp-fall-breeze%252F20084619%253F%2526utm_source%253DMeta&veh=aff";
  const G1 = G2.replace(/%25/g, "%");
  const WMD = "https://www.walmart.com/brand/febreze/crisp-fall-breeze/20084619?&utm_source=Meta&clickid=zVNX";
  const rep = (g) => core.buildReport(core.chainFromRedirectCheck({ url: CLICK, redirects: [{ from: CLICK, to: g, status_code: 302, type: "http", headers: { location: g } }, { from: g, to: WMD, status_code: 301, type: "http", headers: { location: WMD } }], final_result: { status_code: 200, content_type: "text/html" } }));
  const bad = core.friendlySummary(rep(G2));
  t("summary: double-encoded link => overall problem, pillar 1 and 2 bad, pillar 3: iPhone falls back to the website, Android reaches the brand page", bad.overall.state === "bad" && bad.pillars.map((x) => x.state).join() === "bad,bad,warn" &&
    bad.pillars[2].rows[0].platform === "iPhone" && bad.pillars[2].rows[0].state === "warn" && /Safari/.test(bad.pillars[2].rows[0].text) &&
    bad.pillars[2].rows[1].platform === "Android" && bad.pillars[2].rows[1].short === "Brand page (brand ID 20084619)" && /On Android the app follows the web redirect/.test(bad.pillars[1].text), JSON.stringify(bad.pillars.map((x) => [x.state, x.headline, x.rows])));
  const i1 = bad.pillars[0].issues[0];
  t("summary: explains the cause in plain words, names the redirect that adds it, and offers the corrected link", /encoded 2 times/.test(i1.text) && /click2cart\.com redirects to goto\.walmart\.com/.test(i1.text) && /encode the destination only once/.test(i1.fix) && /^https:\/\/goto\.walmart\.com\/.*u=https%3A%2F%2F/.test(i1.copy || ""), JSON.stringify(i1).slice(0, 400));
  t("summary: pillar 2 says it opens the app then falls back to the website", /opens the app, then falls back to the website/.test(bad.pillars[1].headline));
  t("summary: journey flags the goto hop and marks where the app opens", bad.journey.length === 3 && bad.journey[1].opens === true && bad.journey[1].flag && bad.journey[1].flag.tone === "bad" && !bad.journey[2].flag, JSON.stringify(bad.journey.map((j) => [j.label, j.status, j.opens, j.flag])));
  t("summary: no raw technical words leak into the headline text", !/u=|%25|hop \d|walmart:\/\/https/.test(JSON.stringify(bad.pillars.map((x) => [x.headline, x.text, x.issues.map((i) => i.text)]))), JSON.stringify(bad.pillars.map((x) => [x.headline, x.text])));
  const good = core.friendlySummary(rep(G1));
  t("summary: link encoded once => 'This link works', all ok, lands on the brand page on both apps", good.overall.state === "ok" && good.overall.title === "This link works" && good.pillars.map((x) => x.state).join() === "ok,ok,ok" &&
    good.pillars[2].headline === "Brand page (brand ID 20084619)" && /on the Brand page \(brand ID 20084619\)\.$/.test(good.overall.text), JSON.stringify([good.overall, good.pillars.map((x) => [x.state, x.headline])]));
  const un = core.friendlySummary(core.buildReport({ startUrl: CLICK, stopped: "done", hops: [{ url: CLICK, host: "click2cart.com", status: 407 }] }));
  t("summary: first host unreachable (proxy 407) => can't tell, never 'problem'", un.overall.state === "cant" && un.pillars[0].state === "cant" && un.pillars[1].state === "cant", JSON.stringify(un.pillars.map((x) => x.state)));
  const nw = core.friendlySummary(core.buildReport(core.chainFromRedirectCheck({ url: "https://a.example/", redirects: [{ from: "https://a.example/", to: "https://b.example/", status_code: 302, type: "http", headers: {} }], final_result: { status_code: 404 } })));
  t("summary: chain ending in an error page that never reaches Walmart => problem with plain wording", nw.overall.state === "bad" && /error page/.test(nw.pillars[0].issues.map((i) => i.text).join(" ")) && nw.pillars[1].state === "bad", JSON.stringify(nw.pillars.map((x) => [x.state, x.issues.map((i) => i.text)])));
  const nn = core.friendlySummary(core.buildReport(core.chainFromRedirectCheck({ url: "https://a.example/", redirects: [{ from: "https://a.example/", to: "https://b.example/", status_code: 302, type: "http", headers: {} }], final_result: { status_code: 200, content_type: "application/pdf" } })));
  t("summary: completed chain that never reaches Walmart => 'doesn't end up on a Walmart address'", /doesn't end up on a Walmart address/.test(nn.pillars[0].issues.map((i) => i.text).join(" ")) && nn.overall.state === "bad", JSON.stringify(nn.pillars.map((x) => [x.state, x.issues.map((i) => i.text)])));
  const un2 = core.friendlySummary(core.buildReport({ startUrl: CLICK, stopped: "done", untraced: true, hops: [{ url: CLICK, host: "click2cart.com", status: null }] }));
  t("summary: untraced non-Walmart link => pillar 2 can't tell (not a problem)", un2.pillars[1].state === "cant" && un2.overall.state !== "bad", JSON.stringify(un2.pillars.map((x) => x.state)));
  const un3 = core.friendlySummary(core.buildReport({ startUrl: G2, stopped: "done", untraced: true, hops: [{ url: G2, host: "goto.walmart.com", status: null }] }));
  t("summary: untraced pasted goto link still flags the double-encoding", un3.pillars[0].state === "bad" && un3.pillars[1].state === "bad", JSON.stringify(un3.pillars.map((x) => x.state)));
  const sc = core.friendlySummary(core.buildReport(core.chainFromRedirectCheck({ url: "https://x.example/a", redirects: [{ from: "https://x.example/a", to: "walmart://brand/1", status_code: 302, type: "http", headers: {} }], final_result: {} })));
  t("summary: walmart:// redirect opens the app (needs the app installed)", sc.pillars[1].state === "ok" && /only works if the app is installed/.test(sc.pillars[1].text), JSON.stringify(sc.pillars[1]));
  const q = core.friendlySummary(core.buildReport({ startUrl: "x", stopped: "done", hops: [{ url: "https://openapp.pgbuynow.com/?url=" + "https://www.walmart.com/brand/x/1?a=0?b=1&c=2", host: "openapp.pgbuynow.com", status: 200 }, { url: "walmart:///brand/x/1", host: "walmart://", status: null, appScheme: true }] }));
  t("summary: stray second '?' is a gentle warning, overall still sendable", q.pillars[0].state === "warn" && q.overall.state === "warn" && /stray question mark/.test(q.pillars[0].issues[0].text), JSON.stringify(q.pillars.map((x) => [x.state, x.issues.map((i) => i.text)])));
}

{ /* ---- cases the advisor flagged: don't turn "unknown" into a verdict, count causes not pillars ---- */
  const PG = "https://openapp.pgbuynow.com/?url=https://www.walmart.com/brand/febreze/febreze-bathroom/20045132?selectedSellerId=0";
  const pg = core.friendlySummary(core.buildReport(core.chainFromRedirectCheck({ url: PG.replace("openapp.pgbuynow.com", "unknown-js-redirector.example"), redirects: [], final_result: { status_code: 200, content_type: "text/html; charset=utf-8" } })));
  t("summary: unknown JS-redirect page seen through the API (no redirects, 200 HTML) => can't tell, not 'won't open the app'", pg.pillars[0].state === "cant" && pg.pillars[1].state === "cant" && pg.overall.state === "cant" && /JavaScript/.test(pg.pillars[1].text), JSON.stringify([pg.overall, pg.pillars.map((x) => x.state)]));
  const CL = "https://click2cart.com/pdp?service=sc&linkid=95799";
  const ut = core.friendlySummary(core.buildReport({ startUrl: CL, stopped: "done", untraced: true, hops: [{ url: CL, host: "click2cart.com", status: null }] }));
  t("summary: untraced link that isn't a Walmart address => pillar 1 can't tell (never a green 'valid')", ut.pillars[0].state === "cant" && ut.pillars[1].state === "cant" && ut.overall.state === "cant", JSON.stringify(ut.pillars.map((x) => x.state)));
  const GOOD = "https://goto.walmart.com/c/1/2/3?u=https%3A%2F%2Fwww.walmart.com%2Fbrand%2F20084619";
  const ug = core.friendlySummary(core.buildReport({ startUrl: GOOD, stopped: "done", untraced: true, hops: [{ url: GOOD, host: "goto.walmart.com", status: null }] }));
  t("summary: untraced but already a goto link => still judged (valid + opens the app)", ug.pillars[0].state === "ok" && ug.pillars[1].state === "ok", JSON.stringify(ug.pillars.map((x) => x.state)));
  const G2 = "https://goto.walmart.com/c/1/2/3?u=https%253A%252F%252Fwww.walmart.com%252Fbrand%252F20084619";
  const one = core.friendlySummary(core.buildReport({ startUrl: G2, stopped: "done", untraced: true, hops: [{ url: G2, host: "goto.walmart.com", status: null }] }));
  t("summary: one root cause (double encoding) affecting two pillars is reported as ONE thing to fix", /^One thing needs fixing/.test(one.overall.text), one.overall.text);
  const two = core.friendlySummary(core.buildReport({ startUrl: "x", stopped: "done", hops: [{ url: "https://a.example/", host: "a.example", status: 302 }, { url: "https://b.example/", host: "b.example", status: 404 }] }));
  t("summary: several separate causes => 'A few things'", two.overall.state === "bad" && /^A few things|^One thing/.test(two.overall.text), two.overall.text);
}

{ /* ---- where it lands in the app (iOS glass-app + Android walmart-glass route tables) ---- */
  const toRoute = core.iosRoute;
  const H = (...urls) => urls.map((u) => (/^walmart/.test(u) ? { url: u, host: "walmart://", appScheme: true, status: null } : { url: u, host: new URL(u).hostname, status: 302 }));
  const land = (...urls) => { const hops = H(...urls); return routes.resolveDestinations(hops, core.appTakeoverIndex(hops), toRoute); };
  const both = (d) => [d.ios.outcome, d.ios.page, d.android.outcome, d.android.page].join("|");
  let d = land("https://www.walmart.com/brand/febreze/20084619");
  t("lands: brand web link -> Brand page on both, with the ID", both(d) === "page|Brand page|page|Brand page" && d.ios.detail === "brand ID 20084619" && d.ios.matched === "brand/*" && d.android.matched === "brand/.+", both(d));
  d = land("https://www.walmart.com/ip/Some-Thing/123456");
  t("lands: item page /ip/slug/id -> Item page (item ID) on both", both(d) === "page|Item page|page|Item page" && d.ios.detail === "item ID 123456" && d.ios.matched === "ip/*/:id", both(d));
  d = land("https://www.walmart.com/search?q=tv");
  t("lands: search -> Search results with the term", both(d) === "page|Search results|page|Search results" && /tv/.test(d.ios.detail), both(d) + d.ios.detail);
  d = land("https://www.walmart.com/es/ip/x/99");
  t("lands: /es/ locale prefix is stripped on both", d.ios.page === "Item page" && d.android.page === "Item page" && d.ios.detail === "item ID 99");
  d = land("https://www.walmart.com/some/unknown/path");
  t("lands: unknown walmart.com path -> iPhone opens Safari (web), Android never opens the app (not in manifest)", d.ios.outcome === "web" && d.android.outcome === "web" && d.android.opensApp === false && /manifest/.test(d.android.why), both(d));
  d = land("https://www.walmart.com/");
  t("lands: home page -> Android Home; iPhone notes the new router would open Home", d.android.outcome === "home" && d.android.page === "Home" && d.ios.alt && d.ios.alt.page === "Home", JSON.stringify([d.ios.outcome, d.ios.alt]));
  d = land("walmart://nope/x");
  t("lands: walmart:// link no page catches -> app opens on Home (success, Home)", d.ios.outcome === "home" && d.android.outcome === "home", both(d));
  d = land("walmart://cart");
  t("lands: walmart://cart -> Cart on both", both(d) === "page|Cart|page|Cart", both(d));
  d = land("https://www.walmart.com/cp/9145505");
  t("lands: redirect table (cp/9145505 -> ev) applied on both", d.ios.page === "EV charging" && d.android.page === "EV charging", both(d));
  d = land("https://www.walmart.com/ip/x/1?gbo=1");
  t("lands: gbo=1 -> iPhone opens Safari (Android ignores gbo for links from outside the app)", d.ios.outcome === "web" && d.android.page === "Item page", both(d));
  const G1 = "https://goto.walmart.com/c/1/2/3?u=" + encodeURIComponent("https://www.walmart.com/brand/febreze/crisp-fall-breeze/20084619?utm_source=fb");
  d = land("https://click2cart.com/x", G1, "https://www.walmart.com/brand/febreze/crisp-fall-breeze/20084619?utm_source=fb");
  t("lands: goto link encoded once -> Brand page on both (iPhone via ImpactLink, Android via the redirect)", both(d) === "page|Brand page|page|Brand page" && d.ios.hop === 2 && d.android.hop === 2, both(d));
  d = land("https://click2cart.com/x", core.LOGGED);
  t("lands: double-encoded goto -> iPhone falls back to Safari; Android (approximated) reaches the brand page", d.ios.outcome === "web" && d.android.page === "Brand page" && d.android.notes.some((n) => /couldn't follow goto/.test(n)), both(d));
  const pg = H("https://openapp.pgbuynow.com/?url=x", "walmart:///brand/febreze/febreze-bathroom/20045132?x=1", "https://www.walmart.com/brand/febreze/febreze-bathroom/20045132?x=1");
  pg[1].via = "page JS (emulated pgbuynow), hidden iframe";
  d = routes.resolveDestinations(pg, core.appTakeoverIndex(pg), toRoute);
  t("lands: pgbuynow (walmart:/// on iPhone) -> Brand page, with a three-slash note; Android judged on the web address", d.ios.page === "Brand page" && d.ios.notes.some((n) => /three slashes/.test(n)) && d.android.page === "Brand page" && d.android.hop === 3, both(d));
  t("lands: iOS legacy matcher — trailing * matches 0..n segments, middle * exactly one, :x needs a value", !!routes.iosLegacyMatch("brand/*", "/brand") && !!routes.iosLegacyMatch("brand/*", "/brand/a/b/c") && !!routes.iosLegacyMatch("ip/*/:id", "/ip/a/1") && !routes.iosLegacyMatch("ip/*/:id", "/ip/a/b/1") && !routes.iosLegacyMatch("ip/:id", "/ip"));
  t("lands: iOS walmart://host/path becomes /host/path; hosts with a dot are dropped", routes.iosLegacyPathString("walmart://ip/123?x=1") === "/ip/123" && routes.iosLegacyPathString("https://www.walmart.com/ip/1") === "/ip/1");
  t("lands: Android tables loaded (patterns + manifest filters)", routes.ANDROID.patterns.length > 300 && routes.ANDROID.filters.some((f) => f.hosts.includes("goto.walmart.com")));
  t("lands: Android mid-pattern (?i) converted for JS", routes.androidParse("walmart://wishlist/CREATE").winner?.cls === "GlassCreateWishlistLink", routes.androidParse("walmart://wishlist/CREATE").candidates.join());
  const rep = core.buildReport({ startUrl: "x", stopped: "done", hops: H("https://www.walmart.com/some/unknown/path").map((h) => Object.assign(h, { status: 200 })) });
  t("lands: web fallback is a WARN in the CLI verdict (destinationChecks)", rep.destinationChecks.length === 2 && rep.destinationChecks.every((c) => c.status === "warn") && rep.verdict === "WARN", JSON.stringify(rep.destinationChecks.map((c) => [c.status, c.title])));
  const f = core.friendlySummary(rep);
  t("lands: page summary — web fallback is a warning: 'opens the app, but not the right page'", f.pillars[2].state === "warn" && f.overall.state === "warn" && /not the right page/.test(f.overall.title), JSON.stringify([f.overall, f.pillars[2].headline]));
}

console.log(failed ? `\n${failed} FAILED` : "\nAll tests passed");
process.exit(failed ? 1 : 0);
