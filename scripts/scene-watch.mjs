/**
 * Warnings for the GM: when the GM activates a heavy scene, or puts a very large image into a scene as background,
 * foreground or tile, a notification says how large it is and how long players will wait.
 */

import {formatBytes, formatDuration, setting, t} from "./config.mjs";
import {forgetSceneResult, rememberSceneResult} from "./doctor-app.mjs";
import {worst} from "./rules.mjs";
import {IMAGE_LIMITS, checkScene, diagnoseScene, fileName, forgetProbes, probeAsset} from "./scene-check.mjs";
import {playerCapabilities} from "./table.mjs";

/** Scenes warned about in this session. */
const warned = new Set();

/**
 * Install the hooks. Call once in "ready" on GM clients.
 */
export function registerSceneWatch() {
  if ( !game.user.isGM ) return;
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("createScene", (scene, options, userId) => {
    if ( isMine(userId) ) checkImages(scene, [scene.background?.src, scene.foreground]);
  });
  Hooks.on("updateLevel", (level, changes, options, userId) => {
    if ( !isMine(userId) || !level.parent ) return;
    forgetSceneResult(level.parent.id);
    checkImages(level.parent, [changes.background?.src, changes.foreground?.src, changes.fog?.src]);
  });
  Hooks.on("createTile", (tile, options, userId) => {
    if ( isMine(userId) && tile.parent ) checkImages(tile.parent, [tile.texture?.src]);
  });
  Hooks.on("updateTile", (tile, changes, options, userId) => {
    if ( isMine(userId) && tile.parent && changes.texture?.src ) checkImages(tile.parent, [changes.texture.src]);
  });
}

function isMine(userId) {
  return (userId === game.user.id) && setting("sceneWarnings");
}

/**
 * Hook "updateScene".
 * @param {Scene} scene
 * @param {object} changes
 * @param {object} options
 * @param {string} userId
 */
function onUpdateScene(scene, changes, options, userId) {
  if ( !isMine(userId) ) return;
  const images = [changes.background?.src, changes.foreground, changes.fog?.overlay];
  if ( images.some(Boolean) || ("levels" in changes) ) forgetSceneResult(scene.id);
  if ( changes.active === true ) warnHeavyScene(scene);
  else checkImages(scene, images);
}

/**
 * Check a scene the GM just activated.
 * @param {Scene} scene
 */
async function warnHeavyScene(scene) {
  if ( warned.has(scene.id) ) return;
  try {
    const summary = await checkScene(scene);
    rememberSceneResult(summary);
    const players = playerCapabilities();
    const findings = diagnoseScene(summary, {players});
    if ( worst(findings) < 2 ) return;
    warned.add(scene.id);
    const slow = players.filter(p => p.bytesPerSecond > 0).sort((a, b) => a.bytesPerSecond - b.bytesPerSecond)[0];
    const key = slow ? "SPD.Warn.sceneSlowest" : "SPD.Warn.scene";
    ui.notifications.warn(t(key, {scene: scene.navName || scene.name, bytes: formatBytes(summary.totalBytes),
      name: slow?.name ?? "", time: slow ? formatDuration((summary.totalBytes / slow.bytesPerSecond) * 1000) : "",
      typical: formatDuration((summary.totalBytes / 2e6) * 1000)}), {permanent: worst(findings) >= 3});
  } catch(err) {
    console.warn("sephrals-performance-doctor | Scene check failed", err);
  }
}

/**
 * Warn about very large new images.
 * @param {Scene} scene
 * @param {(string|undefined)[]} sources
 */
async function checkImages(scene, sources) {
  const list = [...new Set(sources.filter(s => s && (typeof s === "string") && !s.startsWith("#")))];
  if ( !list.length ) return;
  forgetProbes(list);
  const maxTextures = playerCapabilities().map(p => p.maxTexture).filter(Boolean);
  const smallest = maxTextures.length ? Math.min(...maxTextures) : null;
  for ( const src of list ) {
    try {
      const a = await probeAsset(src, {fresh: true});
      const side = Math.max(a.width ?? 0, a.height ?? 0);
      const heavy = (a.bytes ?? 0) >= IMAGE_LIMITS.bytesWarn;
      const large = side > IMAGE_LIMITS.sideWarn;
      const tooLarge = smallest && (side > smallest);
      if ( !heavy && !large && !tooLarge ) continue;
      const key = tooLarge ? "SPD.Warn.imageGpu" : "SPD.Warn.image";
      ui.notifications.warn(t(key, {file: fileName(src), bytes: a.bytes ? formatBytes(a.bytes) : "?",
        px: side ? `${a.width} × ${a.height}` : "?", max: smallest ?? "", scene: scene.navName || scene.name}));
    } catch(err) {
      console.warn("sephrals-performance-doctor | Image check failed", err);
    }
  }
}
