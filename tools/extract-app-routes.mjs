#!/usr/bin/env node
// Regenerates the Android route table from the walmart-glass repo and checks the hand-curated iOS table against glass-app.
//
//   node tools/extract-app-routes.mjs [--android ../walmart-glass] [--ios ../glass-app]
//
// Writes public/js/app-routes-android.generated.js (commit it; the page and CLI never read the
// app repos at runtime). Prints every iOS pattern whose literal can no longer be found in the file it cites.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const ANDROID = path.resolve(arg("--android", path.join(repo, "../walmart-glass")));
const IOS = path.resolve(arg("--ios", path.join(repo, "../glass-app")));
const OUT = path.join(repo, "public/js/app-routes-android.generated.js");

/* ---------------- Android: @GlassLinkPattern annotations ---------------- */
const TYPES = "features/link/feature-link-types/src/main/java/com/walmart/glass/link/types";
const MANIFESTS = ["apps/us/glass-us-config/src/main/AndroidManifest.xml", "apps/us/glass-us/src/main/AndroidManifest.xml"];
const STRINGS = "features/integration/feature-integration/src/main/res/values/do-not-translate-strings.xml";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".kt")) out.push(p);
  }
  return out;
}

// Kotlin string literal at s[i] (i points at the opening quote). Returns [value, endIndex] or null. Handles "..." and """...""".
function kString(s, i) {
  if (s.startsWith('"""', i)) { const j = s.indexOf('"""', i + 3); return [s.slice(i + 3, j), j + 3, true]; }
  let v = "", j = i + 1;
  for (; j < s.length && s[j] !== '"'; j++) {
    if (s[j] === "\\") { const n = s[++j]; v += n === "n" ? "\n" : n === "t" ? "\t" : n; } // \\ -> \, \$ -> $, \" -> "
    else v += s[j];
  }
  return [v, j + 1, false];
}

// Balanced "( ... )" starting at s[i] === "(", skipping strings. Returns end index (exclusive).
function balanced(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"') { j = kString(s, j)[1] - 1; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return j + 1;
  }
  return -1;
}

function stripComments(t) {
  let out = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '"') { const e = kString(t, i)[1]; out += t.slice(i, e); i = e - 1; continue; }
    if (t.startsWith("//", i)) { while (i < t.length && t[i] !== "\n") i++; out += "\n"; continue; }
    if (t.startsWith("/*", i)) { const e = t.indexOf("*/", i + 2); i = e < 0 ? t.length : e + 1; continue; }
    out += t[i];
  }
  return out;
}

function parseArgs(body, consts) {
  const out = {};
  let i = 0;
  const ws = () => { while (i < body.length && /[\s,]/.test(body[i])) i++; };
  const value = () => {
    ws();
    if (body[i] === '"') {
      const [raw, end, rawStr] = kString(body, i); i = end;
      // String templates: $NAME / ${NAME} from same-file consts (rare in patterns). Raw strings keep \ as-is already.
      let v = raw;
      for (;;) { // "a" + "b" concatenation
        const k = /^\s*\+\s*/.exec(body.slice(i));
        if (!k || body[i + k[0].length] !== '"') break;
        i += k[0].length; const [r2, e2] = kString(body, i); v += r2; i = e2;
      }
      return v.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (m, n) => (n in consts ? consts[n] : m));
    }
    if (body[i] === "[" || body.startsWith("arrayOf(", i)) {
      const close = body[i] === "[" ? "]" : ")"; i = body[i] === "[" ? i + 1 : i + 8;
      const arr = [];
      for (;;) { ws(); if (body[i] === close) { i++; break; } arr.push(value()); }
      return arr;
    }
    const m = /^[A-Za-z_][\w.]*/.exec(body.slice(i));
    if (!m) throw new Error("cannot parse annotation argument near: " + JSON.stringify(body.slice(i, i + 60)));
    i += m[0].length;
    if (m[0] === "true" || m[0] === "false") return m[0] === "true";
    return m[0] in consts ? consts[m[0]] : { unresolved: m[0] };
  };
  for (;;) {
    ws(); if (i >= body.length) break;
    const k = /^(\w+)\s*=/.exec(body.slice(i)); if (!k) break;
    i += k[0].length; out[k[1]] = value();
  }
  return out;
}

function androidPatterns() {
  const files = walk(path.join(ANDROID, TYPES)).sort();
  const patterns = [], problems = [];
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    if (!s.includes("@GlassLinkPattern")) continue;
    const consts = {};
    for (const m of s.matchAll(/const\s+val\s+([A-Z_][A-Z0-9_]*)\s*(?::\s*String)?\s*=\s*"((?:[^"\\]|\\.)*)"/g)) consts[m[1]] = kString(`"${m[2]}"`, 0)[0];
    const rel = path.relative(ANDROID, f);
    // Group consecutive annotations with the class that follows them.
    const re = /@GlassLinkPattern(Array)?\s*\(/g;
    let m, pending = [], groupStart = -1;
    while ((m = re.exec(s))) {
      const open = m.index + m[0].length - 1, end = balanced(s, open);
      const lineOf = (i) => s.slice(0, i).split("\n").length;
      if (!pending.length) groupStart = m.index;
      // @GlassLinkPatternArray([ GlassLinkPattern(...), ... ]) holds several patterns.
      const inner = m[1] ? [...s.slice(open, end).matchAll(/\bGlassLinkPattern\s*\(/g)].map((x) => open + x.index + x[0].length - 1) : [open];
      for (const o of inner) {
        const e = balanced(s, o);
        try { const a = parseArgs(stripComments(s.slice(o + 1, e - 1)), consts); a.line = lineOf(o); pending.push(a); }
        catch (err) { problems.push(`${rel}:${lineOf(o)} ${err.message}`); }
      }
      re.lastIndex = end;
      const rest = s.slice(end);
      if (/^\s*@GlassLinkPattern/.test(rest)) continue;
      const cls = /^[\s\S]*?\bclass\s+(\w+)/.exec(rest);
      const between = cls ? rest.slice(0, cls.index + cls[0].length) : "";
      const name = cls ? cls[1] : "?";
      // Body of this class (up to the next top-level annotation/class) for requiresAuth.
      const after = rest.slice(cls ? cls[0].length : 0);
      const stop = after.search(/\n@GlassLinkPattern|\n(?:abstract |open |data )?class /);
      const bodyText = after.slice(0, stop < 0 ? undefined : stop);
      const auth = /requiresAuth[^\n=]*=\s*true/.test(bodyText) || /requiresAuth[^\n=]*=\s*true/.test(s) && !/requiresAuth[^\n=]*=\s*false/.test(s);
      const last = /@Last\b/.test(between) || /@Last\s*$/.test(s.slice(Math.max(0, groupStart - 40), groupStart));
      for (const p of pending) {
        if (typeof p.pathPattern !== "string") { problems.push(`${rel}:${p.line} unresolved pathPattern ${JSON.stringify(p.pathPattern)}`); continue; }
        let js;
        try { js = toJsRegex(p.pathPattern); new RegExp(js.source, js.flags); } catch (e) { problems.push(`${rel}:${p.line} ${p.pathPattern}: ${e.message}`); continue; }
        patterns.push({
          cls: name, re: js.source, flags: js.flags, java: p.pathPattern,
          deepLink: p.isDeepLink !== false, defaultDomains: p.useDefaultDomains !== false,
          customDomains: p.customDomains || [], customDomainPatterns: p.customDomainPatterns || [],
          last, auth, src: `${rel}:${p.line}`,
        });
      }
      pending = [];
    }
  }
  return { patterns, problems };
}

// Java regex -> JS: anchored full match; a mid-pattern (?i) becomes explicit [xX] classes up to the end of its group.
function toJsRegex(java) {
  let src = java, flags = "";
  if (src.startsWith("(?i)")) { src = src.slice(4); flags = "i"; }
  let out = "", depth = 0, ciDepth = -1, inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { out += c + src[++i]; continue; }
    if (inClass) { out += c; if (c === "]") inClass = false; continue; }
    if (src.startsWith("(?i)", i)) { ciDepth = depth; i += 3; continue; }
    if (c === "[") { inClass = true; out += c; continue; }
    if (c === "(") { depth++; out += c; continue; }
    if (c === ")") { depth--; if (ciDepth > depth) ciDepth = -1; out += c; continue; }
    if (ciDepth >= 0 && /[a-z]/i.test(c)) { out += `[${c.toLowerCase()}${c.toUpperCase()}]`; continue; }
    out += c;
  }
  return { source: `^(?:${out})$`, flags };
}

function androidManifests() {
  const strings = {};
  const sx = fs.readFileSync(path.join(ANDROID, STRINGS), "utf8");
  for (const m of sx.matchAll(/<string name="([^"]+)"[^>]*>([^<]*)<\/string>/g)) strings[m[1]] = m[2];
  const val = (v) => (v && v.startsWith("@string/") ? strings[v.slice(8)] ?? v : v);
  const filters = [];
  for (const mf of MANIFESTS) {
    const x = fs.readFileSync(path.join(ANDROID, mf), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    for (const m of x.matchAll(/<intent-filter\b([^>]*)>([\s\S]*?)<\/intent-filter>/g)) {
      if (!/android\.intent\.action\.VIEW/.test(m[2]) || !/category\.BROWSABLE/.test(m[2])) continue;
      const f = { autoVerify: /autoVerify="true"/.test(m[1]), schemes: [], hosts: [], paths: [], prefixes: [], patterns: [], src: mf };
      for (const d of m[2].matchAll(/<data\b([^>]*)\/?>/g)) {
        const at = (n) => { const r = new RegExp(`android:${n}="([^"]*)"`).exec(d[1]); return r ? val(r[1]) : null; };
        if (at("scheme") != null) f.schemes.push(at("scheme"));
        if (at("host") != null) f.hosts.push(at("host"));
        if (at("path") != null) f.paths.push(at("path"));
        if (at("pathPrefix") != null) f.prefixes.push(at("pathPrefix"));
        if (at("pathPattern") != null) f.patterns.push(at("pathPattern"));
      }
      if (f.schemes.length) filters.push(f);
    }
  }
  return filters;
}

function gitHead(dir) {
  try {
    const head = fs.readFileSync(path.join(dir, ".git/HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head.slice(0, 12);
    const ref = head.slice(5);
    const p = path.join(dir, ".git", ref);
    if (fs.existsSync(p)) return ref.replace("refs/heads/", "") + "@" + fs.readFileSync(p, "utf8").trim().slice(0, 12);
    const packed = fs.readFileSync(path.join(dir, ".git/packed-refs"), "utf8").split("\n").find((l) => l.endsWith(" " + ref));
    return ref.replace("refs/heads/", "") + "@" + (packed ? packed.slice(0, 12) : "?");
  } catch { return "unknown"; }
}

const { patterns, problems } = androidPatterns();
const filters = androidManifests();
const data = { generated: new Date().toISOString().slice(0, 10), source: "walmart-glass " + gitHead(ANDROID), patterns, filters };
fs.writeFileSync(OUT, `// GENERATED by tools/extract-app-routes.mjs from walmart-glass. Do not edit; re-run the tool instead.
// ${patterns.length} @GlassLinkPattern patterns, ${filters.length} manifest intent filters.
(function (root) {
"use strict";
const DATA = ${JSON.stringify(data, null, 0).replace(/\},\{"cls"/g, '},\n{"cls"')};
if (typeof module !== "undefined" && module.exports) module.exports = DATA; else root.DLAndroidRoutes = DATA;
})(typeof globalThis !== "undefined" ? globalThis : this);
`);
console.log(`Android: ${patterns.length} patterns from ${data.source}, ${filters.length} intent filters -> ${path.relative(repo, OUT)}`);
for (const p of problems) console.log("  skipped: " + p);

/* ---------------- iOS: verify the hand-curated table still matches the source ---------------- */
if (fs.existsSync(IOS)) {
  const require = createRequire(import.meta.url);
  const routes = require(path.join(repo, "public/js/app-routes.js"));
  const cache = {};
  let missing = 0, checked = 0, loose = 0;
  for (const r of [...routes.IOS_LEGACY, ...routes.IOS_ASYNC]) {
    if (!r.src) continue;
    const file = path.join(IOS, r.src.replace(/:\d+(-\d+)?$/, ""));
    if (!(file in cache)) cache[file] = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const text = cache[file];
    const lit = r.literal || r.p;
    checked++;
    if (text == null) { missing++; console.log(`  iOS: file gone: ${r.src} (${r.p})`); }
    else if (!text.includes(r.literal ? `"${lit}` : `"${lit}"`)) {
      // Interpolated patterns ("acc/\\(serviceTracker)/:\\(keyTag)"): every static segment must still appear inside a string literal.
      const statics = r.p.split("/").filter((x) => x && !/^[:*{]/.test(x)).map((x) => x.replace(/\?.*$/, ""));
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ok = statics.every((x) => new RegExp(`"[^"\\n]*?(?<![A-Za-z0-9_-])${esc(x)}(?![A-Za-z0-9_-])[^"\\n]*"`).test(text));
      if (ok) loose++; else { missing++; console.log(`  iOS: "${lit}" not found in ${r.src}`); }
    }
  }
  console.log(`iOS (${gitHead(IOS)}): ${checked - missing}/${checked} patterns found in the cited files (${loose} via their static segments, built by string interpolation)${missing ? " — update app-routes.js" : ""}`);
} else console.log(`iOS repo not found at ${IOS}; skipped the iOS check.`);
