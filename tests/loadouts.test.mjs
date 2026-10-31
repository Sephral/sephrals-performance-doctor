import assert from "node:assert/strict";
import test from "node:test";
import {MODULE_ID} from "../scripts/config.mjs";
import {
  LOADOUTS_ID, LOADOUTS_PAGE, TEST_SETTING, findRunningTest, loadoutsHint, loadoutsState, runningTest, switchBack,
  testChoices, testWithout
} from "../scripts/loadouts.mjs";

/** Just enough of Foundry: modules, settings, texts. */
const settings = new Map();
globalThis.game = {
  modules: new Map(),
  user: {isGM: true},
  i18n: {lang: "en", localize: key => key, format: (key, data) => `${key} ${Object.values(data ?? {}).join(" ")}`},
  settings: {
    get: (scope, key) => settings.get(`${scope}.${key}`),
    set: async (scope, key, value) => {
      settings.set(`${scope}.${key}`, value);
      return value;
    }
  }
};

/** A module of the fake installation. */
function addModule(id, {active=true, title=id, api}={}) {
  game.modules.set(id, {id, title, active, api});
}

const isActive = id => !!game.modules.get(id)?.active;

test.beforeEach(() => {
  game.modules.clear();
  settings.clear();
  game.user.isGM = true;
});

test("Module Loadouts is ready, too old or missing", () => {
  assert.equal(loadoutsState(), "missing");
  addModule(LOADOUTS_ID, {active: false, api: {applyWithout() {}}});
  assert.equal(loadoutsState(), "missing");
  addModule(LOADOUTS_ID, {api: {apply() {}}});
  assert.equal(loadoutsState(), "outdated");
  addModule(LOADOUTS_ID, {api: {applyWithout() {}}});
  assert.equal(loadoutsState(), "ready");
});

test("the hint links to the package page", () => {
  const hint = loadoutsHint("missing");
  assert.match(hint, /^SPD\.Loadouts\.hint /);
  assert.ok(hint.includes(`<a href="${LOADOUTS_PAGE}" target="_blank" rel="noopener">Sephral’s Module Loadouts</a>`));
  assert.equal(LOADOUTS_PAGE, "https://foundryvtt.com/packages/sephrals-module-loadouts");
  assert.match(loadoutsHint("outdated"), /^SPD\.Loadouts\.update /);
});

test("only active modules can be switched off, never the doctor or Module Loadouts", () => {
  for ( const id of ["heavy", "light", "gone"] ) addModule(id, {active: id !== "gone"});
  const rows = [
    {owner: "module:heavy", msPerSecond: 300},
    {owner: "core", msPerSecond: 200},
    {owner: `module:${MODULE_ID}`, msPerSecond: 20},
    {owner: `module:${LOADOUTS_ID}`, msPerSecond: 10},
    {owner: "system:dnd5e", msPerSecond: 8},
    {owner: "module:light", msPerSecond: 4},
    {owner: "module:gone", msPerSecond: 2},
    {owner: "unknown", msPerSecond: 1}
  ];
  addModule(MODULE_ID);
  addModule(LOADOUTS_ID);
  assert.deepEqual(testChoices(rows, ["module:heavy", "system:dnd5e"], isActive), [
    {id: "heavy", owner: "module:heavy", msPerSecond: 300, flagged: true},
    {id: "light", owner: "module:light", msPerSecond: 4, flagged: false}
  ]);
});

test("a test runs while its loadout exists and one of its modules is still off", () => {
  const marker = {loadoutId: "l1", name: "Before", without: ["heavy", "light"]};
  const loadouts = [{id: "l1", name: "Before", scope: "world"}];
  addModule("heavy", {active: false});
  addModule("light");
  assert.deepEqual(findRunningTest(marker, loadouts, isActive), {loadout: loadouts[0], off: ["heavy"]});
  // Found by name when the id is unknown, never an installation loadout
  assert.equal(findRunningTest({...marker, loadoutId: null}, loadouts, isActive).loadout.id, "l1");
  assert.equal(findRunningTest(marker, [{id: "l1", name: "Before", scope: "global"}], isActive), null);
  // Back on, deleted loadout or nothing remembered: no test
  addModule("heavy");
  assert.equal(findRunningTest(marker, loadouts, isActive), null);
  assert.equal(findRunningTest(marker, [], isActive), null);
  assert.equal(findRunningTest({}, loadouts, isActive), null);
});

test("switching off saves a loadout first, remembers the test and switches back", async () => {
  const calls = [];
  const profiles = [];
  // Like Module Loadouts: the module configuration changes at once, the modules themselves only after the reload
  const configure = on => settings.set("core.moduleConfiguration", {[LOADOUTS_ID]: true, heavy: on});
  addModule(LOADOUTS_ID, {api: {
    applyWithout: async (ids, options) => {
      calls.push(["applyWithout", ids, options]);
      profiles.push({id: "saved", name: options.saveAs, scope: "world"});
      configure(false);
      return true;
    },
    apply: async id => {
      calls.push(["apply", id]);
      configure(true);
      return true;
    },
    getProfiles: () => profiles
  }});
  addModule("heavy", {title: "Heavy"});
  configure(true);

  assert.equal(await testWithout([], {}), false);
  assert.equal(await testWithout(["heavy"], {before: 41.6}), true);
  const [, ids, options] = calls[0];
  assert.deepEqual(ids, ["heavy"]);
  assert.match(options.saveAs, /^SPD\.Loadouts\.saveName /);
  const marker = settings.get(`${MODULE_ID}.${TEST_SETTING}`);
  assert.equal(marker.loadoutId, "saved");
  assert.deepEqual(marker.without, ["heavy"]);
  assert.equal(marker.before, 42);

  // Before the reload the module still runs, the test counts anyway and stays remembered
  assert.equal(game.modules.get("heavy").active, true);
  const running = runningTest();
  assert.equal(running.loadoutId, "saved");
  assert.equal(running.text, "SPD.Loadouts.running Heavy");
  assert.equal(running.before, 42);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settings.get(`${MODULE_ID}.${TEST_SETTING}`).loadoutId, "saved");

  assert.equal(await switchBack("saved"), true);
  assert.deepEqual(calls.at(-1), ["apply", "saved"]);
  assert.deepEqual(settings.get(`${MODULE_ID}.${TEST_SETTING}`), {});
  assert.equal(runningTest(), null);
});

test("a cancelled switch remembers nothing and an ended test is forgotten", async () => {
  addModule(LOADOUTS_ID, {api: {applyWithout: async () => false, apply: async () => false, getProfiles: () => []}});
  addModule("heavy");
  assert.equal(await testWithout(["heavy"]), false);
  assert.equal(settings.has(`${MODULE_ID}.${TEST_SETTING}`), false);
  assert.equal(await switchBack("saved"), false);

  // The loadout is gone: the GM's doctor forgets the test
  settings.set("core.moduleConfiguration", {[LOADOUTS_ID]: true});
  settings.set(`${MODULE_ID}.${TEST_SETTING}`, {loadoutId: "x", name: "Before", without: ["heavy"]});
  assert.equal(runningTest(), null);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(settings.get(`${MODULE_ID}.${TEST_SETTING}`), {});

  // A player's doctor never writes the world setting
  game.user.isGM = false;
  settings.set(`${MODULE_ID}.${TEST_SETTING}`, {loadoutId: "x", name: "Before", without: ["heavy"]});
  assert.equal(runningTest(), null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settings.get(`${MODULE_ID}.${TEST_SETTING}`).loadoutId, "x");
});
