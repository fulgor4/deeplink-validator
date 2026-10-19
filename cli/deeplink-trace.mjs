#!/usr/bin/env node
// Follow every redirect of a link, show the call path, and check whether it ends in a URL that opens the Walmart app
// (walmart://, goto.walmart.com, www.walmart.com) and whether every hop's URL encoding is sane.
//
// Usage: deeplink-trace.mjs <url> [--paths-only] [--json] [--expect type:id] [--ua ios|android|desktop|"<string>"]
//                                    [--allowlist-only] [--max-hops N] [--no-js]
// Env:   SKIP_DNS_CHECK=1|0  don't / do resolve names locally. Default: on when an HTTP(S)_PROXY variable is set (the proxy resolves
//        names; otherwise every hop fails with "DNS lookup failed: ENOTFOUND"), off otherwise.
//        CHROME_PATH  browser used to run JavaScript-only redirect pages (default: Chrome / Chromium / Edge / Brave if installed).
// Exit:  0 = no failures, 1 = at least one failure, 2 = bad usage, 3 = pasted host unreachable from here (no verdict)
import core from "../public/js/core.js";
import { traceRedirects, IPHONE_UA, USER_AGENTS as UAS, envTraceOptions } from "../server/trace.mjs";
import { createJsRunner } from "../server/headless.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`deeplink-trace <url> [options]

Follows every redirect of a link, prints the call path, checks whether it ends in a URL that opens the Walmart app
(walmart://, goto.walmart.com, www.walmart.com) and checks URL encoding (none / once / double / triple) on every hop.

  --paths-only          only the call path (quickest view of all redirects)
  --json                machine-readable output
  --expect type:id      check the final route: brand:ID, ip:ID, cp:ID, path:grocery
  --ua ios|android|desktop|"<ua>"   user agent to send (default ios)
  --max-hops N          default 10
  --allowlist-only      only follow Walmart / known redirector hosts
  --no-js               don't run JavaScript-only redirect pages in headless Chrome (they're then emulated if known, else "unknown")
  -h, --help

Always single-quote the URL in your shell (it contains & and ?).
Exit code: 0 = no failures, 1 = at least one FAIL, 2 = bad usage, 3 = first host unreachable (network/proxy; no verdict).`);
  process.exit(0);
}
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const valueIdx = new Set(["--expect", "--ua", "--max-hops"].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
const url = args.find((a, i) => !a.startsWith("--") && !valueIdx.has(i));
if (!url) {
  console.error('Usage: deeplink-trace <url> [--paths-only] [--json] [--expect type:id] [--ua ios|android|desktop|"<ua>"] [--allowlist-only] [--max-hops N] [--no-js]');
  process.exit(2);
}
const ua = opt("--ua");
const [etype, ...eid] = (opt("--expect") || "").split(":");

const { proxyEnv, skipDnsCheck } = envTraceOptions();
if (proxyEnv && !process.versions.bun && !process.env.NODE_USE_ENV_PROXY && !flag("--json")) {
  console.error("note: a proxy is configured but Node's fetch ignores HTTP(S)_PROXY before Node 24. If hops fail to connect, run with Bun, or Node >= 22.21 / 24 with NODE_USE_ENV_PROXY=1.");
}

// Chrome is only started if a hop turns out to be a JavaScript-only page.
const jsRunner = flag("--no-js") ? null : createJsRunner();
let chain;
try {
  chain = await traceRedirects(url, {
    allowAnyPublic: !flag("--allowlist-only"),
    skipDnsCheck,
    userAgent: ua ? UAS[ua] || ua : IPHONE_UA,
    maxHops: opt("--max-hops") ? Number(opt("--max-hops")) : undefined,
    jsRunner,
  });
} finally { if (jsRunner) await jsRunner.close(); }
const R = core.buildReport(chain, { etype: etype || "", eid: eid.join(":") });
const { chainChecks, encoding, takeover, verdict, exitCode, fails, warns } = R;
const hops = chain.hops;
const ti = R.appOpensAtHop ? R.appOpensAtHop - 1 : -1;
const label = (h) => (h.appScheme ? h.url.split("?")[0] : h.host || "(invalid)");
const via = (h) => (h.via ? ` via ${h.via}` : "");

if (flag("--json")) {
  console.log(JSON.stringify({ verdict, exitCode, appOpensAtHop: ti >= 0 ? ti + 1 : null, chain, chainChecks, appView: R.appView, appDestination: R.appDestination, destinationChecks: R.destinationChecks, encoding: encoding.filter((e) => e.checks.length), takeover }, null, 2));
  process.exit(exitCode);
}

const mark = { pass: "PASS", warn: "WARN", fail: "FAIL", info: "INFO" };
const printChecks = (checks, indent = "  ") => {
  for (const c of checks) {
    console.log(`${indent}[${mark[c.status]}] ${c.title}${c.detail ? ` — ${c.detail}` : ""}`);
    for (const [k, v] of (c.extra && c.extra.show) || []) console.log(`${indent}       ${k}: ${v}`);
  }
};

console.log(`CALL PATH (${hops.length} hop${hops.length === 1 ? "" : "s"})`);
console.log("  " + hops.map(label).join("  →  "));
const D = R.appDestination && !R.appDestination.error ? R.appDestination : null;
const landLine = (p) => { const r = core.destinationRow(p); return `${r.platform.padEnd(8)} ${r.short}`; };
if (flag("--paths-only")) {
  console.log(`  ${ti >= 0 ? `App opens at hop ${ti + 1} (${label(hops[ti])})` : "No app-opening URL (walmart:// / goto.walmart.com / www.walmart.com) in the chain"}; ended: ${chain.stopped}`);
  if (D) for (const p of [D.ios, D.android]) console.log("  Lands on: " + landLine(p));
  process.exit(exitCode);
}
console.log();
hops.forEach((h, i) => {
  const st = h.appScheme ? "APP" : h.status ?? (h.error ? "ERR" : h.reason ? "—" : "?");
  console.log(`  ${i + 1}. [${st}] ${label(h)}${via(h)}${h.ms != null ? `  (${h.ms}ms)` : ""}${i === ti ? "   <= APP OPENS HERE" : ""}`);
  console.log(`       ${h.url.length > 200 ? h.url.slice(0, 200) + "…" : h.url}`);
  if (h.error) console.log(`       error: ${h.error}`);
  if (h.reason) console.log(`       not fetched: ${h.reason}`);
  if (h.js) console.log(`       page JavaScript run in headless Chrome for ${h.js.ms}ms${h.js.error ? ` (failed: ${h.js.error})` : ""}${h.js.blocked ? `; ${h.js.blocked} request(s) to non-public hosts blocked` : ""}`);
});
const V = R.appView;
if (V) {
  const cut = (x) => (x.length > 220 ? x.slice(0, 220) + "…" : x);
  console.log(`\nWHAT THE APP GETS AT HOP ${V.hop} (${V.host}) — before any redirect decodes it`);
  console.log(`  URL handed to the app (the Location header of hop ${V.hop - 1 || 1}, untouched): ${cut(V.appReceives)}`);
  for (const l of V.levels) console.log(`  ${l.label}${l.app ? "  <= app stops here" : ""}:\n      ${cut(l.value)}`);
  if (V.route) console.log(`  walmart:// route the app builds${V.approximate ? " (approximate)" : ""}:\n      ${cut(V.route)}${V.malformed ? "\n      ^ MALFORMED: it embeds an encoded URL where a route should be, so nothing matches and the app opens the link in Safari" : ""}`);
  if (V.note) console.log(`  ${V.note}`);
  if (V.webNext) console.log(`  The web redirect at hop ${V.hop} goes to: ${cut(V.webNext)}${V.webMatchesFull ? "\n      ^ same page as the fully decoded value: the server decodes repeatedly, the app decodes once" : ""}`);
}
if (D) {
  console.log("\nWHERE IT LANDS IN THE APP");
  printChecks(R.destinationChecks);
  if (!R.destinationChecks.length) for (const p of [D.ios, D.android]) console.log("  " + landLine(p));
  console.log(`  (routes: ${D.source.ios}; ${D.source.android})`);
}
console.log("\nREDIRECT CHAIN");
printChecks(chainChecks);

console.log("\nENCODING (level 0 = not encoded, 1 = encoded once = correct, 2+ = double/triple encoded)");
let any = false;
for (const e of encoding) {
  if (!e.checks.length) continue;
  any = true;
  console.log(`  hop ${e.i + 1} ${label(e.hop)}`);
  printChecks(e.checks, "    ");
}
if (!any) console.log("  No nested URL parameters found in any hop.");

if (takeover) {
  console.log(`\nAPP-OPENING URL (hop ${ti + 1})`);
  for (const g of takeover) { console.log(`  ${g.name}`); printChecks(g.checks, "    "); }
}
console.log(`\nRESULT: ${verdict}${fails.length ? ` — ${fails[0].title}` : warns.length ? ` — ${warns[0].title}` : ""}`);
process.exit(exitCode);
