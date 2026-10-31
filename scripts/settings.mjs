/**
 * Settings of the module. Like in every Sephral module, all options appear in Foundry's settings dialog under this
 * module, starting with the module language.
 */

import {MODULE_ID, isShown} from "./config.mjs";
import {FOLLOW_FOUNDRY, applyModuleLanguage} from "./language.mjs";
import {TEST_SETTING} from "./loadouts.mjs";

/**
 * The settings of the module, in the order they appear in the settings dialog.
 * @type {Record<string, object>}
 */
export const SETTINGS = {
  uiLanguage: {type: String, default: FOLLOW_FOUNDRY, scope: "client", onChange: "language", choices: {
    [FOLLOW_FOUNDRY]: "SPD.LANGUAGE.default", de: "SPD.LANGUAGE.de", en: "SPD.LANGUAGE.en"}},
  theme: {type: String, default: "signature", scope: "client", onChange: "redraw", choices: {
    signature: "SPD.SETTINGS.theme.signature", foundry: "SPD.SETTINGS.theme.foundry"}},
  autoPrompt: {type: Boolean, default: true, scope: "client"},
  shareWithGM: {type: Boolean, default: true, scope: "client"},
  attribution: {type: Boolean, default: true, scope: "client", requiresReload: true},
  gmAlerts: {type: Boolean, default: true},
  slowLoadSeconds: {type: Number, default: 20, range: {min: 10, max: 120, step: 5}},
  sceneWarnings: {type: Boolean, default: true}
};

/**
 * Register all settings of the module and its menus.
 * @param {{language: Function, redraw: Function}} handlers
 * @param {{open: typeof ApplicationV2, selfTest: typeof ApplicationV2}} menus
 */
export function registerSettings(handlers, menus) {
  for ( const [key, def] of Object.entries(SETTINGS) ) {
    const handler = def.onChange ? handlers[def.onChange] : null;
    game.settings.register(MODULE_ID, key, {
      name: `SPD.SETTINGS.${key}.name`,
      hint: `SPD.SETTINGS.${key}.hint`,
      scope: def.scope ?? "world",
      config: true,
      type: def.range ? new foundry.data.fields.NumberField({...def.range, initial: def.default}) : def.type,
      choices: def.choices,
      default: def.default,
      requiresReload: def.requiresReload ?? false,
      onChange: handler ? value => handler(value) : undefined
    });
  }

  // Kept in this browser: the settings the module changed (for undo), the assistant across a reload, the hint's
  // snooze and the last startup measurement
  game.settings.register(MODULE_ID, "changes", {scope: "client", config: false, type: Array, default: []});
  game.settings.register(MODULE_ID, "wizard", {scope: "client", config: false, type: Object, default: {}});
  game.settings.register(MODULE_ID, "promptSnooze", {scope: "client", config: false, type: Number, default: 0});
  game.settings.register(MODULE_ID, "startupReport", {scope: "client", config: false, type: Object, default: {}});
  game.settings.register(MODULE_ID, "acknowledgedVersions", {scope: "client", config: false, type: String, default: ""});
  // Kept in the world: a running test without modules and the loadout of Module Loadouts that switches back
  game.settings.register(MODULE_ID, TEST_SETTING, {scope: "world", config: false, type: Object, default: {}});

  game.settings.registerMenu(MODULE_ID, "open", {
    name: "SPD.Menu.open.name",
    label: "SPD.Menu.open.label",
    hint: "SPD.Menu.open.hint",
    icon: "fa-solid fa-stethoscope",
    type: menus.open,
    restricted: false
  });
  game.settings.registerMenu(MODULE_ID, "selfTest", {
    name: "SPD.SELFTEST.Title",
    label: "SPD.SELFTEST.Run",
    hint: "SPD.SELFTEST.Hint",
    icon: "fa-solid fa-vial-circle-check",
    type: menus.selfTest,
    restricted: true
  });
}

/**
 * Switch the module strings when the user picks another module language, then redraw.
 * @param {string} value
 * @param {Function} redraw
 */
export function changeLanguage(value, redraw) {
  applyModuleLanguage(value).then(() => {
    for ( const id of ["spd-doctor", "spd-prompt"] ) {
      const app = foundry.applications.instances.get(id);
      if ( isShown(app) ) app.render({window: {title: app.title}});
    }
    redraw();
    ui.controls?.render({reset: true});
    if ( game.settings.sheet?.rendered ) game.settings.sheet.render();
  });
}
