import assert from "node:assert/strict";
import test from "node:test";
import {
  MODES, accelerationGuide, bottleneck, diagnoseClient, diagnoseProfile, sortFindings, suggestedSettings, worst
} from "../scripts/rules.mjs";

/** A computer as readEnvironment() describes it. */
function env(extra={}) {
  return {
    gpu: {renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)", name: "NVIDIA GeForce RTX 3060", kind: "dedicated",
      software: false, maxTexture: 16384, webgl2: true},
    browser: {name: "Chrome", version: "141", engine: "chromium", app: false},
    os: "Windows",
    screen: {width: 1920, height: 1080, dpr: 1},
    canvasPixels: 1920 * 1080,
    settings: {performanceMode: MODES.HIGH, effectiveMode: MODES.HIGH, maxFPS: 60, scaling: true, lightAnimation: true,
      visionAnimation: true, mipmap: true, noCanvas: false},
    issues: [],
    battery: null,
    ...extra
  };
}

/** Frames as meter.summarize() reports them. */
function frames(fps, cpuShare=0.1, extra={}) {
  return {seconds: 15, frames: fps * 15, target: 60, fps, fpsLow: fps, frameMs: 1000 / fps, cpuMs: (1000 / fps) * cpuShare,
    cpuShare, maxFrameMs: 1000 / fps, longMs: 0, longShare: 0, hiddenSeconds: 0, ...extra};
}

const ids = list => list.map(f => f.id);

test("a smooth game has nothing to fix", () => {
  const list = diagnoseClient({env: env(), frames: frames(59)});
  assert.deepEqual(ids(list), ["framesGood"]);
  assert.equal(worst(list), 0);
});

test("drawing without a graphics card comes first, with the guide of the browser", () => {
  const e = env({gpu: {renderer: "SwiftShader", name: "SwiftShader", kind: "software", software: true, maxTexture: 8192, webgl2: true},
    browser: {name: "Edge", version: "141", engine: "chromium", app: false}});
  const list = diagnoseClient({env: e, frames: frames(4, 0.05)});
  assert.equal(list[0].id, "softwareRenderer");
  assert.equal(list[0].severity, 3);
  assert.equal(list[0].fixes[0].guide, "accelEdge");
});

test("a slow game limited by the graphics chip suggests lighter settings", () => {
  const e = env({screen: {width: 2560, height: 1440, dpr: 2}});
  const list = diagnoseClient({env: e, frames: frames(9, 0.08)});
  const found = ids(list);
  assert.ok(found.includes("slowGpu"));
  assert.ok(found.includes("hidpi"));
  assert.ok(found.includes("modeHigh"));
  assert.ok(found.includes("lightAnimation"));
  assert.ok(found.includes("visionAnimation"));
  const hidpi = list.find(f => f.id === "hidpi");
  assert.deepEqual(hidpi.fixes[0], {kind: "setting", key: "pixelRatioResolutionScaling", value: false, reload: true});
  assert.equal(hidpi.data.factor, 4);
});

test("a slow game limited by scripts points to the module measurement", () => {
  const list = diagnoseClient({env: env(), frames: frames(20, 0.8)});
  const slow = list.find(f => f.id === "slowCpu");
  assert.ok(slow);
  assert.equal(slow.fixes[0].action, "profile");
});

test("medium quality that is still too slow suggests low", () => {
  const e = env({settings: {...env().settings, performanceMode: MODES.MED, effectiveMode: MODES.MED}});
  const list = diagnoseClient({env: e, frames: frames(8, 0.1)});
  const f = list.find(x => x.id === "modeMedium");
  assert.equal(f.fixes[0].value, MODES.LOW);
});

test("battery, the 30 frames pattern and built-in graphics", () => {
  const e = env({battery: {charging: false, level: 0.4}, gpu: {...env().gpu, kind: "integrated", name: "Intel UHD 620"}});
  const list = diagnoseClient({env: e, frames: frames(30, 0.1)});
  const found = ids(list);
  assert.ok(found.includes("battery"));
  assert.ok(found.includes("fps30"));
  assert.ok(found.includes("integratedGpu"));
});

test("a limit of 30 frames on a fast computer is a hint", () => {
  const e = env({settings: {...env().settings, maxFPS: 30}});
  const list = diagnoseClient({env: e, frames: {...frames(30, 0.05), target: 30}});
  assert.ok(ids(list).includes("fpsCapped"));
});

test("the connection: latency needs two samples, a slow line offers the test", () => {
  assert.ok(!ids(diagnoseClient({env: env(), frames: frames(60), latency: {avg: 2000, samples: 1, failures: 0}})).includes("latencyHigh"));
  const list = diagnoseClient({env: env(), frames: frames(60), latency: {avg: 450, samples: 4, failures: 0},
    bandwidth: {bytesPerSecond: 500000, source: "estimate"}});
  assert.equal(list.find(f => f.id === "latencyHigh").severity, 2);
  const line = list.find(f => f.id === "slowLine");
  assert.equal(line.severity, 3);
  assert.equal(line.fixes[0].action, "speedTest");
});

test("the viewed scene: heavy, and too large for this graphics chip", () => {
  const list = diagnoseClient({env: env({gpu: {...env().gpu, maxTexture: 8192}}), frames: frames(60),
    scene: {totalBytes: 90 * 1024 * 1024, largestSide: 9000, animatedLights: 0}, bandwidth: {bytesPerSecond: 2e6}});
  const heavy = list.find(f => f.id === "sceneHeavy");
  assert.equal(heavy.severity, 3);
  assert.ok(heavy.data.ms > 40000);
  assert.ok(ids(list).includes("sceneTooLargeForGpu"));
});

test("no animated lights in the scene: no light animation hint", () => {
  const list = diagnoseClient({env: env(), frames: frames(10, 0.1), scene: {totalBytes: 0, largestSide: 0, animatedLights: 0}});
  assert.ok(!ids(list).includes("lightAnimation"));
});

test("suggested settings come once, most helpful first", () => {
  const list = diagnoseClient({env: env({screen: {width: 1, height: 1, dpr: 1.5}}), frames: frames(8, 0.1)});
  const settings = suggestedSettings(list);
  assert.deepEqual(settings.map(s => s.key), ["pixelRatioResolutionScaling", "performanceMode", "lightAnimation", "visionAnimation"]);
  assert.equal(new Set(settings.map(s => s.key)).size, settings.length);
});

test("where the time of a frame goes", () => {
  assert.equal(bottleneck(frames(10, 0.7)), "cpu");
  assert.equal(bottleneck(frames(10, 0.2)), "gpu");
  assert.equal(bottleneck(frames(10, 0.2, {longShare: 0.3})), "cpu");
  assert.equal(bottleneck({frames: 0, cpuShare: null}), null);
});

test("guides by browser", () => {
  assert.equal(accelerationGuide({name: "Chrome"}), "accelChrome");
  assert.equal(accelerationGuide({name: "Firefox", engine: "firefox"}), "accelFirefox");
  assert.equal(accelerationGuide({name: "Foundry App", app: true}), "accelApp");
  assert.equal(accelerationGuide({name: "Vivaldi"}), "accelChrome");
});

test("the module measurement blames heavy modules, never Foundry or the doctor", () => {
  const rows = [
    {owner: "core", msPerSecond: 400, maxMs: 30},
    {owner: "module:sephrals-performance-doctor", msPerSecond: 300, maxMs: 5},
    {owner: "module:heavy", msPerSecond: 280, maxMs: 6},
    {owner: "module:medium", msPerSecond: 120, maxMs: 6},
    {owner: "module:spiky", msPerSecond: 20, maxMs: 180, topLabel: "renderChatMessage"},
    {owner: "module:quiet", msPerSecond: 5, maxMs: 2}
  ];
  const list = diagnoseProfile(rows, {self: "module:sephrals-performance-doctor"});
  assert.deepEqual(list.map(f => `${f.severity}:${f.id}:${f.data.owner}`),
    ["3:moduleHeavy:module:heavy", "2:moduleHeavy:module:medium", "2:moduleSpike:module:spiky"]);
});

test("sorting puts serious findings first", () => {
  const list = sortFindings([{id: "a", area: "scene", severity: 1}, {id: "b", area: "pc", severity: 3}, {id: "c", area: "pc", severity: 1}]);
  assert.deepEqual(ids(list), ["b", "c", "a"]);
});
