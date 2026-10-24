import assert from "node:assert/strict";
import test from "node:test";
import {classifyRenderer, parseBrowser, parseOs, shortRendererName} from "../scripts/environment.mjs";

test("software stand-ins are recognized", () => {
  for ( const renderer of [
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    "Google SwiftShader",
    "llvmpipe (LLVM 15.0.7, 256 bits)",
    "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Mesa OffScreen"
  ] ) {
    assert.equal(classifyRenderer(renderer).software, true, renderer);
    assert.equal(classifyRenderer(renderer).kind, "software", renderer);
  }
});

test("graphics cards and built-in graphics", () => {
  const cases = {
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 SUPER (0x00002702) Direct3D11 vs_5_0 ps_5_0, D3D11)": "dedicated",
    "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)": "dedicated",
    "ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)": "dedicated",
    "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)": "integrated",
    "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)": "integrated",
    "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)": "integrated",
    "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)": "apple",
    "Apple GPU": "apple",
    "Mali-G78": "integrated",
    "": "unknown"
  };
  for ( const [renderer, kind] of Object.entries(cases) ) assert.equal(classifyRenderer(renderer).kind, kind, renderer);
});

test("readable names of graphics chips", () => {
  assert.equal(shortRendererName("ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 SUPER (0x00002702) Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    "NVIDIA GeForce RTX 4080 SUPER");
  assert.equal(shortRendererName("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    "Intel UHD Graphics 620");
  assert.equal(shortRendererName("NVIDIA GeForce GTX 1060/PCIe/SSE2"), "NVIDIA GeForce GTX 1060/PCIe/SSE2");
});

test("browsers", () => {
  const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  assert.deepEqual(parseBrowser(chrome), {name: "Chrome", version: "141", engine: "chromium", app: false});
  assert.equal(parseBrowser(`${chrome} Edg/141.0.0.0`).name, "Edge");
  assert.equal(parseBrowser(chrome, [{brand: "Microsoft Edge", version: "141"}]).name, "Edge");
  assert.equal(parseBrowser(chrome, [{brand: "Brave", version: "141"}]).name, "Brave");
  assert.deepEqual(parseBrowser("Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0"),
    {name: "Firefox", version: "140", engine: "firefox", app: false});
  assert.equal(parseBrowser(`${chrome} Electron/34.1.0`).app, true);
  assert.equal(parseBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15").name, "Safari");
});

test("operating systems", () => {
  assert.equal(parseOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "Windows");
  assert.equal(parseOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)"), "macOS");
  assert.equal(parseOs("Mozilla/5.0 (X11; Linux x86_64)"), "Linux");
  assert.equal(parseOs("", "Windows"), "Windows");
});
