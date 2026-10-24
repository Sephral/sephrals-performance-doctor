/**
 * The scene check: which files a scene makes every player download, how large they are in bytes and in pixels, and
 * how many walls, lights and tokens the canvas has to work with. Sizes come from the browser's own downloads, from a
 * HEAD request, and pixel sizes from the first bytes of each image, so a check never downloads a whole map.
 */

import {finding, sortFindings, SCENE_BYTES} from "./rules.mjs";
import {ignorePartial, lastDownloadOf} from "./network.mjs";

const VIDEO = /\.(?:webm|mp4|m4v|ogv|mov)(?:[?#]|$)/i;
const AUDIO = /\.(?:mp3|ogg|oga|opus|wav|flac|m4a|aac|webm#audio)(?:[?#]|$)/i;
const SOUND_ROLES = new Set(["sound"]);

/** Header bytes read for the pixel size. */
const HEADER_BYTES = 128 * 1024;

/** Results of earlier checks, by file. */
const probes = new Map();
const PROBE_TTL = 10 * 60 * 1000;

/** Image sizes that need a closer look. */
export const IMAGE_LIMITS = {bytesWarn: 15 * 1024 * 1024, bytesSerious: 40 * 1024 * 1024, pngWarn: 6 * 1024 * 1024,
  sideWarn: 8192, sideSerious: 16384};

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * Does the scene keep its backgrounds in levels (Foundry 14)?
 * @param {Scene} scene
 * @returns {boolean}
 */
export function hasLevels(scene) {
  return Boolean(scene?.constructor?.metadata?.defaultLevelId) && !!scene?.levels;
}

/**
 * Every file the canvas loads for a scene, once per file, with what uses it.
 * @param {Scene} scene
 * @returns {{src: string, roles: Set<string>, uses: number, docs: {type: string, id: string}[]}[]}
 */
export function collectAssets(scene) {
  const assets = new Map();
  const add = (src, role, type, id) => {
    if ( !src || (typeof src !== "string") || src.startsWith("#") ) return;
    const asset = assets.get(src) ?? {src, roles: new Set(), uses: 0, docs: []};
    asset.roles.add(role);
    asset.uses++;
    asset.docs.push({type, id, role});
    assets.set(src, asset);
  };
  if ( hasLevels(scene) ) {
    for ( const level of scene.levels ) {
      add(level.background?.src, "background", "Level", level.id);
      add(level.foreground?.src, "foreground", "Level", level.id);
      add(level.fog?.src, "fog", "Level", level.id);
    }
  }
  else {
    add(scene.background?.src, "background", "Scene", scene.id);
    add(scene.foreground, "foreground", "Scene", scene.id);
    add(scene.fog?.overlay, "fog", "Scene", scene.id);
  }
  for ( const tile of scene.tiles ?? [] ) add(tile.texture?.src, "tile", "Tile", tile.id);
  for ( const token of scene.tokens ?? [] ) {
    add(token.texture?.src, "token", "Token", token.id);
    if ( token.ring?.enabled ) add(token.ring?.subject?.texture, "token", "Token", token.id);
  }
  for ( const wall of scene.walls ?? [] ) add(wall.animation?.texture, "door", "Wall", wall.id);
  for ( const note of scene.notes ?? [] ) add(note.texture?.src, "note", "Note", note.id);
  for ( const drawing of scene.drawings ?? [] ) add(drawing.texture, "drawing", "Drawing", drawing.id);
  for ( const sound of scene.sounds ?? [] ) add(sound.path, "sound", "AmbientSound", sound.id);
  return [...assets.values()];
}

/**
 * What the canvas has to work with on a scene.
 * @param {Scene} scene
 * @returns {object}
 */
export function countPlaceables(scene) {
  const list = c => (c?.contents ?? Array.from(c ?? []));
  const lights = list(scene.lights);
  const tokens = list(scene.tokens);
  const tiles = list(scene.tiles);
  const walls = list(scene.walls);
  const tokenLights = tokens.filter(t => ((t.light?.dim ?? 0) > 0) || ((t.light?.bright ?? 0) > 0));
  const isVideo = src => VIDEO.test(String(src ?? ""));
  const backgrounds = hasLevels(scene) ? list(scene.levels).map(l => l.background?.src) : [scene.background?.src];
  return {
    walls: walls.length,
    doors: walls.filter(w => (w.door ?? 0) > 0).length,
    lights: lights.length + tokenLights.length,
    animatedLights: lights.filter(l => l.config?.animation?.type).length
      + tokenLights.filter(t => t.light?.animation?.type).length,
    tokens: tokens.length,
    visionTokens: tokens.filter(t => t.sight?.enabled).length,
    tiles: tiles.length,
    videos: tiles.filter(t => isVideo(t.texture?.src)).length + backgrounds.filter(isVideo).length,
    sounds: list(scene.sounds).length,
    drawings: list(scene.drawings).length,
    notes: list(scene.notes).length,
    regions: list(scene.regions).length,
    levels: hasLevels(scene) ? list(scene.levels).length : 1
  };
}

/**
 * Read width and height from the first bytes of an image: PNG, JPEG, GIF, WebP and AVIF.
 * @param {Uint8Array} bytes
 * @returns {{type: string, width: number, height: number, animated: boolean}|null}
 */
export function parseImageHeader(bytes) {
  if ( !bytes || (bytes.length < 24) ) return null;
  const u16be = o => (bytes[o] << 8) | bytes[o + 1];
  const u16le = o => bytes[o] | (bytes[o + 1] << 8);
  const u24le = o => bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
  const u32be = o => ((bytes[o] << 24) >>> 0) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3];
  const ascii = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));

  // PNG: the IHDR chunk follows the signature, animated PNGs have an acTL chunk before the image data
  if ( (bytes[0] === 0x89) && (ascii(1, 3) === "PNG") ) {
    let animated = false;
    for ( let o = 8; o + 8 <= bytes.length; ) {
      const length = u32be(o);
      const type = ascii(o + 4, 4);
      if ( type === "acTL" ) animated = true;
      if ( (type === "IDAT") || (type === "IEND") ) break;
      o += 12 + length;
    }
    return {type: "image/png", width: u32be(16), height: u32be(20), animated};
  }
  // JPEG: walk the markers to the frame header
  if ( (bytes[0] === 0xFF) && (bytes[1] === 0xD8) ) {
    let o = 2;
    while ( o + 9 < bytes.length ) {
      if ( bytes[o] !== 0xFF ) {
        o++;
        continue;
      }
      const marker = bytes[o + 1];
      if ( (marker === 0xD8) || (marker === 0x01) || ((marker >= 0xD0) && (marker <= 0xD7)) ) {
        o += 2;
        continue;
      }
      const length = u16be(o + 2);
      const frame = (marker >= 0xC0) && (marker <= 0xCF) && ![0xC4, 0xC8, 0xCC].includes(marker);
      if ( frame ) return {type: "image/jpeg", height: u16be(o + 5), width: u16be(o + 7), animated: false};
      o += 2 + length;
    }
    return null;
  }
  // GIF
  if ( ascii(0, 3) === "GIF" ) return {type: "image/gif", width: u16le(6), height: u16le(8), animated: true};
  // WebP: lossy, lossless or extended
  if ( (ascii(0, 4) === "RIFF") && (ascii(8, 4) === "WEBP") ) {
    const chunk = ascii(12, 4);
    if ( chunk === "VP8 " ) return {type: "image/webp", width: u16le(26) & 0x3FFF, height: u16le(28) & 0x3FFF, animated: false};
    if ( chunk === "VP8L" ) {
      const b = bytes.subarray(21, 25);
      return {type: "image/webp", width: 1 + (((b[1] & 0x3F) << 8) | b[0]),
        height: 1 + (((b[3] & 0x0F) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6)), animated: false};
    }
    if ( chunk === "VP8X" ) {
      return {type: "image/webp", width: 1 + u24le(24), height: 1 + u24le(27), animated: Boolean(bytes[20] & 0x02)};
    }
    return null;
  }
  // AVIF: the size sits in the "ispe" box
  if ( (ascii(4, 4) === "ftyp") && /avi[fs]|heic|mif1/.test(ascii(8, 16)) ) {
    for ( let o = 12; o + 16 <= bytes.length; o++ ) {
      if ( (bytes[o] === 0x69) && (ascii(o, 4) === "ispe") ) {
        return {type: "image/avif", width: u32be(o + 8), height: u32be(o + 12), animated: ascii(8, 4) === "avis"};
      }
    }
  }
  return null;
}

/**
 * The image type a file name suggests.
 * @param {string} src
 * @returns {string|null}
 */
export function typeFromName(src) {
  const ext = String(src ?? "").split(/[?#]/)[0].split(".").pop()?.toLowerCase();
  return {png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif",
    gif: "image/gif", svg: "image/svg+xml"}[ext] ?? null;
}

/**
 * A short file name for a path.
 * @param {string} src
 * @returns {string}
 */
export function fileName(src) {
  const path = String(src ?? "").split(/[?#]/)[0];
  let name = path.split("/").pop() || path;
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the raw name
  }
  return name;
}

/**
 * The numbers of a checked scene.
 * @param {object[]} assets   Probed assets
 * @param {object} counts     countPlaceables()
 * @param {object} [extra]    id, name, dimensions
 * @returns {object}
 */
export function summarizeScene(assets, counts, extra={}) {
  const visual = assets.filter(a => !a.audio && ![...(a.roles ?? [])].every(r => SOUND_ROLES.has(r)));
  const sounds = assets.filter(a => !visual.includes(a));
  const sum = list => list.reduce((total, a) => total + (a.bytes ?? 0), 0);
  let largest = null;
  for ( const a of visual ) {
    const side = Math.max(a.width ?? 0, a.height ?? 0);
    if ( side && (!largest || (side > largest.side)) ) largest = {side, src: a.src, width: a.width, height: a.height};
  }
  const gpuMemory = visual.reduce((total, a) => total + ((a.width && a.height) ? a.width * a.height * 4 * (4 / 3) : 0), 0);
  return {
    ...extra,
    assets,
    counts,
    totalBytes: sum(visual),
    soundBytes: sum(sounds),
    files: visual.length,
    unknown: visual.filter(a => a.bytes === null).length,
    largestSide: largest?.side ?? 0,
    largestSrc: largest?.src ?? null,
    gpuMemory,
    embedded: assets.filter(a => a.src.startsWith("data:")).length,
    animatedLights: counts.animatedLights
  };
}

/**
 * The findings of a scene for the GM: heavy files, files too large for a player's graphics chip, and crowded
 * canvases.
 * @param {object} summary   summarizeScene()
 * @param {object} [context]
 * @param {{name: string, maxTexture: number|null, bytesPerSecond: number|null}[]} [context.players]
 * @returns {object[]}
 */
export function diagnoseScene(summary, {players=[]}={}) {
  const out = [];
  const bytes = summary.totalBytes;
  const known = players.filter(p => p.bytesPerSecond > 0);
  const slowest = known.sort((a, b) => a.bytesPerSecond - b.bytesPerSecond)[0] ?? null;
  if ( bytes >= SCENE_BYTES.warn ) {
    out.push(finding(slowest ? "sceneDownloadPlayer" : "sceneDownload", "scene", bytes >= SCENE_BYTES.serious ? 3 : 2,
      {bytes, slowest: slowest?.name ?? null, ms: slowest ? (bytes / slowest.bytesPerSecond) * 1000 : null,
        typical: (bytes / 2e6) * 1000}));
  }
  for ( const asset of summary.assets ) {
    if ( asset.audio || asset.src.startsWith("data:") ) continue;
    const side = Math.max(asset.width ?? 0, asset.height ?? 0);
    const optimizable = canOptimize(asset);
    const fixes = optimizable ? [{kind: "optimize", src: asset.src}] : [];
    const data = {file: fileName(asset.src), src: asset.src, bytes: asset.bytes, width: asset.width, height: asset.height,
      roles: [...asset.roles].join(", ")};
    const tooSmall = players.filter(p => p.maxTexture && side && (side > p.maxTexture));
    if ( tooSmall.length ) {
      out.push(finding("imageTooLargeForPlayers", "scene", 3,
        {...data, side, players: tooSmall.map(p => `${p.name} (${p.maxTexture} px)`).join(", ")}, fixes));
      continue;
    }
    if ( (asset.bytes ?? 0) >= IMAGE_LIMITS.bytesWarn ) {
      out.push(finding(asset.video ? "videoHeavy" : "imageHeavy", "scene",
        asset.bytes >= IMAGE_LIMITS.bytesSerious ? 3 : 2, data, fixes));
    }
    else if ( side > IMAGE_LIMITS.sideWarn ) {
      out.push(finding("imageLarge", "scene", side > IMAGE_LIMITS.sideSerious ? 3 : 2, {...data, side}, fixes));
    }
    else if ( (asset.type === "image/png") && ((asset.bytes ?? 0) >= IMAGE_LIMITS.pngWarn) ) {
      out.push(finding("imagePng", "scene", 1, data, fixes));
    }
  }
  if ( summary.gpuMemory >= 1.5 * 1024 * 1024 * 1024 ) {
    out.push(finding("sceneGpuMemory", "scene", summary.gpuMemory >= 3 * 1024 * 1024 * 1024 ? 3 : 2, {bytes: summary.gpuMemory}));
  }
  if ( summary.embedded ) out.push(finding("sceneEmbedded", "scene", 2, {count: summary.embedded}));
  const c = summary.counts ?? {};
  const crowd = [
    ["walls", c.walls, 2500, 6000],
    ["lights", c.lights, 60, 150],
    ["animatedLights", c.animatedLights, 20, 60],
    ["tokens", c.tokens, 150, 350],
    ["visionTokens", c.visionTokens, 40, 100],
    ["tiles", c.tiles, 250, 600],
    ["videos", c.videos, 3, 8],
    ["drawings", c.drawings, 400, 1200],
    ["sounds", c.sounds, 40, 120]
  ];
  for ( const [what, count, warn, serious] of crowd ) {
    if ( (count ?? 0) >= warn ) out.push(finding(`crowd.${what}`, "scene", count >= serious ? 2 : 1, {count}));
  }
  return sortFindings(out);
}

/**
 * Can the module make a smaller copy of this file? Still images used as background, foreground, fog or tile.
 * @param {object} asset
 * @returns {boolean}
 */
export function canOptimize(asset) {
  if ( asset.video || asset.audio || asset.animated || asset.src.startsWith("data:") ) return false;
  if ( !["image/png", "image/jpeg", "image/webp", "image/avif", null, undefined].includes(asset.type) ) return false;
  if ( /\.(?:svg|gif|basis|ktx2)(?:[?#]|$)/i.test(asset.src) ) return false;
  return [...asset.roles].some(r => ["background", "foreground", "fog", "tile"].includes(r));
}

/* -------------------------------------------- */
/*  Probing                                     */
/* -------------------------------------------- */

/**
 * The texture of a file, if the canvas holds it.
 * @param {string} src
 * @returns {PIXI.BaseTexture|null}
 */
function cachedTexture(src) {
  try {
    const cache = globalThis.PIXI?.Assets?.cache;
    const asset = cache?.has(src) ? cache.get(src) : null;
    const base = asset?.baseTexture ?? null;
    return base?.valid ? base : null;
  } catch {
    return null;
  }
}

/**
 * Ask the server how large a file is.
 * @param {string} src
 * @returns {Promise<{bytes: number|null, type: string|null}|null>}
 */
async function headRequest(src) {
  try {
    const response = await fetch(src, {method: "HEAD", cache: "no-cache"});
    if ( !response.ok ) return {bytes: null, type: null, status: response.status};
    const length = Number(response.headers.get("content-length"));
    return {bytes: Number.isFinite(length) && (length > 0) ? length : null,
      type: response.headers.get("content-type")?.split(";")[0] ?? null};
  } catch {
    return null;
  }
}

/**
 * Read the first bytes of a file. The total size comes from Content-Range, or from Content-Length when the server
 * sends the whole file (then the download stops after the header bytes).
 * @param {string} src
 * @returns {Promise<{bytes: Uint8Array, total: number|null}|null>}
 */
async function readHeader(src) {
  const controller = new AbortController();
  ignorePartial(src);
  try {
    const response = await fetch(src, {headers: {Range: `bytes=0-${HEADER_BYTES - 1}`}, signal: controller.signal,
      cache: "no-cache"});
    if ( !response.ok || !response.body ) return null;
    const range = response.headers.get("content-range")?.match(/\/(\d+)$/);
    const length = Number(response.headers.get("content-length"));
    const total = range ? Number(range[1]) : ((response.status === 200) && (length > 0) ? length : null);
    const reader = response.body.getReader();
    const chunks = [];
    let got = 0;
    while ( got < HEADER_BYTES ) {
      const {done, value} = await reader.read();
      if ( done ) break;
      chunks.push(value);
      got += value.byteLength;
    }
    controller.abort();
    const bytes = new Uint8Array(Math.min(got, HEADER_BYTES));
    let offset = 0;
    for ( const chunk of chunks ) {
      const part = chunk.subarray(0, Math.min(chunk.byteLength, bytes.length - offset));
      bytes.set(part, offset);
      offset += part.byteLength;
      if ( offset >= bytes.length ) break;
    }
    return {bytes, total};
  } catch {
    return null;
  }
}

/**
 * The pixel size of a video, from its metadata.
 * @param {string} src
 * @returns {Promise<{width: number, height: number}|null>}
 */
function videoSize(src) {
  return new Promise(resolve => {
    const video = document.createElement("video");
    const done = value => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 8000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => done({width: video.videoWidth, height: video.videoHeight});
    video.onerror = () => done(null);
    video.src = src;
  });
}

/**
 * Find out size and pixels of one file.
 * @param {string} src
 * @param {object} [options]
 * @param {boolean} [options.fresh=false]   Ignore earlier results
 * @returns {Promise<object>}
 */
export function probeAsset(src, {fresh=false}={}) {
  const known = probes.get(src);
  if ( known && !fresh && ((Date.now() - known.at) < PROBE_TTL) ) return known.promise;
  const promise = (async () => {
    const result = {src, bytes: null, width: null, height: null, type: null, animated: false,
      video: VIDEO.test(src), audio: AUDIO.test(src) && !VIDEO.test(src), error: null};
    if ( src.startsWith("data:") ) {
      result.bytes = Math.round((src.length - src.indexOf(",") - 1) * 0.75);
      result.type = src.slice(5, src.indexOf(";")) || null;
      return result;
    }
    const texture = cachedTexture(src);
    if ( texture ) {
      const source = texture.resource?.source;
      result.width = source?.videoWidth || texture.realWidth || null;
      result.height = source?.videoHeight || texture.realHeight || null;
    }
    const download = lastDownloadOf(src);
    if ( download?.size ) result.bytes = download.size;
    let headFailed = false;
    if ( result.bytes === null ) {
      const head = await headRequest(src);
      headFailed = (head === null) || !!head.status;
      result.bytes = head?.bytes ?? null;
      result.type = head?.type ?? null;
    }
    if ( !result.audio && !result.video && result.width && (result.bytes !== null) ) {
      result.type ??= typeFromName(src);
    }
    else if ( !result.audio && !result.video ) {
      const header = await readHeader(src);
      const parsed = header ? parseImageHeader(header.bytes) : null;
      if ( parsed ) {
        result.type = parsed.type;
        result.animated = parsed.animated;
        result.width ??= parsed.width;
        result.height ??= parsed.height;
      }
      result.bytes ??= header?.total ?? null;
      if ( !header && headFailed ) result.error = "unreachable";
    }
    else if ( result.video && !result.width ) {
      const size = await videoSize(src);
      result.width = size?.width ?? null;
      result.height = size?.height ?? null;
      if ( !size && headFailed ) result.error = "unreachable";
    }
    else if ( headFailed ) result.error = "unreachable";
    return result;
  })();
  probes.set(src, {at: Date.now(), promise});
  return promise;
}

/**
 * Forget what is known about files, for example after they were replaced.
 * @param {string[]} [sources]   All files when left out
 */
export function forgetProbes(sources) {
  if ( !sources ) probes.clear();
  else for ( const src of sources ) probes.delete(src);
}

/**
 * Run tasks with at most a few at the same time.
 * @param {Function[]} tasks
 * @param {number} limit
 * @returns {Promise<any[]>}
 */
async function limited(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while ( next < tasks.length ) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, tasks.length)}, worker));
  return results;
}

/**
 * Check a scene.
 * @param {Scene} scene
 * @param {object} [options]
 * @param {boolean} [options.fresh=false]
 * @param {boolean} [options.includeSounds=true]
 * @returns {Promise<object>}   summarizeScene()
 */
export async function checkScene(scene, {fresh=false, includeSounds=true}={}) {
  const assets = collectAssets(scene).filter(a => includeSounds || !a.roles.has("sound"));
  const probed = await limited(assets.map(a => () => probeAsset(a.src, {fresh})), 4);
  const merged = assets.map((a, i) => ({...a, ...probed[i], roles: a.roles, uses: a.uses, docs: a.docs}));
  const dims = scene.dimensions ?? {};
  return summarizeScene(merged, countPlaceables(scene), {
    id: scene.id,
    name: scene.navName || scene.name,
    width: dims.sceneWidth ?? scene.width,
    height: dims.sceneHeight ?? scene.height,
    grid: scene.grid?.size ?? null,
    at: Date.now()
  });
}

export const __test__ = {VIDEO, AUDIO};
