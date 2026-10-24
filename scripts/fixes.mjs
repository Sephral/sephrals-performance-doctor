/**
 * Changing Foundry's graphics settings of this user, with a way back. Before the module changes a setting for the
 * first time it notes the old value, so "Undo my changes" restores exactly what the user had.
 */

import {MODULE_ID} from "./config.mjs";

/** The core settings the module may change, with their kind. */
export const SETTING_KEYS = {
  performanceMode: "mode",
  maxFPS: "fps",
  pixelRatioResolutionScaling: "bool",
  lightAnimation: "bool",
  visionAnimation: "bool",
  mipmap: "bool"
};

/** Settings that only take effect after a reload. */
export const RELOAD_KEYS = new Set(["pixelRatioResolutionScaling"]);

/** Ready-made sets of settings, from pretty to light. */
export const PRESETS = {
  balanced: {performanceMode: 1, maxFPS: 60, lightAnimation: true, visionAnimation: true},
  light: {performanceMode: 0, maxFPS: 30, lightAnimation: false, visionAnimation: false, pixelRatioResolutionScaling: false},
  minimal: {performanceMode: 0, maxFPS: 30, lightAnimation: false, visionAnimation: false, pixelRatioResolutionScaling: false,
    mipmap: false}
};

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * The changes a set of wished values means against the current ones.
 * @param {Record<string, *>} wished
 * @param {Record<string, *>} current
 * @returns {{key: string, value: *, previous: *, reload: boolean}[]}
 */
export function planChanges(wished, current) {
  return Object.entries(wished)
    .filter(([key, value]) => (key in SETTING_KEYS) && (current[key] !== value))
    .map(([key, value]) => ({key, value, previous: current[key], reload: RELOAD_KEYS.has(key)}));
}

/**
 * Add applied changes to the undo list. A key already in the list keeps its first old value.
 * @param {object[]} list
 * @param {object[]} changes
 * @returns {object[]}
 */
export function mergeUndo(list, changes) {
  const result = [...list];
  for ( const change of changes ) {
    const known = result.find(e => e.key === change.key);
    if ( known ) known.value = change.value;
    else result.push({key: change.key, previous: change.previous, value: change.value, at: Date.now()});
  }
  return result.filter(e => e.previous !== e.value);
}

/* -------------------------------------------- */
/*  Runtime                                     */
/* -------------------------------------------- */

/**
 * The current values of the settings the module may change.
 * @returns {Record<string, *>}
 */
export function currentValues() {
  const values = {};
  for ( const key of Object.keys(SETTING_KEYS) ) {
    try {
      values[key] = game.settings.get("core", key);
    } catch {
      values[key] = undefined;
    }
  }
  // An unset performance mode means "chosen by Foundry": compare with what the canvas uses
  if ( (values.performanceMode === null) && Number.isInteger(globalThis.canvas?.performance?.mode) ) {
    values.performanceMode = canvas.performance.mode;
  }
  return values;
}

/**
 * Apply settings.
 * @param {Record<string, *>} wished   Keys of SETTING_KEYS with their new value
 * @returns {Promise<{changed: object[], reload: boolean}>}
 */
export async function applySettings(wished) {
  const changes = planChanges(wished, currentValues());
  for ( const change of changes ) {
    await game.settings.set("core", change.key, change.value);
  }
  if ( changes.length ) {
    await game.settings.set(MODULE_ID, "changes", mergeUndo(game.settings.get(MODULE_ID, "changes") ?? [], changes));
  }
  return {changed: changes, reload: changes.some(c => c.reload)};
}

/**
 * Apply a preset.
 * @param {string} id
 * @returns {Promise<{changed: object[], reload: boolean}>}
 */
export function applyPreset(id) {
  return applySettings(PRESETS[id] ?? {});
}

/**
 * The changes the module made and that are still in place.
 * @returns {object[]}
 */
export function madeChanges() {
  const list = game.settings.get(MODULE_ID, "changes") ?? [];
  const now = currentValues();
  return list.filter(e => now[e.key] === e.value);
}

/**
 * Put every setting the module changed back to the value from before.
 * @returns {Promise<{reload: boolean}>}
 */
export async function undoChanges() {
  const list = game.settings.get(MODULE_ID, "changes") ?? [];
  let reload = false;
  for ( const entry of [...list].reverse() ) {
    try {
      await game.settings.set("core", entry.key, entry.previous);
      reload ||= RELOAD_KEYS.has(entry.key);
    } catch(err) {
      console.warn(`${MODULE_ID} | Could not restore ${entry.key}`, err);
    }
  }
  await game.settings.set(MODULE_ID, "changes", []);
  return {reload};
}
