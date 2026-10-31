/**
 * Sephral's Performance Doctor. The module loads as a library, before the system and the other modules, so the
 * first lines below see every hook registration and every download from the start of the page.
 */

import {MODULE_ID, TESTED_VERSIONS, readStorage, setting, t} from "./config.mjs";
import {registerDebug} from "./debug.mjs";
import {saveDebugFile} from "./debug-file.mjs";
import {registerHubModule} from "./hub.mjs";
import {openDoctor, doctorApp, refreshDoctor, PerformanceDoctor} from "./doctor-app.mjs";
import {readEnvironment, watchBattery} from "./environment.mjs";
import {runExperiments} from "./experiments.mjs";
import {applyPreset, applySettings, undoChanges} from "./fixes.mjs";
import {applyModuleLanguage} from "./language.mjs";
import {attachTicker, frameStats, latency, startMeter, startPings} from "./meter.mjs";
import {registerSocket, onMessage} from "./net.mjs";
import {bandwidth, downloadsByOwner, runSpeedTest, startNetwork} from "./network.mjs";
import {installAttribution, ownerOf} from "./owners.mjs";
import {beginStartupIfArmed, endStartup, isStartupProfiling, markPhase, phases, profile, startupPhases} from "./profiler.mjs";
import {watchForSlowGame} from "./prompt.mjs";
import {checkScene, diagnoseScene} from "./scene-check.mjs";
import {registerSceneWatch} from "./scene-watch.mjs";
import {noticeNewVersions, runSelfTest} from "./selftest.mjs";
import {changeLanguage, registerSettings} from "./settings.mjs";
import {clientFindings, snapshot} from "./state.mjs";
import * as table from "./table.mjs";
import {registerUsage} from "./usage.mjs";
import {checkWorld} from "./world-check.mjs";

/* -------------------------------------------- */
/*  When the script loads                       */
/* -------------------------------------------- */

// The attribution can be switched off in the settings; the raw client setting is read before Foundry knows it
installAttribution({enabled: readStorage("attribution") !== "false"});
startNetwork();
startMeter();
beginStartupIfArmed();
document.addEventListener("DOMContentLoaded", () => markPhase("domReady"), {once: true});

/** The tool in the token controls. */
const TOOL = "spd-doctor";

/** The settings menu that opens the window. Foundry only accepts application classes as menus. */
class OpenDoctorMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    await openDoctor();
    return this;
  }
}

/** The settings menu that runs the self-test. */
class SelfTestMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    if ( game.user.isGM ) await runSelfTest();
    return this;
  }
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  markPhase("init");
  registerHubModule({moduleId: MODULE_ID, tested: TESTED_VERSIONS});
  registerSettings({
    language: value => changeLanguage(value, refreshDoctor),
    redraw: refreshDoctor
  }, {open: OpenDoctorMenu, selfTest: SelfTestMenu});
  registerDebug();
  registerUsage(MODULE_ID, {
    features: ["moduleProfile", "startupProfile", "graphicsTest", "wizardRun", "fixApply", "fixUndo", "webpCopy",
      "worldCheck", "loadoutTest"],
    settings: ["theme", "autoPrompt", "gmAlerts"]
  });
  game.keybindings.register(MODULE_ID, "open", {
    name: "SPD.Keybinding.open",
    hint: "SPD.Keybinding.openHint",
    editable: [],
    onDown: () => {
      openDoctor();
      return true;
    }
  });
  registerSocket();
  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
  Hooks.on("getSceneContextOptions", onSceneContext);
  Hooks.on("renderPlayers", onRenderPlayers);
  Hooks.on("canvasInit", c => {
    attachTicker();
    table.onCanvasInit(c);
  });
  Hooks.on("canvasReady", c => {
    markPhase("canvasReady");
    attachTicker();
    table.onCanvasReady(c);
  });
  Hooks.on("error", (location, error) => table.onError(location, error));
  game.modules.get(MODULE_ID).api = api();
});

/** Applying a fixed module language loads its file; the rest of "ready" waits for it. */
let languageReady = Promise.resolve();

Hooks.once("i18nInit", () => {
  languageReady = applyModuleLanguage(game.settings.get(MODULE_ID, "uiLanguage"));
});

Hooks.once("setup", () => markPhase("setup"));

Hooks.once("ready", async () => {
  markPhase("ready");
  setTimeout(() => markPhase("readyDone"), 0);
  await languageReady;
  attachTicker();
  startPings();
  watchBattery();
  table.startReporting();
  table.startCollecting();
  registerSceneWatch();
  watchForSlowGame();
  onMessage("open", (message, sender) => {
    if ( !sender.isGM ) return;
    openDoctor({tab: "overview", banner: t("SPD.Banner.gmAsked", {name: sender.name})});
  });
  if ( isStartupProfiling() ) finishStartupMeasurement();
  resumeWizard();
  noticeNewVersions();
});

/**
 * End the startup measurement a few seconds after the canvas is ready and show the result.
 */
async function finishStartupMeasurement() {
  for ( let i = 0; (i < 60) && globalThis.canvas?.loading; i++ ) await new Promise(r => setTimeout(r, 500));
  await new Promise(r => setTimeout(r, 2500));
  const report = endStartup();
  if ( !report ) return;
  const rows = report.rows.map(r => ({owner: r.owner, ms: r.ms, calls: r.calls, maxMs: r.maxMs}));
  await game.settings.set(MODULE_ID, "startupReport", {at: report.at, durationMs: report.durationMs, rows,
    phases: report.phases, downloads: report.downloads});
  ui.notifications.info(t("SPD.Startup.done"));
  openDoctor({tab: "modules"});
}

/**
 * The assistant changed a setting that needed a reload: measure again and show the result.
 */
async function resumeWizard() {
  const state = setting("wizard");
  if ( state?.stage !== "verify" ) return;
  await game.settings.set(MODULE_ID, "wizard", {});
  if ( (Date.now() - (state.at ?? 0)) > 10 * 60 * 1000 ) return;
  const app = await openDoctor({tab: "overview"});
  app.verifyWizard(state.baseline);
}

/**
 * Hook "getSceneControlButtons": the doctor in the token controls, for everyone.
 * @param {Record<string, object>|object[]} controls
 */
function onGetSceneControlButtons(controls) {
  const tokens = controls?.tokens ?? (Array.isArray(controls) ? controls.find(c => c.name === "token") : null);
  if ( !tokens ) return;
  const tool = {name: TOOL, title: "SPD.Title", icon: "fa-solid fa-stethoscope", button: true, visible: true,
    onChange: () => openDoctor()};
  if ( Array.isArray(tokens.tools) ) tokens.tools.push({...tool, onClick: tool.onChange});
  else {
    tool.order = Object.keys(tokens.tools ?? {}).length;
    tokens.tools[TOOL] = tool;
  }
}

/**
 * Hook "getSceneContextOptions": "Check performance" for GMs in the scene directory.
 * @param {Application} app
 * @param {object[]} entries
 */
function onSceneContext(app, entries) {
  entries.push({
    name: "SPD.Context.check",
    icon: '<i class="fa-solid fa-stethoscope"></i>',
    condition: () => game.user.isGM,
    callback: li => {
      const id = li?.dataset?.entryId ?? li?.dataset?.documentId ?? li?.[0]?.dataset?.entryId;
      openDoctor({tab: "scene", sceneId: id ?? null});
    }
  });
}

/**
 * Hook "renderPlayers": the frame rate and latency of the players list open the doctor, and a small button sits
 * next to them.
 * @param {Application} app
 * @param {HTMLElement} html
 */
function onRenderPlayers(app, html) {
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
  const stats = root?.querySelector?.("#performance-stats");
  if ( !stats || stats.querySelector(".spd-players-button") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "spd-players-button icon fa-solid fa-stethoscope";
  button.dataset.tooltip = t("SPD.Players.button");
  button.setAttribute("aria-label", t("SPD.Players.button"));
  button.addEventListener("click", event => {
    event.stopPropagation();
    openDoctor();
  });
  const expand = stats.querySelector("#players-expand");
  if ( expand ) stats.insertBefore(button, expand);
  else stats.append(button);
  for ( const id of ["#fps", "#latency"] ) {
    const el = stats.querySelector(id);
    if ( !el ) continue;
    el.classList.add("spd-clickable");
    el.dataset.tooltip = t("SPD.Players.button");
    el.addEventListener("click", () => openDoctor());
  }
}

/* -------------------------------------------- */
/*  API                                         */
/* -------------------------------------------- */

/**
 * The API of the module: game.modules.get("sephrals-performance-doctor").api
 * @returns {object}
 */
function api() {
  return {
    /** Open the window, optionally on a tab ("overview", "pc", "scene", "modules", "players", "world"). */
    open: openDoctor,
    /** The window, if open. */
    app: doctorApp,
    /** The numbers of this client and its findings. */
    snapshot,
    findings: () => clientFindings(),
    frames: frameStats,
    latency,
    bandwidth,
    environment: readEnvironment,
    downloads: downloadsByOwner,
    /** Measure modules for some seconds. */
    profile,
    /** The graphics test. */
    runExperiments,
    /** The download test. */
    runSpeedTest,
    /** Check a scene; its findings for the GM. */
    checkScene,
    diagnoseScene: summary => diagnoseScene(summary, {players: table.playerCapabilities()}),
    /** Check the world (GM). */
    checkWorld,
    /** Change Foundry's graphics settings of this user, with undo. */
    applySettings,
    applyPreset,
    undoChanges,
    /** The table as the GM sees it. */
    tableRows: table.tableRows,
    recentLoads: table.recentLoads,
    /** Who registered a hook callback or ticker listener. */
    ownerOf,
    /** Moments of the start of this page. */
    phases: () => ({...phases, ...startupPhases()}),
    /** Check the module (GM). */
    runSelfTest,
    /** Save the debug file of Sephral's modules (GM): about one chat message, or without an id the latest picture. */
    saveDebugFile: messageId => saveDebugFile(messageId ?? null, {moduleId: MODULE_ID}),
    /** The class of the window, for other modules. */
    PerformanceDoctor
  };
}
