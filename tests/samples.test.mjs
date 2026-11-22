import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {KINDS, SAMPLE_OWNERS, buildSample} from "../scripts/sample-data.mjs";
import {diagnoseClient, diagnoseProfile} from "../scripts/rules.mjs";
import {diagnoseScene} from "../scripts/scene-check.mjs";
import {diagnoseTable} from "../scripts/table.mjs";

const text = key => key;
const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).SPD.Sample;
const de = JSON.parse(readFileSync(new URL("../lang/de.json", import.meta.url), "utf8")).SPD.Sample;

test("every entry builds and has a label in both languages", () => {
  for ( const kind of KINDS ) {
    const data = buildSample(kind, {text});
    assert.ok(data.sample.snap, kind);
    assert.ok(en.entry[kind], `en ${kind}`);
    assert.ok(de.entry[kind], `de ${kind}`);
  }
  for ( const key of ["reload", "optimize", "optimize-result", "optimize-worse", "prompt"] ) {
    assert.ok(en.entry[key] && de.entry[key], key);
  }
  assert.deepEqual(Object.keys(en.entry).sort(), Object.keys(de.entry).sort());
});

test("the processor sample is slow because of the processor", () => {
  const {sample} = buildSample("overview-cpu", {text});
  const ids = diagnoseClient(sample.snap).map(f => f.id);
  assert.ok(ids.includes("slowCpu"));
  assert.ok(ids.includes("blocked"));
});

test("the software sample finds software rendering", () => {
  const {sample} = buildSample("overview-software", {text});
  assert.ok(diagnoseClient(sample.snap).some(f => f.id === "softwareRenderer"));
});

test("the fine sample has no hint", () => {
  const {sample} = buildSample("overview-fine", {text});
  assert.equal(diagnoseClient(sample.snap).filter(f => f.severity > 0).length, 0);
});

test("the heavy scene brings heavy file hints for the GM", () => {
  const {sample} = buildSample("scene", {text});
  const ids = diagnoseScene(sample.summaries.mill, {players: sample.players}).map(f => f.id);
  for ( const id of ["sceneDownloadPlayer", "imageHeavy", "imageTooLargeForPlayers", "videoHeavy", "imagePng"] ) assert.ok(ids.includes(id), id);
});

test("the crowded scene brings every crowd hint and a large image", () => {
  const {sample} = buildSample("scene-alone", {text});
  const ids = diagnoseScene(sample.summaries.caves, {players: sample.players}).map(f => f.id);
  assert.equal(ids.filter(id => id.startsWith("crowd.")).length, 9);
  for ( const id of ["imageLarge", "sceneGpuMemory", "sceneEmbedded"] ) assert.ok(ids.includes(id), id);
});

test("the table samples bring the table hints", () => {
  const rows = buildSample("players", {text}).sample.rows;
  assert.ok(diagnoseTable(rows).some(f => f.id === "playerProblem"));
  const line = buildSample("players-line", {text}).sample.rows;
  assert.ok(diagnoseTable(line).some(f => f.id === "allHighLatency"));
});

test("the module measurement flags the made-up modules", () => {
  const {sample} = buildSample("modules", {text});
  const found = diagnoseProfile(sample.profile.rows, {self: "module:sephrals-performance-doctor"});
  assert.deepEqual(found.map(f => f.id).sort(), ["moduleHeavy", "moduleHeavy", "moduleSpike"]);
  for ( const f of found ) assert.ok(SAMPLE_OWNERS[f.data.owner]);
});

test("the world sample is large and has findings", () => {
  const {sample} = buildSample("world", {text});
  assert.ok(sample.world.findings.some(f => f.id === "worldLarge"));
  assert.ok(sample.world.findings.some(f => f.id === "chatLarge"));
});

test("player samples show the player view", () => {
  for ( const kind of ["player-overview", "player-scene", "player-modules"] ) assert.equal(buildSample(kind, {text}).sample.gm, false);
});

test("the assistant samples carry a stage", () => {
  const stages = ["measuring", "proposal", "reload", "verifying", "result"];
  for ( const kind of KINDS.filter(k => k.startsWith("assistant")) ) assert.ok(stages.includes(buildSample(kind, {text}).wizard.stage), kind);
  assert.ok(buildSample("assistant-proposal", {text}).wizard.proposal.length > 0);
  assert.equal(buildSample("assistant-nothing", {text}).wizard.proposal.length, 0);
});
