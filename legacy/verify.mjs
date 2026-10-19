// Run: bun run verify.mjs   (or: node verify.mjs)
import http from "node:http";
import core from "./core.js";
import { traceRedirects, isPrivateIp, hostAllowed, DEFAULT_ALLOW } from "./trace.mjs";
import { createServer } from "./server.mjs";

let failed = 0;
const noFetch0 = async () => { throw new Error("fetch must not be called"); };
function t(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
}

/* ---- core vectors ---- */
for (const v of core.TESTS) {
  const got = v.run();
  t("core: " + v.name, v.match ? v.match(got || "") : got === v.expect, String(got));
}

/* ---- pure helpers ---- */
for (const [ip, priv] of [["127.0.0.1", true], ["10.1.2.3", true], ["169.254.169.254", true], ["172.16.0.1", true], ["172.32.0.1", false],
  ["192.168.1.1", true], ["100.64.0.1", true], ["8.8.8.8", false], ["::1", true], ["fe80::1", true], ["fd00::1", true],
  ["::ffff:127.0.0.1", true], ["2606:4700::1111", false], ["not-an-ip", true]]) {
  t(`isPrivateIp(${ip}) = ${priv}`, isPrivateIp(ip) === priv);
}
t("hostAllowed wildcard", hostAllowed("a.walmart.com", ["*.walmart.com"]) && !hostAllowed("walmart.com", ["*.walmart.com"]) && !hostAllowed("evilwalmart.com", ["*.walmart.com"]));

/* ---- mock redirect server ---- */
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const base = `http://127.0.0.1:${mock.address().port}`;
  const go = (code, loc) => { res.writeHead(code, { location: loc, server: "mock" }); res.end("body must not be read"); };
  switch (true) {
    case u.pathname === "/a": return go(302, "/b");                                  // relative
    case u.pathname === "/b": return go(301, `${base}/c?x=1`);                      // absolute
    case u.pathname === "/c": res.writeHead(200); return res.end("ok");
    case u.pathname === "/nf": res.writeHead(404); return res.end("nope");
    case u.pathname === "/proxyauth": res.writeHead(407); return res.end("auth");
    case u.pathname === "/l1": return go(302, "/l2");
    case u.pathname === "/l2": return go(302, "/l1");
    case u.pathname.startsWith("/inf/"): return go(302, `/inf/${Number(u.pathname.slice(5)) + 1}`);
    case u.pathname === "/out": return go(302, "http://evil.example/x");
    case u.pathname === "/meta": return go(302, "http://169.254.169.254/latest/meta-data");
    case u.pathname === "/meta-ref": res.writeHead(200, { "content-type": "text/html" }); return res.end(`<html><meta http-equiv="refresh" content="0; url=${base}/c"></html>`);
    case u.pathname === "/js-ref": res.writeHead(200, { "content-type": "text/html" }); return res.end(`<script>window.location.href = "${base}/c?js=1";</script>`);
    case u.pathname === "/js-dyn": res.writeHead(200, { "content-type": "text/html" }); return res.end(`<script>location.href = base + path;</script>`);
    case u.pathname === "/platform": res.writeHead(200, { "content-type": "text/html" }); return res.end(`<script>if(android){location.href="intent://open#Intent;end"} else {location.href="https://goto.walmart.com/c/1/2/3?u=x"}</script>`);
    case u.pathname === "/scheme": return go(302, "walmart://brand/febreze/20045132?utm_source=fb");
    case u.pathname === "/bigbody": res.writeHead(200, { "content-type": "text/html" }); return res.end("x".repeat(500000) + `<script>location.href="${base}/c"</script>`);
    case u.pathname === "/slow": return setTimeout(() => { res.writeHead(200); res.end("late"); }, 400);
    default: res.writeHead(404); res.end();
  }
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const B = `http://127.0.0.1:${mock.address().port}`;
const local = { allowHosts: ["127.0.0.1"], allowPrivate: true, allowAnyPort: true };

let r = await traceRedirects(`${B}/a`, local);
t("trace: 3 hops, relative+absolute Location, ends done",
  r.stopped === "done" && r.hops.length === 3 && r.hops.map((h) => h.status).join() === "302,301,200" &&
  r.hops[0].nextUrl === `${B}/b` && r.finalUrl === `${B}/c?x=1` && r.hops[0].server === "mock", JSON.stringify(r));
r = await traceRedirects(`${B}/l1`, local);
t("trace: loop detected", r.stopped === "loop", JSON.stringify(r.stopped));
r = await traceRedirects(`${B}/inf/0`, { ...local, maxHops: 3 });
t("trace: hop cap", r.stopped === "max-hops" && r.hops.length === 4, JSON.stringify(r.stopped + r.hops.length));
r = await traceRedirects(`${B}/out`, local);
const lastOut = r.hops[r.hops.length - 1];
t("trace: off-allowlist target shown but not fetched", r.stopped === "blocked" && lastOut.host === "evil.example" && lastOut.status === null && /allowlist/.test(lastOut.reason), JSON.stringify(r));
r = await traceRedirects(`${B}/meta`, { ...local, allowAnyPublic: true, allowPrivate: false, allowAnyPort: true,
  lookup: async (h) => [{ address: h }] });
t("trace: redirect to 169.254.169.254 blocked on later hop", r.stopped === "blocked" || r.hops.some((h) => /private/.test(h.reason || "")), JSON.stringify(r));
r = await traceRedirects(`${B}/slow`, { ...local, timeoutMs: 50 });
t("trace: timeout becomes hop error", r.stopped === "error" && /Timed out/.test(r.hops[0].error), JSON.stringify(r));

r = await traceRedirects(`${B}/meta-ref`, local);
t("trace: follows <meta refresh>", r.stopped === "done" && r.hops.length === 2 && r.hops[0].via === "meta-refresh" && r.finalUrl === `${B}/c`, JSON.stringify(r));
r = await traceRedirects(`${B}/js-ref`, local);
t("trace: follows literal location.href", r.stopped === "done" && r.hops.length === 2 && r.hops[0].via === "javascript" && r.finalUrl === `${B}/c?js=1`, JSON.stringify(r));
r = await traceRedirects(`${B}/platform`, local);
t("trace: platform-branching page prefers the goto target over intent://", r.hops[0].via === "javascript" && /^https:\/\/goto\.walmart\.com\//.test(r.hops[0].nextUrl), JSON.stringify(r.hops[0]));
{
  const fakeFetch = async () => new Response(`<script>location.href="https://evil.example/fake"</script>`, { status: 200, headers: { "content-type": "text/html" } });
  r = await traceRedirects("https://www.walmart.com/brand/x", { fetchImpl: fakeFetch, lookup: async () => [{ address: "8.8.8.8" }] });
  t("trace: inline JS on walmart.com pages is not treated as a hop", r.hops.length === 1 && r.stopped === "done", JSON.stringify(r));
  r = await traceRedirects("https://nope.walmart.com/x", { lookup: async () => { const e = new Error("x"); e.code = "ENOTFOUND"; throw e; }, fetchImpl: noFetch0 });
  t("chain: DNS failure on the pasted host warns (tracer problem), not fails", !core.analyzeChain(r).checks.some((c) => c.status === "fail") && core.analyzeChain(r).checks.some((c) => c.status === "warn" && /could not reach/.test(c.title)), JSON.stringify(core.analyzeChain(r)));
}
r = await traceRedirects(`${B}/js-dyn`, local);
t("trace: runtime-built JS redirect is flagged, not guessed", r.hops.length === 1 && r.hops[0].htmlNoRedirect === true, JSON.stringify(r));
r = await traceRedirects(`${B}/bigbody`, local);
t("trace: redirect past the 64KB body cap is not read", r.hops.length === 1, JSON.stringify(r.hops.length));
r = await traceRedirects(`${B}/scheme`, local);
t("trace: Location walmart:// ends chain as app launch, not requested", r.stopped === "done" && r.hops.length === 2 && r.hops[1].appScheme === true && r.hops[1].status === null, JSON.stringify(r));
t("chain: app-scheme end passes", core.analyzeChain(r).checks.some((c) => c.status === "pass" && /launching the app/.test(c.title)) && !core.analyzeChain(r).checks.some((c) => c.status === "fail"), JSON.stringify(core.analyzeChain(r)));
t("trace: pgbuynow allowlisted by default", ["openapp.pgbuynow.com", "pgbuynow.com", "go.click2cart.com"].every((h) => hostAllowed(h, DEFAULT_ALLOW)));
{ // the user's pgbuynow link: host must warn (redirector), never fail as "not a universal-link host"
  const pg = "https://openapp.pgbuynow.com/?url=https://www.walmart.com/brand/febreze/febreze-bathroom/20045132?selectedSellerId=0?utm_source=meta&utm_medium=paid";
  const v = core.validate(pg).groups.flatMap((g) => g.checks);
  t("validate: pgbuynow link is a redirector warning, not a host failure", v.some((c) => c.status === "warn" && /pgbuynow\.com is a redirector/.test(c.title)) && !v.some((c) => /not a universal-link host/.test(c.title)), JSON.stringify(v.map((c) => c.title)));
  const u = core.validate("https://example.org/x").groups.flatMap((g) => g.checks);
  t("validate: unknown host still fails when no trace", u.some((c) => c.status === "fail" && /not a universal-link host/.test(c.title)));
  const w = core.validate("https://example.org/x", "", "", { traceIncomplete: true }).groups.flatMap((g) => g.checks);
  t("validate: unknown host only warns when trace incomplete", w.some((c) => c.status === "warn" && /Could not confirm/.test(c.title)) && !w.some((c) => c.status === "fail"));
}
t("chain: pgbuynow -> goto takeover is hop 2", core.appTakeoverIndex([{ host: "openapp.pgbuynow.com" }, { host: "goto.walmart.com" }]) === 1);

const noFetch = async () => { throw new Error("fetch must not be called"); };
r = await traceRedirects("https://nope.walmart.com/x", { lookup: async () => { const e = new Error("x"); e.code = "ENOTFOUND"; throw e; }, fetchImpl: noFetch });
t("trace: DNS failure is a hop error, not a crash", r.stopped === "error" && /ENOTFOUND/.test(r.hops[0].error), JSON.stringify(r));
r = await traceRedirects("https://goto.walmart.com/x", { lookup: async () => [{ address: "169.254.169.254" }], fetchImpl: noFetch });
t("trace: host resolving to private IP is blocked before fetch", r.stopped === "blocked" && /private/.test(r.hops[0].reason), JSON.stringify(r));
for (const bad of ["file:///etc/passwd", "ftp://goto.walmart.com/x", "https://user:pw@goto.walmart.com/x", "https://goto.walmart.com:8443/x"]) {
  r = await traceRedirects(bad, { fetchImpl: noFetch, lookup: async () => [{ address: "8.8.8.8" }] });
  t("trace: rejects " + bad, r.stopped === "blocked" && r.hops[0].status === null, JSON.stringify(r));
}
r = await traceRedirects("not a url", {});
t("trace: invalid URL is a hop error", r.stopped === "error");

for (const [path, re, label] of [["/nf", /HTTP 404/, "404"], ["/proxyauth", /407/, "407"]]) {
  r = await traceRedirects(`${B}${path}`, local);
  const ch = core.analyzeChain(r);
  t(`chain: final ${label} is not a pass`, ch.checks.some((c) => (c.status === "fail" || c.status === "warn") && re.test(c.title)) && !ch.checks.some((c) => c.status === "pass" && /ended normally/.test(c.title)), JSON.stringify(ch));
}

/* ---- any-public: follow unlisted third-party hosts to the Walmart link ---- */
{
  const GOTO = "https://goto.walmart.com/c/1/2/3?u=https%3A%2F%2Fwww.walmart.com%2Fbrand%2F20045132";
  const routes = {
    "https://redirector.example/x": [302, "https://other-tracker.example/y"],
    "https://other-tracker.example/y": [302, GOTO],
    [GOTO]: [302, "https://www.walmart.com/brand/20045132"],
    "https://www.walmart.com/brand/20045132": [200, null],
    "https://dead-end.example/z": [302, "https://parked.example/"],
    "https://parked.example/": [200, null],
  };
  const fake = async (u) => { const [st, loc] = routes[u] || [404, null]; return new Response("", { status: st, headers: loc ? { location: loc } : {} }); };
  const pub = { allowAnyPublic: true, fetchImpl: fake, lookup: async () => [{ address: "8.8.8.8" }] };
  r = await traceRedirects("https://redirector.example/x", pub);
  const cx = core.analyzeChain(r);
  t("any-public: follows unlisted hosts through to goto", r.stopped === "done" && r.hops.length === 4 && core.appTakeoverIndex(r.hops) === 2, JSON.stringify(r.hops.map((h) => h.host)));
  t("any-public: chain via unlisted hosts passes as an approved Walmart link", cx.checks.some((c) => c.status === "pass" && /Reaches an approved Walmart deeplink at hop 3/.test(c.title)) && !cx.checks.some((c) => c.status === "fail"), JSON.stringify(cx));
  r = await traceRedirects("https://dead-end.example/z", pub);
  const cd = core.analyzeChain(r);
  t("any-public: chain that never reaches Walmart FAILS", cd.checks.some((c) => c.status === "fail" && /Never reaches an approved Walmart link/.test(c.title)), JSON.stringify(cd));
  r = await traceRedirects("https://redirector.example/x", { ...pub, allowAnyPublic: false });
  t("allowlist-only mode still blocks unlisted hosts", r.stopped === "blocked" && r.hops.length === 1, JSON.stringify(r));
  r = await traceRedirects("https://www.walmart.com/brand/20045132", pub);
  t("chain: plain walmart.com link without goto warns, does not fail", !core.analyzeChain(r).checks.some((c) => c.status === "fail") && core.analyzeChain(r).checks.some((c) => c.status === "warn"), JSON.stringify(core.analyzeChain(r)));
  // egress-proxy mode: names are not resolved locally, but internal-looking names and private literals are refused
  let called = 0;
  const spy = async () => { called++; return new Response("", { status: 200 }); };
  for (const bad of ["http://localhost/x", "http://intranet/x", "http://printer.local/x", "http://10.0.0.5/x", "http://169.254.169.254/x"]) {
    r = await traceRedirects(bad, { allowAnyPublic: true, skipDnsCheck: true, fetchImpl: spy, lookup: async () => { throw new Error("no local dns"); } });
    t("skip-dns + any-public refuses " + bad, r.stopped === "blocked", JSON.stringify(r));
  }
  r = await traceRedirects("https://redirector.example/x", { allowAnyPublic: true, skipDnsCheck: true, fetchImpl: fake, lookup: async () => { throw new Error("must not resolve locally"); } });
  t("skip-dns + any-public follows public names without local DNS", r.stopped === "done" && r.hops.length === 4, JSON.stringify(r));
  t("only the refusals above never fetched", called === 0);
}

/* ---- server ---- */
const srv = createServer(local);
await new Promise((res) => srv.listen(0, "127.0.0.1", res));
const S = `http://127.0.0.1:${srv.address().port}`;
let resp = await fetch(`${S}/trace?url=${encodeURIComponent(`${B}/a`)}`);
let body = await resp.json();
t("server: /trace returns hops", resp.status === 200 && body.hops.length === 3 && resp.headers.get("x-content-type-options") === "nosniff", JSON.stringify(body));
resp = await fetch(`${S}/trace`);
t("server: missing url -> 400", resp.status === 400);
resp = await fetch(`${S}/`, { method: "POST" });
t("server: POST -> 405", resp.status === 405);
resp = await fetch(`${S}/core.js`);
t("server: serves core.js", resp.status === 200 && /DLCore/.test(await resp.text()));
resp = await fetch(`${S}/server.mjs`);
t("server: does not serve arbitrary files", resp.status === 404);
resp = await fetch(`${S}/`);
t("server: serves index.html with CSP", resp.status === 200 && /default-src 'self'/.test(resp.headers.get("content-security-policy") || ""));

/* ---- chain analysis on the real-world shape ---- */
const dbl = "https://goto.walmart.com/c/1/2/3?u=https%253A%252F%252Fwww.walmart.com%252Fbrand%252F20084619";
const sgl = "https://goto.walmart.com/c/1/2/3?u=https%3A%2F%2Fwww.walmart.com%2Fbrand%2F20084619";
let a = core.analyzeChain({ stopped: "done", hops: [
  { url: "https://click2cart.com/pdp?x=1", host: "click2cart.com", status: 302 },
  { url: dbl, host: "goto.walmart.com", status: 302 },
  { url: "https://www.walmart.com/brand/20084619", host: "www.walmart.com", status: 200 }] });
t("chain: names click2cart as source of double-encoding", a.checks.some((c) => c.status === "fail" && /introduced by the redirect from click2cart\.com to goto\.walmart\.com/.test(c.title)), JSON.stringify(a));
t("chain: app takeover at goto hop", core.appTakeoverIndex([{ host: "click2cart.com" }, { host: "goto.walmart.com" }]) === 1);
a = core.analyzeChain({ stopped: "done", hops: [{ url: "https://click2cart.com/pdp", host: "click2cart.com", status: 302 }, { url: sgl, host: "goto.walmart.com", status: 302 }] });
t("chain: single-encoded passes", a.checks.some((c) => c.status === "pass" && /No hop has a double-encoded/.test(c.title)) && !a.checks.some((c) => c.status === "fail"), JSON.stringify(a));

srv.close(); mock.close();
console.log(failed ? `\n${failed} FAILED` : "\nAll tests passed");
process.exit(failed ? 1 : 0);
