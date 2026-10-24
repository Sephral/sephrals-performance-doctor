/**
 * This computer: graphics chip, browser, screen and Foundry's graphics settings of this user. Read once and again
 * when something changes, never in a loop.
 */

/** Patterns of graphics drivers that draw with the processor instead of a graphics chip. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software (?:rasterizer|adapter|renderer)|basic render driver|microsoft basic|mesa offscreen|\bwarp\b/i;

/** Graphics chips built into the processor. */
const INTEGRATED = /intel(?:\(r\))?[^,)]*(?:hd|uhd|iris|xe graphics|graphics \d|\bgraphics\b)|amd radeon(?:\(tm\))? graphics|radeon(?:\(tm\))? (?:vega \d+ )?graphics|radeon \d{3}m|adreno|mali|powervr|videocore/i;

/** Graphics cards of their own. */
const DEDICATED = /nvidia|geforce|quadro|rtx|gtx|radeon rx|radeon pro|radeon r9|radeon hd \d|firepro|arc a\d|arc b\d|intel\(r\) arc/i;

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * What kind of graphics chip a WebGL renderer string names.
 * @param {string} renderer   For example "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)"
 * @returns {{kind: string, software: boolean, name: string}}
 *   kind: "software", "integrated", "dedicated", "apple" or "unknown"
 */
export function classifyRenderer(renderer) {
  const text = String(renderer ?? "");
  const name = shortRendererName(text);
  if ( !text ) return {kind: "unknown", software: false, name};
  if ( SOFTWARE.test(text) ) return {kind: "software", software: true, name};
  if ( /apple (?:m\d|a\d|gpu)/i.test(text) ) return {kind: "apple", software: false, name};
  if ( DEDICATED.test(text) && !/radeon(?:\(tm\))? graphics/i.test(text) ) return {kind: "dedicated", software: false, name};
  if ( INTEGRATED.test(text) ) return {kind: "integrated", software: false, name};
  return {kind: "unknown", software: false, name};
}

/**
 * A readable name from a WebGL renderer string: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0,
 * D3D11)" becomes "NVIDIA GeForce RTX 3060".
 * @param {string} renderer
 * @returns {string}
 */
export function shortRendererName(renderer) {
  let text = String(renderer ?? "").trim();
  const angle = text.match(/^ANGLE \(([^,]*),\s*(.*?)(?:,\s*[^,]*)?\)$/);
  if ( angle ) text = angle[2] || angle[1];
  text = text.replace(/\s*\(0x[0-9a-f]+\)/ig, "")
    .replace(/\s+(?:Direct3D\d*|D3D\d+|OpenGL(?: Engine)?|Vulkan|Metal)\b.*$/i, "")
    .replace(/\s+vs_\d_\d.*$/i, "")
    .replace(/\(R\)|\(TM\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.slice(0, 80);
}

/**
 * The browser from the user agent string and, when available, the client hints of Chromium.
 * @param {string} ua
 * @param {{brand: string, version: string}[]} [brands]
 * @returns {{name: string, version: string, engine: string, app: boolean}}
 *   engine: "chromium", "firefox", "safari" or "other"; app: the Foundry desktop app (Electron)
 */
export function parseBrowser(ua, brands=[]) {
  const text = String(ua ?? "");
  const electron = text.match(/Electron\/(\d+)/);
  if ( electron ) return {name: "Foundry App", version: electron[1], engine: "chromium", app: true};
  const firefox = text.match(/Firefox\/(\d+)/);
  if ( firefox ) return {name: "Firefox", version: firefox[1], engine: "firefox", app: false};
  const known = [["Microsoft Edge", "Edge"], ["Opera", "Opera"], ["Brave", "Brave"], ["Vivaldi", "Vivaldi"],
    ["Google Chrome", "Chrome"], ["Chromium", "Chromium"]];
  for ( const [brand, name] of known ) {
    const hit = (brands ?? []).find(b => b.brand === brand);
    if ( hit ) return {name, version: String(hit.version).split(".")[0], engine: "chromium", app: false};
  }
  const edge = text.match(/Edg\/(\d+)/);
  if ( edge ) return {name: "Edge", version: edge[1], engine: "chromium", app: false};
  const opera = text.match(/OPR\/(\d+)/);
  if ( opera ) return {name: "Opera", version: opera[1], engine: "chromium", app: false};
  const chrome = text.match(/Chrom(?:e|ium)\/(\d+)/);
  if ( chrome ) return {name: "Chrome", version: chrome[1], engine: "chromium", app: false};
  const safari = text.match(/Version\/(\d+(?:\.\d+)?).*Safari\//);
  if ( safari ) return {name: "Safari", version: safari[1], engine: "safari", app: false};
  return {name: "Browser", version: "", engine: "other", app: false};
}

/**
 * The operating system from the user agent string.
 * @param {string} ua
 * @param {string} [platform]   navigator.userAgentData.platform
 * @returns {string}  "Windows", "macOS", "Linux", "ChromeOS", "Android", "iOS" or ""
 */
export function parseOs(ua, platform="") {
  const text = `${platform} ${ua ?? ""}`;
  if ( /windows/i.test(text) ) return "Windows";
  if ( /android/i.test(text) ) return "Android";
  if ( /iphone|ipad|ios/i.test(text) ) return "iOS";
  if ( /cros|chrome os|chromeos/i.test(text) ) return "ChromeOS";
  if ( /mac ?os|macintosh/i.test(text) ) return "macOS";
  if ( /linux/i.test(text) ) return "Linux";
  return "";
}

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/** Graphics details stay the same while the page lives. */
let gpuCache = null;

/**
 * The graphics chip as WebGL reports it.
 * @returns {{renderer: string, vendor: string, kind: string, software: boolean, name: string, maxTexture: number|null,
 *   webgl2: boolean}}
 */
export function readGpu() {
  if ( gpuCache ) return gpuCache;
  let gl = globalThis.canvas?.app?.renderer?.gl ?? null;
  let temp = null;
  if ( !gl ) {
    try {
      temp = document.createElement("canvas");
      gl = temp.getContext("webgl2") || temp.getContext("webgl");
    } catch {
      gl = null;
    }
  }
  let renderer = "";
  let vendor = "";
  let maxTexture = null;
  try {
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    renderer = String((info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || gl?.getParameter(gl.RENDERER) || "");
    vendor = String((info && gl.getParameter(info.UNMASKED_VENDOR_WEBGL)) || gl?.getParameter(gl.VENDOR) || "");
    maxTexture = gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? null;
  } catch {
    // Some privacy settings hide the renderer
  }
  const webgl2 = (typeof WebGL2RenderingContext !== "undefined") && (gl instanceof WebGL2RenderingContext);
  const result = {renderer, vendor, maxTexture, webgl2, ...classifyRenderer(renderer)};
  if ( globalThis.canvas?.app?.renderer?.gl ) gpuCache = result;
  temp?.remove?.();
  return result;
}

/**
 * Foundry's graphics settings of this user, as stored and as the canvas uses them.
 * @returns {object}
 */
export function readFoundrySettings() {
  const get = key => {
    try {
      return game.settings.get("core", key);
    } catch {
      return undefined;
    }
  };
  const perf = globalThis.canvas?.performance ?? null;
  return {
    performanceMode: get("performanceMode"),
    effectiveMode: perf?.mode ?? null,
    maxFPS: get("maxFPS"),
    scaling: get("pixelRatioResolutionScaling"),
    lightAnimation: get("lightAnimation"),
    visionAnimation: get("visionAnimation"),
    mipmap: get("mipmap"),
    noCanvas: get("noCanvas"),
    softEdges: perf?.lightSoftEdges ?? null,
    smaa: perf?.smaa ?? null
  };
}

/**
 * Everything about this computer the diagnosis looks at.
 * @returns {object}
 */
export function readEnvironment() {
  const ua = navigator.userAgent;
  const data = navigator.userAgentData;
  const browser = parseBrowser(ua, data?.brands);
  const renderer = globalThis.canvas?.app?.renderer;
  const view = renderer?.view;
  return {
    gpu: readGpu(),
    browser,
    os: parseOs(ua, data?.platform),
    mobile: !!data?.mobile || /Mobi|Android|iPad|iPhone/i.test(ua),
    cores: navigator.hardwareConcurrency ?? null,
    deviceMemory: navigator.deviceMemory ?? null,
    screen: {width: window.screen?.width ?? 0, height: window.screen?.height ?? 0, dpr: window.devicePixelRatio || 1},
    viewport: {width: window.innerWidth, height: window.innerHeight},
    canvasPixels: view ? (view.width * view.height) : null,
    resolution: renderer?.resolution ?? null,
    connection: navigator.connection ? {type: navigator.connection.effectiveType ?? "",
      downlink: navigator.connection.downlink ?? null, saveData: !!navigator.connection.saveData} : null,
    hidden: document.hidden,
    settings: readFoundrySettings(),
    issues: Object.keys(game.issues?.usabilityIssues ?? {}),
    battery: batteryState
  };
}

/** The battery, read in the background (Chromium only). */
let batteryState = null;

/** Start following the battery state. */
export async function watchBattery() {
  try {
    const battery = await navigator.getBattery?.();
    if ( !battery ) return;
    const read = () => {
      batteryState = {charging: battery.charging, level: battery.level};
    };
    read();
    battery.addEventListener("chargingchange", read);
    battery.addEventListener("levelchange", read);
  } catch {
    // No battery API: nothing to tell
  }
}
