/**
 * Made-up data for the sample windows (sample-windows.mjs): numbers a slow computer, a heavy map, a crowded table or
 * a big world would give, so the window shows every result state without a measurement. Plain functions, no Foundry:
 * the real rules (rules.mjs, scene-check.mjs, table.mjs, world-check.mjs) turn the numbers into findings, so the
 * hints in the samples are the ones a real measurement would bring.
 */

import {classifyRenderer} from "./environment.mjs";
import {finding, suggestedSettings, diagnoseClient} from "./rules.mjs";
import {summarizeScene} from "./scene-check.mjs";
import {diagnoseWorld} from "./world-check.mjs";
import {sampleCast} from "./samples.mjs";

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Titles of the made-up packages in the module measurement. */
export const SAMPLE_OWNERS = {
  "module:sample-fancy-fog": "Fancy Fog",
  "module:sample-misty-lights": "Misty Lights",
  "module:sample-token-sparkle": "Token Sparkle",
  "module:sample-auto-weather": "Auto Weather",
  "module:sample-night-vision": "Night Vision Plus"
};

/** Every entry of the sample list: kind, tab and what the window shows. */
export const KINDS = [
  "overview-cpu", "overview-gpu", "overview-software", "overview-fine", "overview-all",
  "assistant-measuring", "assistant-proposal", "assistant-nothing", "assistant-reload", "assistant-verifying",
  "assistant-better", "assistant-same",
  "pc", "pc-idle", "pc-busy",
  "scene", "scene-alone", "scene-checking", "scene-failed", "scene-none",
  "modules", "modules-measuring", "modules-test", "modules-hint",
  "players", "players-line", "players-alone",
  "world", "world-checking",
  "player-overview", "player-scene", "player-modules"
];

/* -------------------------------------------- */
/*  Pieces                                      */
/* -------------------------------------------- */

/** This computer's numbers. */
function snapshotOf({fps, cpuShare, longShare = 0, target = 60, gpu = "nvidia", browser = "Chrome", dpr = 1.25, canvasMp = 5.1,
  mode = 2, maxFPS = 60, lightAnimation = true, visionAnimation = true, battery = null, latency = 38, failures = 0,
  speed = 4.2e6, speedSource = "estimate", memory = null, scene = null, saveData = false, seconds = 15, maxTexture = 16384}) {
  const renderers = {
    nvidia: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    intel: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    software: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"
  };
  const renderer = renderers[gpu];
  const info = classifyRenderer(renderer);
  const engine = browser === "Firefox" ? "firefox" : "chromium";
  return {
    env: {
      gpu: {renderer, vendor: "Google Inc.", maxTexture, webgl2: true, ...info},
      browser: {name: browser, version: browser === "Firefox" ? "132" : "130", engine, app: false},
      os: "Windows",
      mobile: false,
      cores: 8,
      deviceMemory: 8,
      screen: {width: 2560, height: 1440, dpr},
      viewport: {width: 1900, height: 1000},
      canvasPixels: canvasMp * 1e6,
      resolution: dpr,
      connection: {type: "4g", downlink: 20, saveData},
      hidden: false,
      settings: {performanceMode: mode, effectiveMode: mode, maxFPS, scaling: true, lightAnimation, visionAnimation, mipmap: true,
        noCanvas: false, softEdges: true, smaa: true},
      issues: [],
      battery
    },
    frames: {seconds, frames: Math.round(fps * seconds), target, fps, fpsLow: Math.max(1, Math.round(fps - 6)),
      frameMs: 1000 / fps, cpuMs: (1000 / fps) * cpuShare, cpuShare, maxFrameMs: 1000 / Math.max(1, fps - 12),
      longMs: longShare * seconds * 1000, longShare, hiddenSeconds: 0},
    latency: {avg: latency, last: latency, samples: 8, failures},
    bandwidth: speed ? {bytesPerSecond: speed, source: speedSource} : null,
    memory: memory ?? {used: 1.4 * GB, limit: 4 * GB, textures: 0.9 * GB},
    scene,
    canvas: true
  };
}

/** The graph of the last minute: frames per second, one value per second. */
function seriesOf(fps, wobble = 3) {
  return Array.from({length: 60}, (_, i) => Math.max(1, Math.round(fps + Math.sin(i / 4) * wobble + ((i * 7) % 5) - 2)));
}

/** A file of a scene. */
function asset(src, {bytes, w = 0, h = 0, type = "image/webp", roles = ["background"], uses = 1, video = false, audio = false}) {
  return {src, roles: new Set(roles), uses, docs: [], bytes, type, width: w || null, height: h || null, video, audio, animated: false,
    error: null};
}

function counts(over = {}) {
  return {walls: 420, doors: 18, lights: 22, animatedLights: 6, tokens: 24, visionTokens: 5, tiles: 40, videos: 0, sounds: 6,
    drawings: 30, notes: 12, regions: 3, levels: 1, ...over};
}

const SCENES = {
  mill: (now, text) => summarizeScene([
    asset("worlds/demo/maps/old-mill-day.png", {bytes: 44 * MB, w: 7600, h: 5200, type: "image/png"}),
    asset("worlds/demo/maps/mill-cellar.jpg", {bytes: 9 * MB, w: 9000, h: 6000, type: "image/jpeg", roles: ["foreground"]}),
    asset("worlds/demo/maps/mill-roof.webp", {bytes: 5 * MB, w: 6144, h: 4096, roles: ["tile"]}),
    asset("worlds/demo/maps/fog-drift.png", {bytes: 7 * MB, w: 4096, h: 4096, type: "image/png", roles: ["fog"]}),
    asset("worlds/demo/video/waterfall.webm", {bytes: 24 * MB, w: 1920, h: 1080, type: "video/webm", roles: ["tile"], video: true}),
    asset("worlds/demo/tokens/miller.webp", {bytes: 0.2 * MB, w: 400, h: 400, roles: ["token"], uses: 6}),
    asset("worlds/demo/audio/mill-wheel.ogg", {bytes: 3 * MB, type: "audio/ogg", roles: ["sound"], audio: true})
  ], counts({tokens: 160, lights: 70, videos: 1, tiles: 120}), {id: "mill", name: text("place"), at: now - 90 * 1000}),
  square: (now, text) => summarizeScene([
    asset("worlds/demo/maps/market-square.webp", {bytes: 3 * MB, w: 4000, h: 3000}),
    asset("worlds/demo/tokens/merchant.webp", {bytes: 0.2 * MB, w: 400, h: 400, roles: ["token"]})
  ], counts({tokens: 12, lights: 6, animatedLights: 0}), {id: "square", name: text("sceneSquare"), at: now - 5 * 60 * 1000}),
  caves: (now, text) => summarizeScene([
    asset("worlds/demo/maps/echo-caves-a.png", {bytes: 18 * MB, w: 16000, h: 9000, type: "image/png"}),
    asset("worlds/demo/maps/echo-caves-b.jpg", {bytes: 12 * MB, w: 16000, h: 9000, type: "image/jpeg", roles: ["foreground"]}),
    asset("worlds/demo/maps/echo-caves-c.jpg", {bytes: 11 * MB, w: 16000, h: 9000, type: "image/jpeg", roles: ["tile"]}),
    asset("data:image/png;base64,iVBORw0KGgo", {bytes: 40000, w: 64, h: 64, type: "image/png", roles: ["tile"]})
  ], counts({walls: 6400, doors: 60, lights: 160, animatedLights: 70, tokens: 380, visionTokens: 110, tiles: 640, videos: 9,
    sounds: 130, drawings: 1300}), {id: "caves", name: text("sceneCaves"), at: now - 40 * 1000})
};

/** The report a client sends to the GM. */
function report({fps, rating, latency = 40, speed = 5e6, gpu = {}, browser = "Chrome 130", issues = [], hidden = false}) {
  const kind = gpu.kind ?? "dedicated";
  return {type: "report", v: 1, fps, target: 60, cpu: null, rating, latency, speed, speedSource: "estimate",
    gpu: {name: gpu.name ?? "NVIDIA GeForce GTX 1660", kind, software: !!gpu.software, maxTexture: gpu.maxTexture ?? 16384},
    browser, os: "Windows", dpr: 1, mode: 2, maxFPS: 60, memory: null, hidden, issues};
}

const COLORS = ["#d9822b", "#3f8f6b", "#5b7fc7", "#a35fb5"];

function tableOf(cast, rows, gmName, now) {
  const players = cast.filter(m => m.side === "party");
  const list = rows.map((spec, i) => ({
    id: `sample-${players[i].id}`,
    name: players[i].player,
    color: COLORS[i],
    isGM: false,
    self: false,
    report: spec.report,
    age: spec.age ?? 4,
    load: spec.load ?? null
  }));
  list.push({id: "sample-gm", name: gmName, color: "#888888", isGM: true, self: true, age: 2, load: null,
    report: report({fps: 60, rating: "good", latency: 3, speed: null})});
  return list.sort((a, b) => (a.self - b.self) || a.name.localeCompare(b.name));
}

function loadOf(user, userId, scene, now, props) {
  return {userId, name: user, sceneId: "mill", sceneName: scene, phase: "done", failed: [], error: null, bytes: null, speed: null,
    ms: null, startedAt: now - 60000, ...props};
}

/** Sample result of the module measurement. */
function profileOf() {
  const durationMs = 15000;
  const row = (owner, perSecond, {maxMs = 0, topLabel = "", kinds, labels}) => ({
    owner, ms: perSecond * 15, msPerSecond: perSecond, calls: 300, maxMs, topLabel,
    kinds: Object.fromEntries(Object.entries(kinds).map(([k, share]) => [k, perSecond * 15 * share])),
    labels: labels.map(([label, kind, calls, mps]) => ({label, kind, calls, ms: mps * 15, msPerSecond: mps}))
  });
  return {durationMs, rows: [
    row("core", 310, {maxMs: 22, kinds: {hook: 0.4, ticker: 0.6}, labels: [["canvas.app.render", "ticker", 880, 190], ["updateToken", "hook", 140, 60]]}),
    row("module:sample-fancy-fog", 285, {maxMs: 48, topLabel: "canvasPan", kinds: {ticker: 0.8, hook: 0.2},
      labels: [["FogLayer.animate", "ticker", 880, 210], ["canvasPan", "hook", 400, 55], ["setInterval", "timer", 30, 20]]}),
    row("module:sample-misty-lights", 140, {maxMs: 31, kinds: {ticker: 0.7, frame: 0.3},
      labels: [["LightSource.flicker", "ticker", 880, 100], ["requestAnimationFrame", "frame", 440, 40]]}),
    row("system:dnd5e", 90, {maxMs: 12, kinds: {hook: 1}, labels: [["renderChatMessage", "hook", 60, 50], ["updateActor", "hook", 25, 40]]}),
    row("module:sample-token-sparkle", 22, {maxMs: 160, topLabel: "updateToken", kinds: {hook: 1},
      labels: [["updateToken", "hook", 12, 22]]}),
    row("extension", 18, {maxMs: 14, kinds: {timer: 1}, labels: [["setTimeout", "timer", 90, 18]]}),
    row("world", 9, {maxMs: 6, kinds: {hook: 1}, labels: [["canvasReady", "hook", 3, 9]]}),
    row("module:sephrals-performance-doctor", 4, {maxMs: 2, kinds: {ticker: 1}, labels: [["meter", "ticker", 880, 4]]})
  ]};
}

function startupOf(now) {
  return {at: now - 3 * 3600 * 1000, durationMs: 11200,
    rows: [{owner: "module:sample-fancy-fog", ms: 1480}, {owner: "module:sample-auto-weather", ms: 620}, {owner: "module:sample-night-vision", ms: 210},
      {owner: "system:dnd5e", ms: 1900}, {owner: "core", ms: 3000}],
    downloads: [{owner: "module:sample-fancy-fog", bytes: 14 * MB}, {owner: "content", bytes: 3 * MB}],
    phases: {scripts: 2100, init: 4300, setup: 6900, ready: 9800, done: 11200}};
}

function worldOf(now) {
  const collections = [
    {key: "messages", count: 6200, bytes: 24 * MB}, {key: "scenes", count: 34, bytes: 17 * MB}, {key: "actors", count: 240, bytes: 9 * MB},
    {key: "packs", count: 120, bytes: 7 * MB}, {key: "journal", count: 180, bytes: 6 * MB}, {key: "items", count: 900, bytes: 4 * MB},
    {key: "tables", count: 40, bytes: 1.2 * MB}, {key: "settings", count: 210, bytes: 0.6 * MB}, {key: "other", count: null, bytes: 0.2 * MB}
  ];
  const largest = [
    {collection: "journal", id: "j1", name: "The Mill Chronicle", bytes: 9 * MB, embedded: 4},
    {collection: "scenes", id: "s1", name: "The old mill", bytes: 3.4 * MB, embedded: 0},
    {collection: "actors", id: "a1", name: "Ari", bytes: 2.6 * MB, embedded: 2},
    {collection: "journal", id: "j2", name: "Rumors", bytes: 1.1 * MB, embedded: 0}
  ];
  const analysis = {collections, total: collections.reduce((s, c) => s + c.bytes, 0), largest,
    embedded: largest.filter(d => d.embedded)};
  const disk = {messages: 31 * MB, scenes: 19 * MB, actors: 11 * MB, fog: 62 * MB};
  const messages = 6200;
  const activeModules = 112;
  return {...analysis, disk, activeModules, messages, packs: 120, at: now,
    findings: diagnoseWorld(analysis, {messages, disk, activeModules})};
}

/** Every hint of this client at once, with the fixes the real rules offer. */
function allFindings() {
  const guide = id => ({kind: "guide", guide: id});
  const setting = (key, value, reload = false) => ({kind: "setting", key, value, reload});
  const action = name => ({kind: "action", action: name});
  return [
    finding("softwareRenderer", "pc", 3, {gpu: "SwiftShader", browser: "Chrome"}, [guide("accelChrome"), guide("drivers")]),
    finding("noWebGL2", "pc", 3, {}, [guide("browserUpdate"), guide("drivers")]),
    finding("oldBrowser", "pc", 2, {browser: "Chrome 98"}, [guide("browserUpdate")]),
    finding("noCanvas", "settings", 1),
    finding("hiddenTab", "pc", 1),
    finding("fpsCapped", "settings", 1, {fps: 30, max: 30}, [setting("maxFPS", 60)]),
    finding("slowCpu", "pc", 3, {fps: 22, target: 60, cpu: 78}, [action("profile"), action("experiments")]),
    finding("slowGpu", "pc", 2, {fps: 28, target: 60, cpu: 22}, [action("experiments"), action("wizard")]),
    finding("hidpi", "settings", 2, {dpr: 1.25, factor: 1.6}, [setting("pixelRatioResolutionScaling", false, true)]),
    finding("modeHigh", "settings", 2, {}, [setting("performanceMode", 1)]),
    finding("modeMedium", "settings", 2, {}, [setting("performanceMode", 0)]),
    finding("lightAnimation", "settings", 1, {count: 14}, [setting("lightAnimation", false)]),
    finding("visionAnimation", "settings", 1, {}, [setting("visionAnimation", false)]),
    finding("integratedGpu", "pc", 1, {gpu: "Intel UHD Graphics 620"}, [guide("gpuChoice")]),
    finding("battery", "pc", 2, {level: 42}, [guide("power")]),
    finding("fps30", "pc", 1, {fps: 30}, [guide("power")]),
    finding("largeCanvas", "pc", 1, {mp: 9.2}),
    finding("tryChromium", "pc", 1),
    finding("blocked", "modules", 3, {share: 34}, [action("profile")]),
    finding("memoryFull", "pc", 2, {used: 3.6 * GB, limit: 4 * GB}, [action("reload")]),
    finding("textureMemory", "scene", 1, {bytes: 2.9 * GB}),
    finding("latencyHigh", "network", 2, {ms: 420}, [guide("network")]),
    finding("connectionDrops", "network", 2, {count: 4}, [guide("network")]),
    finding("slowLine", "network", 2, {speed: 1.1e6, map: 50 * MB, ms: 47000}, [action("speedTest")]),
    finding("saveData", "network", 1),
    finding("sceneHeavy", "scene", 3, {bytes: 96 * MB, ms: 52000}, [{kind: "tellGM"}]),
    finding("sceneTooLargeForGpu", "scene", 3, {side: 16000, max: 8192}, [{kind: "tellGM"}])
  ];
}

/* -------------------------------------------- */
/*  The samples                                 */
/* -------------------------------------------- */

/**
 * The data of one sample entry.
 * @param {string} kind             One of KINDS
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {(key: string) => string} [options.text]   Localizes the few texts of the data (scene names, the GM)
 * @returns {{sample: object, tab: string, wizard?: object, busy?: object, banner?: {name: string}}}
 */
export function buildSample(kind, {now = Date.now(), text = key => key} = {}) {
  const cast = sampleCast();
  const gmName = text("gm");
  const cpu = snapshotOf({fps: 22, cpuShare: 0.78, longShare: 0.18, memory: {used: 3.6 * GB, limit: 4 * GB, textures: 1.1 * GB}});
  const gpuSnap = snapshotOf({fps: 28, cpuShare: 0.22, gpu: "intel", browser: "Firefox", canvasMp: 9.2, battery: {charging: false, level: 0.42},
    speed: 1.1e6, latency: 360});
  const software = snapshotOf({fps: 9, cpuShare: 0.9, gpu: "software", mode: 1});
  const fine = snapshotOf({fps: 60, cpuShare: 0.2, mode: 1, dpr: 1});
  const base = {gm: true, snap: cpu, series: seriesOf(22), rows: tableOf(cast, [
    {report: report({fps: 58, rating: "good"})},
    {report: report({fps: 54, rating: "good", latency: 52})},
    {report: report({fps: 57, rating: "good"})},
    {report: report({fps: 59, rating: "good", latency: 31})}
  ], gmName, now), loads: [], messages: [], changes: [], values: {performanceMode: 2, maxFPS: 60, pixelRatioResolutionScaling: true,
    lightAnimation: true, visionAnimation: true, mipmap: true}, experiments: null, speedTest: null, filterNames: [], scenes: [],
  summaries: {}, sceneState: null, players: [], copies: [], profile: null, loadouts: null, loadoutTest: null, downloads: [], startup: null,
  world: null, findings: null};
  const out = {sample: base, tab: "overview"};
  const place = text("place");
  const clientFindings = snap => diagnoseClient(snap);
  const assistant = extra => {
    out.wizard = extra;
    base.changes = [{key: "performanceMode"}, {key: "lightAnimation"}];
    return out;
  };
  switch ( kind ) {
    case "overview-cpu": break;
    case "overview-gpu": base.snap = gpuSnap; base.series = seriesOf(28); break;
    case "overview-software": base.snap = software; base.series = seriesOf(9, 1); break;
    case "overview-fine": base.snap = fine; base.series = seriesOf(60, 1); break;
    case "overview-all": base.findings = {client: allFindings()}; break;
    case "assistant-measuring": return assistant({stage: "measuring", progress: 0.6});
    case "assistant-verifying": return assistant({stage: "verifying", progress: 0.3, baseline: {fps: 22.4}});
    case "assistant-reload": return assistant({stage: "reload", baseline: {fps: 22.4}});
    case "assistant-proposal": case "assistant-nothing": {
      const snap = kind === "assistant-nothing" ? fine : snapshotOf({fps: 22, cpuShare: 0.78, longShare: 0.32,
        memory: {used: 3.6 * GB, limit: 4 * GB, textures: 1.1 * GB}});
      base.snap = snap;
      const findings = kind === "assistant-nothing" ? [] : clientFindings(snap);
      return assistant({stage: "proposal", baseline: {fps: 22.4}, findings,
        proposal: suggestedSettings(findings).map(p => ({...p, on: true}))});
    }
    case "assistant-better": return assistant({stage: "result", baseline: {fps: 22.4}, after: {fps: 58.3}});
    case "assistant-same": base.snap = gpuSnap; return assistant({stage: "result", baseline: {fps: 22.4}, after: {fps: 23.1}});
    case "pc": case "pc-idle": case "pc-busy": {
      out.tab = "pc";
      base.snap = gpuSnap;
      base.changes = [{key: "visionAnimation"}];
      base.values = {...base.values, visionAnimation: false};
      if ( kind === "pc" ) {
        base.experiments = {baseline: {fps: 24.3}, results: [
          {id: "animations", fps: 31.2, gain: 0.28},
          {id: "videos", count: 2, fps: 26.1, gain: 0.07},
          {id: "weather", fps: 24.9, gain: 0.02},
          {id: "filters", count: 3, fps: 27.4, gain: 0.13},
          {id: "lighting", fps: 25.8, gain: 0.06}
        ]};
        base.filterNames = [{name: "Glow Outline", count: 3}, {name: "Heat Haze", count: 1}];
        base.snap = {...gpuSnap, bandwidth: {bytesPerSecond: 3.1e6, source: "test"}};
        base.speedTest = {bytesPerSecond: 3.1e6};
      }
      if ( kind === "pc-busy" ) out.busy = {experiments: "step", speed: true};
      break;
    }
    case "scene": case "scene-alone": case "scene-checking": case "scene-failed": case "scene-none": {
      out.tab = "scene";
      if ( kind === "scene-none" ) break;
      if ( kind === "scene" ) {
        base.scenes = [{id: "mill", name: place, navName: place, active: true}, {id: "square", name: text("sceneSquare"), active: false}];
        base.summaries = {mill: SCENES.mill(now, text), square: SCENES.square(now, text)};
        base.players = [
          {name: "Lena", maxTexture: 16384, bytesPerSecond: 8.4e6},
          {name: "Tom", maxTexture: 8192, bytesPerSecond: 0.9e6},
          {name: "Sam", maxTexture: 16384, bytesPerSecond: 1.2e6}
        ];
        base.copies = [{to: "worlds/demo/maps/mill-roof.webp"}];
        base.loads = [
          loadOf("Lena", "u1", place, now, {ms: 6200, bytes: 112 * MB, speed: 8.4e6}),
          loadOf("Tom", "u2", place, now, {ms: 41800, bytes: 112 * MB, speed: 2.7e6}),
          loadOf("Sam", "u3", place, now, {phase: "failed", ms: 9000, failed: ["mill-cellar.jpg"]}),
          loadOf("Jo", "u4", place, now, {phase: "loading", startedAt: now - 23000})
        ];
        out.sceneId = "mill";
      }
      else {
        const name = text("sceneCaves");
        base.scenes = [{id: "caves", name, navName: name, active: false}];
        if ( kind === "scene-alone" ) base.summaries = {caves: SCENES.caves(now, text)};
        base.sceneState = kind === "scene-failed" ? "failed" : "checking";
        out.sceneId = "caves";
      }
      break;
    }
    case "modules": case "modules-measuring": case "modules-test": case "modules-hint": {
      out.tab = "modules";
      base.snap = cpu;
      base.profile = profileOf();
      base.downloads = [
        {owner: "content", bytes: 61 * MB, requests: 14}, {owner: "module:sample-fancy-fog", bytes: 48 * MB, requests: 23},
        {owner: "system:dnd5e", bytes: 12 * MB, requests: 80}, {owner: "world", bytes: 4 * MB, requests: 9}
      ];
      base.startup = startupOf(now);
      const flagged = ["sample-fancy-fog", "sample-misty-lights", "sample-token-sparkle"];
      base.loadouts = {choices: flagged.map((id, i) => ({id, name: SAMPLE_OWNERS[`module:${id}`], on: i < 2,
        perSecond: [285, 140, 22][i], flagged: true})), any: true};
      if ( kind === "modules-measuring" ) out.busy = {profile: 0.45};
      if ( kind === "modules-test" ) base.loadoutTest = {loadoutId: "sample", names: ["Fancy Fog", "Misty Lights"], before: 41};
      if ( kind === "modules-hint" ) base.loadouts = {hint: true};
      break;
    }
    case "players": case "players-line": case "players-alone": {
      out.tab = "players";
      if ( kind === "players-alone" ) {
        base.rows = tableOf(cast, [], gmName, now);
        break;
      }
      const slow = kind === "players-line";
      const software = {name: "Microsoft Basic Render Driver", kind: "software", software: true, maxTexture: 8192};
      const intel = {name: "Intel UHD Graphics 620", kind: "integrated", maxTexture: 16384};
      base.rows = tableOf(cast, [
        {report: report({fps: slow ? 41 : 58, rating: slow ? "fair" : "good", latency: slow ? 520 : 38, speed: slow ? 1.1e6 : 9.2e6,
          issues: slow ? [{id: "slowLine", severity: 2, data: {speed: 1.1e6}}] : []}),
        load: loadOf("Lena", "u1", place, now, {ms: 6200, bytes: 112 * MB, speed: 8.4e6})},
        {report: report({fps: 11, rating: "poor", latency: slow ? 610 : 180, speed: slow ? 0.9e6 : 0.9e6, gpu: software, browser: "Edge 130",
          issues: [{id: "softwareRenderer", severity: 3, data: {gpu: software.name, browser: "Edge"}}]}),
        load: loadOf("Tom", "u2", place, now, {ms: 41800, bytes: 112 * MB, speed: 2.7e6})},
        {report: report({fps: 27, rating: "fair", latency: slow ? 450 : 640, speed: 1.2e6, gpu: intel,
          issues: [{id: "latencyHigh", severity: 2, data: {ms: 640}}]}), age: 130,
        load: loadOf("Sam", "u3", place, now, {phase: "failed", ms: 9000, failed: ["mill-cellar.jpg"]})},
        {report: report({fps: null, rating: "none", latency: slow ? 480 : 44, speed: slow ? 1.0e6 : 6e6, hidden: true}),
        load: loadOf("Jo", "u4", place, now, {phase: "loading", startedAt: now - 23000})}
      ], gmName, now);
      base.loads = [
        loadOf("Lena", "u1", place, now, {ms: 6200, bytes: 112 * MB, speed: 8.4e6}),
        loadOf("Tom", "u2", place, now, {ms: 41800, bytes: 112 * MB, speed: 2.7e6}),
        loadOf("Sam", "u3", place, now, {phase: "failed", ms: 9000, failed: ["mill-cellar.jpg"]})
      ];
      base.messages = [
        {name: "Sam", finding: {id: "slowLine", severity: 2, data: {speed: 1.2e6}}, at: now - 2 * 60 * 1000},
        {name: "Tom", finding: {id: "sceneTooLargeForGpu", severity: 3, data: {side: 9000, max: 8192}}, at: now - 9 * 60 * 1000}
      ];
      break;
    }
    case "world": case "world-checking": {
      out.tab = "world";
      if ( kind === "world" ) base.world = worldOf(now);
      else out.busy = {world: true};
      break;
    }
    case "player-overview": case "player-scene": case "player-modules": {
      base.gm = false;
      const scene = SCENES.mill(now, text);
      const snap = snapshotOf({fps: 24, cpuShare: 0.7, longShare: 0.15, gpu: "intel", maxTexture: 8192, scene,
        speed: 1.8e6, latency: 380});
      base.snap = snap;
      base.series = seriesOf(24);
      base.summaries = {};
      if ( kind === "player-overview" ) out.banner = {name: gmName};
      if ( kind === "player-scene" ) out.tab = "scene";
      if ( kind === "player-scene" ) {
        base.scenes = [{id: "mill", name: place, navName: place, active: true}];
        base.summaries = {mill: scene};
        out.sceneId = "mill";
      }
      if ( kind === "player-modules" ) {
        out.tab = "modules";
        base.profile = profileOf();
        base.downloads = [{owner: "content", bytes: 61 * MB, requests: 14}, {owner: "module:sample-fancy-fog", bytes: 48 * MB, requests: 23}];
        base.startup = startupOf(now);
      }
      break;
    }
    default: throw new Error(`Unknown sample ${kind}`);
  }
  return out;
}

export const __test__ = {snapshotOf, report, allFindings, profileOf, worldOf};
