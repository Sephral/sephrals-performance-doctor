/**
 * Self-test: the socket, the attribution of hooks to packages, the meter on the canvas, the browser's performance
 * reports, the texts of every finding and the upload right for smaller copies.
 */

import {MODULE_ID, TESTED_VERSIONS, esc, t} from "./config.mjs";
import {readGpu} from "./environment.mjs";
import {isAttached} from "./meter.mjs";
import {hookEntries, ownerOf} from "./owners.mjs";

/** Every finding the module can show, for the text check. */
export const FINDING_IDS = ["softwareRenderer", "noWebGL2", "oldBrowser", "noCanvas", "hiddenTab", "framesGood", "fpsCapped",
  "slowCpu", "slowGpu", "hidpi", "modeHigh", "modeMedium", "lightAnimation", "visionAnimation", "integratedGpu", "battery",
  "fps30", "largeCanvas", "tryChromium", "blocked", "memoryFull", "textureMemory", "latencyHigh", "connectionDrops",
  "slowLine", "saveData", "sceneHeavy", "sceneTooLargeForGpu", "sceneDownload", "sceneDownloadPlayer",
  "imageTooLargeForPlayers", "imageHeavy",
  "videoHeavy", "imageLarge", "imagePng", "sceneGpuMemory", "sceneEmbedded", "crowd.walls", "crowd.lights",
  "crowd.animatedLights", "crowd.tokens", "crowd.visionTokens", "crowd.tiles", "crowd.videos", "crowd.drawings",
  "crowd.sounds", "moduleHeavy", "moduleSpike", "worldLarge", "chatLarge", "documentLarge", "documentImages",
  "packIndexes", "scenesLarge", "fogLarge", "manyModules", "allSlowDownloads", "allHighLatency", "playerProblem"];

/**
 * Run all checks.
 * @returns {{problems: string[], notes: string[], checks: number}}
 */
function checkAll() {
  const problems = [];
  const notes = [];
  let checks = 0;
  const check = (ok, key, data) => {
    checks++;
    if ( !ok ) problems.push(game.i18n.has(key) ? t(key, data) : key);
  };
  check(typeof game.socket?.emit === "function", "SPD.SELFTEST.Socket");
  const entries = hookEntries();
  const known = entries.filter(e => ownerOf(e.fn) !== "unknown").length;
  const share = entries.length ? known / entries.length : 0;
  check(share >= 0.8, "SPD.SELFTEST.Attribution", {share: Math.round(share * 100)});
  const systemHooks = entries.filter(e => ownerOf(e.fn) === `system:${game.system.id}`).length;
  if ( !systemHooks ) notes.push(t("SPD.SELFTEST.NoSystemHooks", {system: game.system.title}));
  check(!globalThis.canvas?.ready || isAttached(), "SPD.SELFTEST.Meter");
  check(!!globalThis.PerformanceObserver?.supportedEntryTypes?.includes("resource"), "SPD.SELFTEST.Resources");
  if ( !PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame") ) notes.push(t("SPD.SELFTEST.NoLongFrames"));
  check(!!readGpu().renderer, "SPD.SELFTEST.Gpu");
  const keys = FINDING_IDS.map(id => `SPD.Finding.${id}.title`);
  const missing = keys.filter(key => !game.i18n.has(key));
  check(!missing.length, "SPD.SELFTEST.Texts", {keys: missing.slice(0, 5).join(", ")});
  check(game.user.hasPermission("FILES_UPLOAD"), "SPD.SELFTEST.Upload");
  return {problems, notes, checks};
}

/**
 * Run the self-test and report the result.
 * @param {object} [options]
 * @param {boolean} [options.report=true]
 * @returns {Promise<{problems: string[], notes: string[], checks: number}>}
 */
export async function runSelfTest({report=true}={}) {
  const result = checkAll();
  const {problems, notes, checks} = result;
  const summary = problems.length ? t("SPD.SELFTEST.Problems", {problems: problems.length, checks})
    : t("SPD.SELFTEST.Passed", {checks});
  if ( problems.length ) ui.notifications.warn(summary, {permanent: true});
  else ui.notifications.info(summary);
  if ( report ) {
    let content = `<h3>${esc(t("SPD.SELFTEST.Title"))}</h3><p>${esc(summary)}</p>`;
    if ( problems.length ) content += `<ul>${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`;
    if ( notes.length ) content += `<p>${notes.map(n => esc(n)).join("<br>")}</p>`;
    await ChatMessage.implementation.create({content, whisper: [game.user.id], speaker: {alias: game.modules.get(MODULE_ID).title}});
  }
  return result;
}

/**
 * Tell the GM once when Foundry is newer than the version the module was verified against.
 */
export function noticeNewVersions() {
  if ( !game.user.isGM ) return;
  if ( !foundry.utils.isNewerVersion(game.version, TESTED_VERSIONS.core) ) return;
  const signature = `core ${game.version}`;
  if ( game.settings.get(MODULE_ID, "acknowledgedVersions") === signature ) return;
  game.settings.set(MODULE_ID, "acknowledgedVersions", signature);
  ui.notifications.info(t("SPD.SELFTEST.NewVersions", {versions: signature}), {permanent: true});
}
