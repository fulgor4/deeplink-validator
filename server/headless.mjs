// Runs a JavaScript-only redirect page in headless Chrome (Chromium / Edge / Brave also work) and records where the page
// tries to send the visitor: top-level navigations, hidden iframes and window.open, including walmart:// app links.
// Nothing is actually followed or opened: every navigation is recorded and cancelled, and the tracer follows the result
// itself (so status codes and raw Location headers stay exact). No npm dependencies: DevTools protocol over a pipe.
//
// Safety: every request the page makes goes through `vetUrl` (the tracer's SSRF rules: http/https on 80/443, public
// addresses only) and is failed if refused. App-scheme navigations are cancelled so no app or OS dialog is launched.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  linux: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"],
};

/** Path to a Chromium-family browser, or null. CHROME_PATH wins. */
export function findChrome(env = process.env, platform = process.platform) {
  if (env.CHROME_PATH) return existsSync(env.CHROME_PATH) ? env.CHROME_PATH : null;
  for (const c of CANDIDATES[platform] || CANDIDATES.linux) {
    if (path.isAbsolute(c)) { if (existsSync(c)) return c; continue; }
    for (const dir of (env.PATH || "").split(path.delimiter)) if (dir && existsSync(path.join(dir, c))) return path.join(dir, c);
  }
  return null;
}

/** Chrome's --proxy-server value from HTTPS_PROXY / HTTP_PROXY (credentials dropped; Chrome can't take them on the command line). */
export function chromeProxyArg(env = process.env) {
  const p = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!p) return null;
  try { const u = new URL(p); return `${u.protocol}//${u.host}`; } catch { return null; }
}

// Injected into every frame before the page's own scripts. Reports through the CDP binding __dltReport.
const HOOK = String.raw`(() => {
  const B = globalThis.__dltReport; if (!B) return;
  const abs = (u) => { try { return new URL(String(u), location.href).href; } catch (e) { return String(u); } };
  const top = (() => { try { return window === window.top; } catch (e) { return false; } })();
  const rep = (kind, u) => { try { B(JSON.stringify({ kind, url: abs(u), top })); } catch (e) {} };
  const web = (u) => /^https?:/i.test(abs(u));
  // Every navigation of this frame (location.href/assign/replace, meta refresh, link clicks, form posts): record, cancel.
  try { navigation.addEventListener("navigate", (e) => { rep("navigate", e.destination.url); if (e.cancelable) e.preventDefault(); }); } catch (e) {}
  // Hidden iframes are how pages launch an app without leaving: record app links and never let them load.
  const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
  if (d && d.set) Object.defineProperty(HTMLIFrameElement.prototype, "src", { configurable: true, enumerable: d.enumerable,
    get() { return d.get.call(this); }, set(v) { if (web(v)) return d.set.call(this, v); rep("iframe", v); } });
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) {
    if (this instanceof HTMLIFrameElement && String(n).toLowerCase() === "src" && !web(v)) { rep("iframe", v); return; }
    return sa.call(this, n, v);
  };
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes || []) {
    if (n instanceof HTMLIFrameElement && n.getAttribute("src") && !web(n.getAttribute("src"))) rep("iframe", n.getAttribute("src"));
  } }).observe(document, { childList: true, subtree: true });
  window.open = function (u) { if (u) rep("open", u); return null; };
})();`;

class Cdp {
  constructor(proc) {
    this.proc = proc; this.id = 0; this.pending = new Map(); this.listeners = new Set(); this.buf = "";
    proc.stdio[4].on("data", (d) => {
      this.buf += d;
      for (let i; (i = this.buf.indexOf("\0")) >= 0;) {
        const raw = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        let m; try { m = JSON.parse(raw); } catch { continue; }
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id);
          m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result);
        } else if (m.method) for (const l of this.listeners) l(m);
      }
    });
    const fail = () => { for (const p of this.pending.values()) p.reject(new Error("browser exited")); this.pending.clear(); this.dead = true; };
    proc.on("exit", fail); proc.stdio[3].on("error", fail);
  }
  send(method, params = {}, sessionId) {
    if (this.dead) return Promise.reject(new Error("browser exited"));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.proc.stdio[3].write(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }) + "\0");
    });
  }
}

/**
 * @param {{chromePath?:string, vetUrl?:(u:URL)=>Promise<string|null>, settleMs?:number, maxMs?:number, proxy?:string|null}} opts
 * @returns {{available:boolean, chromePath:string|null, run:(url:string, ua:string, o?:{vetUrl?:Function})=>Promise<object>, close:()=>Promise<void>}}
 */
export function createJsRunner(opts = {}) {
  const chromePath = opts.chromePath === undefined ? findChrome() : opts.chromePath;
  const settleMs = opts.settleMs ?? 3000;   // after the load event, how long timers get to fire
  const maxMs = opts.maxMs ?? 10000;        // hard cap per page
  const vetUrl = opts.vetUrl || (async () => null);
  const proxy = opts.proxy === undefined ? chromeProxyArg() : opts.proxy;
  let launching = null, proc = null, cdp = null, dir = null;

  async function browser() {
    if (cdp && !cdp.dead) return cdp;
    if (!launching) launching = (async () => {
      dir = mkdtempSync(path.join(os.tmpdir(), "deeplink-trace-chrome-"));
      const args = ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check",
        "--disable-extensions", "--disable-background-networking", "--disable-sync", "--disable-component-update", "--mute-audio",
        "--disable-gpu", "--disable-features=Translate,MediaRouter,OptimizationHints", "--deny-permission-prompts"];
      if (proxy) args.push(`--proxy-server=${proxy}`);
      args.push("--disable-dev-shm-usage"); // containers often have a tiny /dev/shm
      // Only if Chrome's sandbox can't start in your container (it needs user namespaces). Weakens isolation; see README.
      if (process.env.CHROME_NO_SANDBOX === "1") args.push("--no-sandbox");
      args.push("about:blank");
      proc = spawn(chromePath, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
      proc.on("error", () => {});
      cdp = new Cdp(proc);
      await cdp.send("Browser.getVersion");
      return cdp;
    })().finally(() => { launching = null; });
    return launching;
  }

  async function run(url, ua, runOpts = {}) {
    const vet = runOpts.vetUrl || vetUrl;
    const t0 = Date.now();
    const out = { ran: true, navigations: [], blocked: [], ms: 0, error: null };
    let c, ctx, session, onMsg;
    try {
      c = await browser();
      ctx = (await c.send("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId;
      const { targetId } = await c.send("Target.createTarget", { url: "about:blank", browserContextId: ctx });
      session = (await c.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
      const s = (m, p) => c.send(m, p, session);
      let mainFrame = null, loaded = false, docRequests = 0, finish;
      const done = new Promise((r) => { finish = r; });
      const seen = new Set();
      const record = (kind, u, top) => {
        const key = kind === "iframe" ? "iframe " + u : u;
        if (seen.has(key)) return; seen.add(key);
        out.navigations.push({ kind, url: u, top, atMs: Date.now() - t0 });
        if (top && kind !== "iframe" && kind !== "open") setTimeout(() => finish("navigated"), 250); // let a same-tick iframe report land
      };
      onMsg = (m) => {
        if (m.sessionId !== session) return;
        const p = m.params || {};
        if (m.method === "Runtime.bindingCalled" && p.name === "__dltReport") {
          let r; try { r = JSON.parse(p.payload); } catch { return; }
          record(r.kind === "navigate" ? "navigate" : r.kind, String(r.url), !!r.top);
        } else if (m.method === "Page.frameRequestedNavigation") {
          if (p.frameId === mainFrame && !/^https?:/i.test(p.url)) record("navigate", p.url, true);
        } else if (m.method === "Page.loadEventFired") {
          loaded = true; setTimeout(() => finish("settled"), settleMs);
        } else if (m.method === "Fetch.requestPaused") {
          (async () => {
            const u = p.request.url;
            const isDoc = p.resourceType === "Document";
            if (isDoc && p.frameId === mainFrame && docRequests++ > 0) { // the page navigating on, not the page itself
              record("navigate", u, true);
              return s("Fetch.failRequest", { requestId: p.requestId, errorReason: "Aborted" });
            }
            if (isDoc && p.frameId !== mainFrame) return s("Fetch.failRequest", { requestId: p.requestId, errorReason: "Aborted" });
            let problem; try { problem = await vet(new URL(u)); } catch (e) { problem = "unparseable URL"; }
            if (problem) { out.blocked.push({ url: u.slice(0, 200), reason: typeof problem === "string" ? problem : problem.dns || "refused" });
              return s("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }); }
            return s("Fetch.continueRequest", { requestId: p.requestId });
          })().catch(() => {});
        }
      };
      c.listeners.add(onMsg);
      const mobile = /iPhone|iPad|Android/i.test(ua);
      const platform = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/i.test(ua) ? "Linux armv8l" : "MacIntel";
      mainFrame = (await s("Page.getFrameTree")).frameTree.frame.id;
      await Promise.all([
        s("Page.enable"), s("Runtime.enable"), s("Network.setBypassServiceWorker", { bypass: true }),
        s("Emulation.setUserAgentOverride", { userAgent: ua, platform }),
        mobile ? s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }) : null,
        mobile ? s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }) : null,
        s("Runtime.addBinding", { name: "__dltReport" }),
        s("Page.addScriptToEvaluateOnNewDocument", { source: HOOK }),
        s("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }),
      ]);
      const cap = setTimeout(() => finish(loaded ? "timeout" : "load-timeout"), maxMs);
      const nav = await s("Page.navigate", { url });
      if (nav.errorText && !out.navigations.length) { out.error = nav.errorText; finish("error"); }
      out.ended = await done;
      clearTimeout(cap);
    } catch (e) {
      out.error = e.message;
    } finally {
      if (c && onMsg) c.listeners.delete(onMsg);
      if (c && ctx) await c.send("Target.disposeBrowserContext", { browserContextId: ctx }).catch(() => {});
      out.ms = Date.now() - t0;
    }
    return out;
  }

  async function close() {
    try { if (cdp && !cdp.dead) await Promise.race([cdp.send("Browser.close"), new Promise((r) => setTimeout(r, 1500))]); } catch { /* gone */ }
    try { proc && !proc.killed && proc.exitCode === null && proc.kill(); } catch { /* gone */ }
    if (dir) { const d = dir; dir = null; setTimeout(() => { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }, 500).unref?.(); }
    cdp = null; proc = null;
  }

  return { available: !!chromePath, chromePath, run, close };
}

/**
 * Turns a run into what the tracer needs: the app link the page fires (if any) and where the page then goes.
 * appLink: first walmart*:// (or intent://) navigation; next: first top-level http(s) navigation.
 */
export function summarizeRun(run) {
  const navs = (run && run.navigations) || [];
  const app = navs.find((n) => /^walmart[a-z0-9]*:/i.test(n.url));
  const intent = navs.find((n) => /^intent:/i.test(n.url));
  const next = navs.find((n) => n.top && n.kind !== "iframe" && /^https?:/i.test(n.url));
  return { app: app || null, intent: intent || null, next: next || null };
}
