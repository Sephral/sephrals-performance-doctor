import assert from "node:assert/strict";
import test from "node:test";

// The parts of Foundry the registration touches
const menus = new Map();
const hooks = [];
globalThis.Hooks = {on: name => hooks.push(name)};
globalThis.foundry = {applications: {api: {ApplicationV2: class {}}}};
globalThis.game = {
  user: {id: "gm", isGM: true},
  users: [],
  modules: new Map(),
  i18n: {localize: key => key, format: (key, data) => `${key} ${JSON.stringify(data)}`},
  settings: {registerMenu: (module, key, data) => menus.set(`${module}.${key}`, data), get: () => []}
};

const {MODULE_ID} = await import("../scripts/config.mjs");
const {describeState, registerDebug} = await import("../scripts/debug.mjs");

test("the debug file button and the doctor's part are registered", () => {
  registerDebug();
  const menu = menus.get(`${MODULE_ID}.debugFile`);
  assert.equal(menu.label, "SPD.DEBUG.Save");
  assert.equal(menu.restricted, true);
  const provider = globalThis.sephralsDebugFiles.providers.get(MODULE_ID);
  assert.equal(provider.label(), "SPD.DEBUG.Entry");
  assert.match(provider.notice("x.json"), /x\.json/);
  // The doctor reads no chat messages, it takes part in the file of the settings button only
  assert.equal(provider.message, undefined);
  assert.deepEqual(hooks, ["getChatMessageContextOptions"]);
});

test("the doctor's part keeps going when a reading fails", () => {
  const state = describeState();
  assert.deepEqual(Object.keys(state), ["snapshot", "findings", "tests", "changes", "phases", "players"]);
  assert.deepEqual(state.tests, {experiments: null, profile: null});
  assert.deepEqual(state.players, []);
});
