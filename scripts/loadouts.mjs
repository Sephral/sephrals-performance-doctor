/**
 * Sephral's Module Loadouts and the module measurement. When it runs, the GM switches the modules that cost time off
 * for a test: Module Loadouts saves the current modules as a loadout first, and the Modules tab offers to switch back
 * to it while the test runs. Without it the GM gets a quiet hint with a link to its page.
 */

import {MODULE_ID, esc, locale, t} from "./config.mjs";

/** The id of Module Loadouts. */
export const LOADOUTS_ID = "sephrals-module-loadouts";

/** Its page on foundryvtt.com. */
export const LOADOUTS_PAGE = `https://foundryvtt.com/packages/${LOADOUTS_ID}`;

/** Its name, the same in every language. */
const LOADOUTS_TITLE = "Sephral’s Module Loadouts";

/** The world setting that remembers a running test. */
export const TEST_SETTING = "moduleTest";

/** A test that ended is being forgotten right now. */
let forgetting = false;

/**
 * The API of Module Loadouts, when it runs.
 * @returns {object|null}
 */
function loadoutsApi() {
  const module = game.modules.get(LOADOUTS_ID);
  return module?.active ? (module.api ?? null) : null;
}

/**
 * Can the modules be switched with Module Loadouts? "ready" when it runs with the needed functions, "outdated" when it
 * runs without them (a version before applyWithout), "missing" when it is not active or not installed.
 * @returns {"ready"|"outdated"|"missing"}
 */
export function loadoutsState() {
  if ( !game.modules.get(LOADOUTS_ID)?.active ) return "missing";
  return (typeof loadoutsApi()?.applyWithout === "function") ? "ready" : "outdated";
}

/**
 * The modules of a measurement that can be switched off for a test, in the order of the measurement. The doctor itself
 * and Module Loadouts never are.
 * @param {object[]} rows                       Rows of the measurement by owner
 * @param {Iterable<string>} flagged            Owners with a finding, ticked at first
 * @param {(id: string) => boolean} isActive
 * @returns {{id: string, owner: string, msPerSecond: number, flagged: boolean}[]}
 */
export function testChoices(rows, flagged, isActive) {
  const marked = new Set(flagged);
  return rows.filter(r => String(r.owner ?? "").startsWith("module:"))
    .map(r => ({id: r.owner.slice("module:".length), owner: r.owner, msPerSecond: r.msPerSecond, flagged: marked.has(r.owner)}))
    .filter(c => c.id && (c.id !== MODULE_ID) && (c.id !== LOADOUTS_ID) && isActive(c.id));
}

/**
 * The running test: its saved loadout still exists and at least one module of the test is still off. Null otherwise.
 * @param {object} marker                       What the setting remembers
 * @param {object[]} loadouts                   The loadouts of Module Loadouts
 * @param {(id: string) => boolean} isOn        Is a module switched on?
 * @returns {{loadout: object, off: string[]}|null}
 */
export function findRunningTest(marker, loadouts, isOn) {
  if ( !marker?.name || !Array.isArray(marker.without) ) return null;
  const world = loadouts.filter(l => l.scope !== "global");
  const loadout = world.find(l => l.id === marker.loadoutId) ?? world.find(l => l.name === marker.name);
  const off = marker.without.filter(id => !isOn(id));
  return (loadout && off.length) ? {loadout, off} : null;
}

/**
 * Which modules are switched on in the world's module configuration. Right after a switch it holds the new state
 * already, while the modules themselves only change with the reload.
 * @returns {(id: string) => boolean}
 */
function configuredOn() {
  const key = globalThis.foundry?.applications?.sidebar?.apps?.ModuleManagement?.SETTING ?? "moduleConfiguration";
  let configuration = {};
  try {
    configuration = game.settings.get("core", key) ?? {};
  } catch {
    // Not readable: every module counts as off, so a remembered test is kept
  }
  return id => configuration[id] === true;
}

/**
 * Module titles as a list for a sentence: "A, B and C".
 * @param {string[]} ids
 * @returns {string}
 */
function titleList(ids) {
  const titles = ids.map(id => game.modules.get(id)?.title ?? id);
  try {
    return new Intl.ListFormat(locale(), {style: "long", type: "conjunction"}).format(titles);
  } catch {
    return titles.join(", ");
  }
}

/**
 * The quiet line below the measurement when Module Loadouts is missing or too old, with the link to its page.
 * @param {"outdated"|"missing"} state
 * @returns {string}   HTML
 */
export function loadoutsHint(state) {
  const link = `<a href="${LOADOUTS_PAGE}" target="_blank" rel="noopener">${esc(LOADOUTS_TITLE)}</a>`;
  return t(state === "outdated" ? "SPD.Loadouts.update" : "SPD.Loadouts.hint", {link});
}

/**
 * The test that runs now, ready for the Modules tab. Forgets a test that ended, for example when the GM switched back
 * in Module Loadouts.
 * @returns {{loadoutId: string, text: string, before: number|null}|null}
 */
export function runningTest() {
  const marker = game.settings.get(MODULE_ID, TEST_SETTING);
  if ( !marker?.name ) return null;
  const api = loadoutsApi();
  if ( typeof api?.getProfiles !== "function" ) return null;
  const running = findRunningTest(marker, api.getProfiles(), configuredOn());
  if ( !running ) {
    if ( game.user.isGM && !forgetting ) {
      forgetting = true;
      game.settings.set(MODULE_ID, TEST_SETTING, {}).catch(err => console.warn(err)).finally(() => {
        forgetting = false;
      });
    }
    return null;
  }
  return {loadoutId: running.loadout.id, text: t("SPD.Loadouts.running", {modules: titleList(running.off)}),
    before: Number.isFinite(marker.before) ? marker.before : null};
}

/**
 * Switch modules off for a test with Module Loadouts. It asks first, saves the current modules as a loadout and lets
 * Foundry reload. The doctor remembers the loadout to offer the way back.
 * @param {string[]} ids
 * @param {{before?: number}} [options]   Share of the time the scripts used before, in percent
 * @returns {Promise<boolean>}   Whether modules were switched off
 */
export async function testWithout(ids, {before=null}={}) {
  const api = loadoutsApi();
  if ( !ids.length || (typeof api?.applyWithout !== "function") ) return false;
  const name = t("SPD.Loadouts.saveName", {date: new Date().toLocaleString(locale(), {dateStyle: "short", timeStyle: "short"})});
  const switched = await api.applyWithout(ids, {saveAs: name});
  if ( !switched ) return false;
  const saved = api.getProfiles?.().find(l => (l.name === name) && (l.scope !== "global"));
  await game.settings.set(MODULE_ID, TEST_SETTING, {loadoutId: saved?.id ?? null, name, without: ids,
    before: Number.isFinite(before) ? Math.round(before) : null, at: Date.now()});
  return true;
}

/**
 * End the test: apply the saved loadout again (Module Loadouts asks first) and forget the test.
 * @param {string} loadoutId
 * @returns {Promise<boolean>}
 */
export async function switchBack(loadoutId) {
  const api = loadoutsApi();
  if ( !loadoutId || (typeof api?.apply !== "function") ) return false;
  if ( !await api.apply(loadoutId) ) return false;
  await game.settings.set(MODULE_ID, TEST_SETTING, {});
  return true;
}
