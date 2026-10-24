import assert from "node:assert/strict";
import test from "node:test";
import {PRESETS, mergeUndo, planChanges} from "../scripts/fixes.mjs";
import {WEBP_MAX, optimizedName, shortHash, targetSize} from "../scripts/image-tools.mjs";
import {createAccumulator, listenerLabel, longFrameTime, record, summarizeProfile} from "../scripts/profiler.mjs";
import {buildReport, diagnoseTable} from "../scripts/table.mjs";
import {analyzeData, countDataUris, diagnoseWorld} from "../scripts/world-check.mjs";

const MB = 1024 * 1024;

test("settings changes leave out what is already set", () => {
  const plan = planChanges(PRESETS.light, {performanceMode: 0, maxFPS: 60, lightAnimation: true, visionAnimation: false,
    pixelRatioResolutionScaling: true, mipmap: true});
  assert.deepEqual(plan.map(c => c.key), ["maxFPS", "lightAnimation", "pixelRatioResolutionScaling"]);
  assert.equal(plan.find(c => c.key === "pixelRatioResolutionScaling").reload, true);
  assert.deepEqual(planChanges({unknown: 1}, {}), []);
});

test("undo keeps the first old value of a setting", () => {
  let list = mergeUndo([], [{key: "maxFPS", previous: 60, value: 30}]);
  list = mergeUndo(list, [{key: "maxFPS", previous: 30, value: 20}, {key: "mipmap", previous: true, value: false}]);
  assert.deepEqual(list.map(e => [e.key, e.previous, e.value]), [["maxFPS", 60, 20], ["mipmap", true, false]]);
  // Back at the old value: nothing to undo
  assert.deepEqual(mergeUndo(list, [{key: "maxFPS", previous: 20, value: 60}]).map(e => e.key), ["mipmap"]);
});

test("the size of a smaller copy", () => {
  assert.deepEqual(targetSize(12000, 8000, 8192), {width: 8192, height: 5461, scaled: true});
  assert.deepEqual(targetSize(3000, 2000, 8192), {width: 3000, height: 2000, scaled: false});
  assert.deepEqual(targetSize(20000, 10000, 0), {width: WEBP_MAX, height: 8192, scaled: true});
});

test("names of copies are stable and safe", () => {
  assert.equal(shortHash("abc"), shortHash("abc"));
  assert.notEqual(shortHash("abc"), shortHash("abd"));
  const name = optimizedName("maps/Drachen Höhle (groß).PNG?x=1", 8192, 0.85);
  assert.match(name, /^Drachen-Hohle-gro\w*-[0-9a-f]{6}\.webp$/);
  assert.notEqual(name, optimizedName("maps/Drachen Höhle (groß).PNG?x=1", 4096, 0.85));
});

test("the profile: own time, labels, long frames", () => {
  const acc = createAccumulator();
  record(acc, "module:a", "hook", "updateToken", 4);
  record(acc, "module:a", "ticker", "tick", 10);
  record(acc, "module:a", "ticker", "tick", 6);
  record(acc, "core", "ticker", "canvas.app.render", 30);
  const rows = summarizeProfile(acc, {durationMs: 2000, longFrames: [{scripts: [
    {owner: "module:b", ms: 80, layout: 5, type: "event-listener"},
    {owner: "module:a", ms: 5, layout: 0, type: "user-callback"}]}]});
  assert.deepEqual(rows.map(r => r.owner), ["module:b", "core", "module:a"]);
  const a = rows.find(r => r.owner === "module:a");
  assert.equal(a.ms, 20);
  assert.equal(a.msPerSecond, 10);
  assert.equal(a.calls, 3);
  assert.equal(a.maxMs, 10);
  assert.equal(a.labels[0].label, "tick");
  assert.equal(a.labels[0].calls, 2);
  const b = rows.find(r => r.owner === "module:b");
  assert.equal(b.ms, 80);
  assert.equal(b.kinds.long, 80);
  assert.deepEqual(b.invokers, {"event-listener": 80});
  assert.equal(longFrameTime([{scripts: [{owner: "x", ms: 2, layout: 1}]}]).get("x").layout, 1);
});

test("labels of ticker listeners", () => {
  class LightingLayer {}
  function animate() {}
  assert.equal(listenerLabel(animate, new LightingLayer()), "LightingLayer.animate");
  assert.equal(listenerLabel(function() {}, null), "anonymous");
  assert.equal(listenerLabel(animate.bind(null), {}), "animate");
});

test("the report to the GM is short and carries the serious findings", () => {
  const snap = {
    env: {gpu: {name: "SwiftShader", kind: "software", software: true, maxTexture: 8192}, browser: {name: "Chrome", version: "141"},
      os: "Windows", screen: {dpr: 1}, settings: {performanceMode: 2, effectiveMode: 2, maxFPS: 60}, hidden: false},
    frames: {fps: 4.26, target: 60, cpuShare: 0.05},
    latency: {avg: 48.3},
    bandwidth: {bytesPerSecond: 1234567.8, source: "test"},
    memory: {used: 50, limit: 100}
  };
  const findings = [{id: "softwareRenderer", severity: 3, data: {gpu: "SwiftShader", long: "x".repeat(200)}},
    {id: "framesGood", severity: 0, data: {}}];
  const r = buildReport(snap, findings);
  assert.equal(r.fps, 4.3);
  assert.equal(r.rating, "poor");
  assert.equal(r.speed, 1234568);
  assert.equal(r.memory, 50);
  assert.deepEqual(r.issues, [{id: "softwareRenderer", severity: 3, data: {gpu: "SwiftShader"}}]);
  assert.ok(JSON.stringify(r).length < 1000);
});

test("findings for the whole table", () => {
  const rows = [
    {name: "GM", self: true, report: {speed: 9e6, latency: 20, issues: []}},
    {name: "Mia", report: {speed: 0.8e6, latency: 400, issues: [{id: "softwareRenderer", severity: 3}]}},
    {name: "Tom", report: {speed: 1.1e6, latency: 500, issues: []}}
  ];
  const ids = diagnoseTable(rows).map(f => `${f.id}:${f.data.name ?? f.data.count}`);
  assert.deepEqual(ids.sort(), ["allHighLatency:2", "allSlowDownloads:2", "playerProblem:Mia"]);
  assert.deepEqual(diagnoseTable([...rows, {name: "Ann", report: {speed: 5e6, latency: 30, issues: []}}])
    .map(f => f.id), ["playerProblem"]);
});

test("the parts of the join download", () => {
  const image = `data:image/png;base64,${"A".repeat(3 * MB)}`;
  const data = {
    actors: [{_id: "a1", name: "Small"}, {_id: "a2", name: "Portrait", img: image}],
    journal: [{_id: "j1", name: "Notes", pages: [{text: {content: `<img src="${image}"><img src="${image}">`}}]}],
    messages: Array.from({length: 3}, (_, i) => ({_id: `m${i}`, content: "x".repeat(1000)})),
    packs: [{id: "p", index: [{_id: "x"}]}],
    world: {id: "test"}
  };
  const a = analyzeData(data);
  assert.ok(a.total > 9 * MB);
  assert.equal(a.largest[0].name, "Notes");
  assert.equal(a.embedded[0].embedded, 2);
  assert.equal(a.collections.find(c => c.key === "messages").count, 3);
  assert.ok(a.collections.find(c => c.key === "other").bytes > 0);
  assert.equal(countDataUris({img: image}), 1);
  const findings = diagnoseWorld(a, {messages: 6000, disk: {fog: 80 * MB}, activeModules: 120});
  const ids = findings.map(f => `${f.severity}:${f.id}`);
  assert.ok(ids.includes("3:chatLarge"));
  assert.ok(ids.includes("2:documentLarge"));
  assert.ok(ids.includes("2:documentImages"));
  assert.ok(ids.includes("1:fogLarge"));
  assert.ok(ids.includes("1:manyModules"));
  assert.deepEqual(diagnoseWorld(analyzeData({actors: [{_id: "a", name: "x"}]})), []);
});
