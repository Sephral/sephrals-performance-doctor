/**
 * Smaller copies of heavy images. The browser decodes the original, scales it down if asked and saves it as WebP,
 * then the module uploads the copy into the world's folder and points the scene at it. The original file stays where
 * it is (Foundry cannot delete files from the browser), and the scene remembers it, so "Restore original" puts it
 * back.
 */

import {MODULE_ID} from "./config.mjs";
import {collectAssets, hasLevels, parseImageHeader} from "./scene-check.mjs";

/** WebP cannot be wider or taller than this. */
export const WEBP_MAX = 16383;

/** Images with more pixels than this are too large for most browsers to convert. */
export const MAX_PIXELS = 268e6;

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * The size of the copy: the longer side at most maxSide (0 keeps the size), never more than WebP allows.
 * @param {number} width
 * @param {number} height
 * @param {number} maxSide
 * @returns {{width: number, height: number, scaled: boolean}}
 */
export function targetSize(width, height, maxSide=0) {
  const limit = Math.min(maxSide > 0 ? maxSide : Infinity, WEBP_MAX);
  const scale = Math.min(1, limit / Math.max(width, height));
  if ( scale >= 1 ) return {width, height, scaled: false};
  return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: true};
}

/**
 * A short, stable hash of a text (FNV-1a), as hex.
 * @param {string} text
 * @returns {string}
 */
export function shortHash(text) {
  let h = 0x811c9dc5;
  for ( let i = 0; i < text.length; i++ ) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * The file name of the copy: the original name, a hash of where it came from and how it was made, and .webp.
 * @param {string} src
 * @param {number} maxSide
 * @param {number} quality
 * @returns {string}
 */
export function optimizedName(src, maxSide, quality) {
  let name = String(src).split(/[?#]/)[0].split("/").pop() || "image";
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the raw name
  }
  const base = name.replace(/\.[^.]+$/, "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w-]+/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 60) || "image";
  return `${base}-${shortHash(`${src}|${maxSide}|${quality}`)}.webp`;
}

/* -------------------------------------------- */
/*  Making the copy                             */
/* -------------------------------------------- */

/**
 * Make a smaller WebP copy of an image.
 * @param {string} src
 * @param {object} [options]
 * @param {number} [options.maxSide=0]      Longest side of the copy, 0 keeps the size
 * @param {number} [options.quality=0.85]   WebP quality, 0.5 to 1
 * @returns {Promise<{file: File, width: number, height: number, bytes: number, originalBytes: number,
 *   originalWidth: number, originalHeight: number}>}
 */
export async function makeOptimized(src, {maxSide=0, quality=0.85}={}) {
  const response = await fetch(src, {cache: "no-cache"});
  if ( !response.ok ) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const header = parseImageHeader(new Uint8Array(await blob.slice(0, 128 * 1024).arrayBuffer()));
  if ( header?.animated ) throw new Error("animated");
  const width = header?.width;
  const height = header?.height;
  if ( !width || !height ) throw new Error("unknown size");
  const size = targetSize(width, height, maxSide);
  if ( (width * height > MAX_PIXELS) && !size.scaled ) throw new Error("too large");
  let bitmap;
  try {
    bitmap = size.scaled
      ? await createImageBitmap(blob, {resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high"})
      : await createImageBitmap(blob);
  } catch(err) {
    throw new Error(`decode: ${err.message}`);
  }
  let out;
  try {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    out = await canvas.convertToBlob({type: "image/webp", quality: Math.min(1, Math.max(0.5, quality))});
  } finally {
    bitmap.close?.();
  }
  if ( out?.type !== "image/webp" ) throw new Error("no webp");
  const file = new File([out], optimizedName(src, maxSide, quality), {type: "image/webp", lastModified: Date.now()});
  return {file, width: size.width, height: size.height, bytes: out.size, originalBytes: blob.size,
    originalWidth: width, originalHeight: height};
}

/* -------------------------------------------- */
/*  Storing it                                  */
/* -------------------------------------------- */

function isForge() {
  // The Forge may declare ForgeVTT as a top-level class, which is global but not a globalThis property
  return (typeof ForgeVTT !== "undefined") && (ForgeVTT?.usingTheForge === true);
}

/**
 * Where copies go: the world's folder, on The Forge the user's Assets Library.
 * @returns {{source: string, dir: string}}
 */
export function storageTarget() {
  return isForge() ? {source: "forgevtt", dir: `${MODULE_ID}/${game.world.id}`}
    : {source: "data", dir: `worlds/${game.world.id}/${MODULE_ID}`};
}

function filePicker() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

/**
 * Create a folder and the folders above it. Existing folders are fine.
 * @param {string} source
 * @param {string} dir
 */
async function ensureDirectory(source, dir) {
  const picker = filePicker();
  const parts = dir.split("/").filter(Boolean);
  for ( let i = 1; i <= parts.length; i++ ) {
    const path = parts.slice(0, i).join("/");
    try {
      await picker.createDirectory(source, path, {});
    } catch(err) {
      if ( !/EEXIST|exist/i.test(String(err?.message ?? err)) ) throw err;
    }
  }
}

/**
 * Upload a copy.
 * @param {File} file
 * @returns {Promise<string>}  The path of the uploaded file
 */
export async function storeOptimized(file) {
  if ( !game.user.hasPermission("FILES_UPLOAD") ) throw new Error("permission");
  const {source, dir} = storageTarget();
  await ensureDirectory(source, dir);
  const response = await filePicker().upload(source, dir, file, {}, {notify: false});
  if ( !response?.path ) throw new Error(response?.message || "upload");
  return response.path;
}

/* -------------------------------------------- */
/*  Pointing scenes at it                       */
/* -------------------------------------------- */

/**
 * Replace a file in the backgrounds, foregrounds, fog overlays and tiles of a scene.
 * @param {Scene} scene
 * @param {string} from
 * @param {string} to
 * @returns {Promise<number>}   How many places changed
 */
export async function replaceInScene(scene, from, to) {
  let changed = 0;
  if ( hasLevels(scene) ) {
    const updates = [];
    for ( const level of scene.levels ) {
      const update = {_id: level.id};
      if ( level.background?.src === from ) update["background.src"] = to;
      if ( level.foreground?.src === from ) update["foreground.src"] = to;
      if ( level.fog?.src === from ) update["fog.src"] = to;
      if ( Object.keys(update).length > 1 ) updates.push(update);
    }
    if ( updates.length ) {
      await scene.updateEmbeddedDocuments("Level", updates);
      changed += updates.length;
    }
  }
  else {
    const update = {};
    if ( scene.background?.src === from ) update["background.src"] = to;
    if ( scene.foreground === from ) update.foreground = to;
    if ( scene.fog?.overlay === from ) update["fog.overlay"] = to;
    if ( Object.keys(update).length ) {
      await scene.update(update);
      changed++;
    }
  }
  const tiles = scene.tiles.filter(t => t.texture?.src === from).map(t => ({_id: t.id, "texture.src": to}));
  if ( tiles.length ) {
    await scene.updateEmbeddedDocuments("Tile", tiles);
    changed += tiles.length;
  }
  return changed;
}

/**
 * The scenes of the world that use a file where a copy can replace it.
 * @param {string} src
 * @returns {Scene[]}
 */
export function scenesUsing(src) {
  return game.scenes.filter(scene => collectAssets(scene).some(a => (a.src === src)
    && [...a.roles].some(r => ["background", "foreground", "fog", "tile"].includes(r))));
}

/**
 * Use a copy instead of the original in some scenes, and remember the original in each scene.
 * @param {Scene[]} scenes
 * @param {string} from
 * @param {string} to
 * @param {object} [info]   Bytes before and after, for the scene's record
 * @returns {Promise<number>}   Places changed
 */
export async function useCopy(scenes, from, to, info={}) {
  let total = 0;
  for ( const scene of scenes ) {
    const changed = await replaceInScene(scene, from, to);
    if ( !changed ) continue;
    total += changed;
    const list = (scene.getFlag(MODULE_ID, "optimized") ?? []).filter(e => e.to !== to);
    list.push({from, to, at: Date.now(), before: info.before ?? null, after: info.after ?? null});
    await scene.setFlag(MODULE_ID, "optimized", list);
  }
  return total;
}

/**
 * The copies a scene uses.
 * @param {Scene} scene
 * @returns {{from: string, to: string, at: number}[]}
 */
export function copiesOf(scene) {
  const list = scene?.getFlag(MODULE_ID, "optimized") ?? [];
  const used = new Set(collectAssets(scene).map(a => a.src));
  return list.filter(e => used.has(e.to));
}

/**
 * Put the original back in a scene.
 * @param {Scene} scene
 * @param {string} to   The copy
 * @returns {Promise<number>}
 */
export async function restoreOriginal(scene, to) {
  const list = scene.getFlag(MODULE_ID, "optimized") ?? [];
  const entry = list.find(e => e.to === to);
  if ( !entry ) return 0;
  const changed = await replaceInScene(scene, entry.to, entry.from);
  await scene.setFlag(MODULE_ID, "optimized", list.filter(e => e !== entry));
  return changed;
}
