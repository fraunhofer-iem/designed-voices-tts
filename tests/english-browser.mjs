// ENGLISH_ASSETS_DIR=<registered runtime> PHONY_WASM_DIR=<pkg-web> bun tests/english-browser.mjs
import { chromium } from "playwright";
import { resolve } from "node:path";

const assets = process.env.ENGLISH_ASSETS_DIR;
const wasmDir = process.env.PHONY_WASM_DIR;
if (!assets || !wasmDir) throw new Error("Set ENGLISH_ASSETS_DIR and PHONY_WASM_DIR to existing read-only assets");
const build = await Bun.build({ entrypoints: [new URL("./english-browser-entry.mjs", import.meta.url).pathname], target: "browser", format: "esm", external: ["/phony/*"] });
if (!build.success) throw new AggregateError(build.logs, "Browser test bundle failed");
const code = await build.outputs[0].text();
const routes = new Map([
  ["/assets/frontend.json", resolve(assets, "frontend.json")],
  ["/assets/models.safetensors", resolve(assets, "models.safetensors")],
  ["/assets/english.lex", resolve(assets, "english.lex")],
  ["/assets/quickjs.wasm", import.meta.resolve("@jitl/quickjs-wasmfile-release-sync/wasm").replace("file://", "")],
  ["/phony/phony_wasm.js", resolve(wasmDir, "phony_wasm.js")],
  ["/phony/phony_wasm_bg.wasm", resolve(wasmDir, "phony_wasm_bg.wasm")],
]);
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/") return new Response("<!doctype html><title>English WASM integration test</title>", { headers: { "Content-Type": "text/html" } });
    if (pathname === "/entry.js") return new Response(code, { headers: { "Content-Type": "application/javascript" } });
    const path = routes.get(pathname);
    return path ? new Response(Bun.file(path)) : new Response("Not found", { status: 404 });
  },
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(server.url.href);
  const result = await page.evaluate(async () => {
    const { runEnglishBrowserChecks } = await import("/entry.js");
    return runEnglishBrowserChecks();
  });
  console.log(JSON.stringify({ browser: "Chromium", ...result }));
} finally {
  await browser?.close();
  server.stop(true);
}
