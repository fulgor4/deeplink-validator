#!/usr/bin/env bun
// Usage: bun cli.mjs <url> [--expect brand:20084619] [--no-trace] [--allowlist-only] [--json]
import core from "./core.js";
import { traceRedirects } from "./trace.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const url = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--expect");
const expectArg = args[args.indexOf("--expect") + 1];
if (!url) {
  console.error("Usage: bun cli.mjs <url> [--expect type:id] [--no-trace] [--allowlist-only] [--json]");
  process.exit(2);
}
const [etype, ...eid] = (args.includes("--expect") ? expectArg : "").split(":");

let target = url;
let chain = null;
if (!flag("--no-trace")) {
  chain = await traceRedirects(url, { allowAnyPublic: !flag("--allowlist-only"), skipDnsCheck: process.env.SKIP_DNS_CHECK === "1" });
  const ti = core.appTakeoverIndex(chain.hops);
  if (ti >= 0) target = chain.hops[ti].url;
}
const traceIncomplete = !!chain && core.appTakeoverIndex(chain.hops) < 0 && ["blocked", "error"].includes(chain.stopped);
const res = core.validate(target, etype || "", eid.join(":"), { traceIncomplete });
if (chain) res.groups.unshift(core.analyzeChain(chain));

if (flag("--json")) {
  console.log(JSON.stringify({ chain, validatedUrl: target, groups: res.groups }, null, 2));
} else {
  if (chain) {
    console.log("Redirect chain:");
    const ti = core.appTakeoverIndex(chain.hops);
    chain.hops.forEach((h, i) => {
      const st = h.status ?? (h.error ? "ERR" : h.reason ? "—" : "?");
      console.log(`  ${i + 1}. [${st}] ${h.host}${h.via ? `  (${h.via} redirect)` : ""}${h.appScheme ? "   <= opens the app (custom scheme)" : ""}${i === ti ? "   <= app takes over here" : ""}${h.ms != null ? `  (${h.ms}ms)` : ""}`);
      if (h.error) console.log(`       error: ${h.error}`);
      if (h.reason) console.log(`       not fetched: ${h.reason}`);
    });
    console.log();
  }
  const mark = { pass: "PASS", warn: "WARN", fail: "FAIL", info: "INFO" };
  for (const g of res.groups) {
    console.log(g.name);
    for (const c of g.checks) {
      console.log(`  [${mark[c.status]}] ${c.title}${c.detail ? ` — ${c.detail}` : ""}`);
      for (const [k, v] of (c.extra && c.extra.show) || []) console.log(`         ${k}: ${v}`);
    }
  }
}
process.exit(res.groups.some((g) => g.checks.some((c) => c.status === "fail")) ? 1 : 0);
