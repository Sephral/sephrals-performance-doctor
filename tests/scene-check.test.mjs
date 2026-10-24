import assert from "node:assert/strict";
import test from "node:test";
import {
  canOptimize, collectAssets, countPlaceables, diagnoseScene, fileName, parseImageHeader, summarizeScene, typeFromName
} from "../scripts/scene-check.mjs";

const MB = 1024 * 1024;

/**
 * Bytes from numbers and text.
 * @param {...(number|string|number[])} parts
 * @returns {Uint8Array}
 */
function bytes(...parts) {
  const out = [];
  for ( const p of parts ) {
    if ( typeof p === "string" ) out.push(...[...p].map(c => c.charCodeAt(0)));
    else if ( Array.isArray(p) ) out.push(...p);
    else out.push(p);
  }
  while ( out.length < 64 ) out.push(0);
  return Uint8Array.from(out);
}
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = n => [(n >>> 8) & 255, n & 255];
const le16 = n => [n & 255, (n >>> 8) & 255];
const le24 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

test("PNG size, and the animation chunk", () => {
  const png = bytes([0x89], "PNG", [13, 10, 26, 10], u32(13), "IHDR", u32(12000), u32(8000), [8, 2, 0, 0, 0], u32(0), u32(0), "IDAT");
  assert.deepEqual(parseImageHeader(png), {type: "image/png", width: 12000, height: 8000, animated: false});
  const apng = bytes([0x89], "PNG", [13, 10, 26, 10], u32(13), "IHDR", u32(10), u32(20), [8, 6, 0, 0, 0], u32(0), u32(8), "acTL", u32(2), u32(0), u32(0));
  assert.equal(parseImageHeader(apng).animated, true);
});

test("JPEG size from the frame header after other markers", () => {
  const jpeg = bytes([0xFF, 0xD8, 0xFF, 0xE0], u16(16), "JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xFF, 0xC0], u16(17), [8], u16(6000), u16(9000), [3]);
  assert.deepEqual(parseImageHeader(jpeg), {type: "image/jpeg", width: 9000, height: 6000, animated: false});
});

test("GIF and the three kinds of WebP", () => {
  assert.deepEqual(parseImageHeader(bytes("GIF89a", le16(320), le16(200))), {type: "image/gif", width: 320, height: 200, animated: true});
  const vp8 = bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8 ", [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], le16(4000), le16(3000));
  assert.deepEqual(parseImageHeader(vp8), {type: "image/webp", width: 4000, height: 3000, animated: false});
  // Lossless: 14 bits each for width - 1 and height - 1
  const w = 1000 - 1;
  const h = 700 - 1;
  const bits = w | (h << 14);
  const vp8l = bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8L", [0, 0, 0, 0], [0x2f], [bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255]);
  assert.deepEqual(parseImageHeader(vp8l), {type: "image/webp", width: 1000, height: 700, animated: false});
  const vp8x = bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0], [0x02, 0, 0, 0], le24(16383 - 1), le24(9000 - 1));
  assert.deepEqual(parseImageHeader(vp8x), {type: "image/webp", width: 16383, height: 9000, animated: true});
});

test("AVIF size from the ispe box", () => {
  const avif = bytes(u32(24), "ftyp", "avif", u32(0), "mif1", "avif", u32(20), "ispe", u32(0), u32(5000), u32(4000));
  assert.deepEqual(parseImageHeader(avif), {type: "image/avif", width: 5000, height: 4000, animated: false});
  assert.equal(parseImageHeader(bytes("hello")), null);
});

test("file names and types", () => {
  assert.equal(fileName("worlds/x/maps/Dragon%20Lair.webp?v=2"), "Dragon Lair.webp");
  assert.equal(typeFromName("maps/a.JPG"), "image/jpeg");
  assert.equal(typeFromName("maps/a.webm"), null);
});

/** A scene of Foundry 13. */
const v13Scene = {
  id: "s1",
  background: {src: "maps/big.png"},
  foreground: "maps/roof.webp",
  fog: {overlay: null},
  tiles: [{id: "t1", texture: {src: "maps/big.png"}}, {id: "t2", texture: {src: "fx/fire.webm"}}],
  tokens: [{id: "k1", texture: {src: "tokens/a.webp"}, ring: {enabled: false}, sight: {enabled: true}, light: {dim: 20, bright: 0, animation: {type: "torch"}}},
    {id: "k2", texture: {src: "tokens/a.webp"}, ring: {enabled: true, subject: {texture: "tokens/a-subject.webp"}}, sight: {enabled: false}, light: {}}],
  walls: [{id: "w1", door: 1, animation: {texture: null}}, {id: "w2", door: 0}],
  notes: [],
  drawings: [{id: "d1", texture: null}],
  sounds: [{id: "a1", path: "music/rain.ogg"}],
  lights: [{id: "l1", config: {animation: {type: "pulse"}}}, {id: "l2", config: {animation: {type: null}}}],
  regions: []
};

test("the files of a Foundry 13 scene, once each", () => {
  const assets = collectAssets(v13Scene);
  const map = Object.fromEntries(assets.map(a => [a.src, [...a.roles].sort().join(",")]));
  assert.deepEqual(map, {
    "maps/big.png": "background,tile",
    "maps/roof.webp": "foreground",
    "fx/fire.webm": "tile",
    "tokens/a.webp": "token",
    "tokens/a-subject.webp": "token",
    "music/rain.ogg": "sound"
  });
  assert.equal(assets.find(a => a.src === "tokens/a.webp").uses, 2);
});

test("the files of a Foundry 14 scene come from its levels", () => {
  class Scene14 {
    static metadata = {defaultLevelId: "defaultLevel0000"};
  }
  const scene = Object.assign(new Scene14(), {...v13Scene, background: undefined, foreground: undefined,
    levels: [{id: "L1", background: {src: "maps/floor1.webp"}, foreground: {src: null}, fog: {src: null}},
      {id: "L2", background: {src: "maps/floor2.webp"}, foreground: {src: "maps/roof2.webp"}, fog: {src: null}}]});
  const srcs = collectAssets(scene).map(a => a.src);
  assert.ok(srcs.includes("maps/floor1.webp") && srcs.includes("maps/floor2.webp") && srcs.includes("maps/roof2.webp"));
  assert.ok(!srcs.includes("maps/roof.webp"));
  assert.equal(countPlaceables(scene).levels, 2);
});

test("what the canvas has to work with", () => {
  const c = countPlaceables(v13Scene);
  assert.deepEqual({walls: c.walls, doors: c.doors, lights: c.lights, animated: c.animatedLights, tokens: c.tokens,
    vision: c.visionTokens, tiles: c.tiles, videos: c.videos}, {walls: 2, doors: 1, lights: 3, animated: 2, tokens: 2,
    vision: 1, tiles: 2, videos: 1});
});

/**
 * A checked asset.
 * @param {string} src
 * @param {number} bytes
 * @param {number} width
 * @param {number} height
 * @param {string[]} roles
 * @param {object} [extra]
 * @returns {object}
 */
const asset = (src, bytes, width, height, roles, extra={}) => ({src, bytes, width, height, roles: new Set(roles), uses: 1,
  docs: [], type: extra.type ?? "image/webp", video: false, audio: false, animated: false, ...extra});

test("the summary of a checked scene", () => {
  const s = summarizeScene([asset("a.png", 40 * MB, 12000, 8000, ["background"], {type: "image/png"}),
    asset("b.webp", 2 * MB, 2000, 2000, ["tile"]), asset("rain.ogg", 5 * MB, null, null, ["sound"], {audio: true})],
  {walls: 10, animatedLights: 1});
  assert.equal(s.totalBytes, 42 * MB);
  assert.equal(s.soundBytes, 5 * MB);
  assert.equal(s.largestSide, 12000);
  assert.equal(s.files, 2);
  assert.ok(Math.abs(s.gpuMemory - ((12000 * 8000) + (2000 * 2000)) * 4 * (4 / 3)) < 1);
});

test("a copy at 8192 pixels is not too large, one pixel more is", () => {
  const ids = assets => diagnoseScene(summarizeScene(assets, {}), {players: []}).map(f => f.id);
  assert.ok(!ids([asset("copy.webp", 2 * MB, 8192, 5461, ["background"])]).includes("imageLarge"));
  assert.ok(ids([asset("big.webp", 2 * MB, 8193, 5462, ["background"])]).includes("imageLarge"));
});

test("findings of a heavy scene for the GM", () => {
  const summary = summarizeScene([
    asset("huge.png", 45 * MB, 12000, 8000, ["background"], {type: "image/png"}),
    asset("wide.webp", 3 * MB, 17000, 2000, ["tile"]),
    asset("big.png", 7 * MB, 4000, 4000, ["tile"], {type: "image/png"}),
    asset("token.webp", 100000, 400, 400, ["token"]),
    asset("fx.webm", 50 * MB, 1920, 1080, ["tile"], {video: true, type: "video/webm"})
  ], {walls: 3000, lights: 10, animatedLights: 30, tokens: 20, visionTokens: 5, tiles: 3, videos: 4, drawings: 0, sounds: 0});
  const list = diagnoseScene(summary, {players: [{name: "Mia", maxTexture: 16384, bytesPerSecond: 1e6},
    {name: "Tom", maxTexture: 8192, bytesPerSecond: 5e6}]});
  const by = Object.fromEntries(list.map(f => [`${f.id}:${f.data.file ?? ""}`, f]));
  assert.equal(by["sceneDownloadPlayer:"].severity, 3);
  assert.equal(by["sceneDownloadPlayer:"].data.slowest, "Mia");
  assert.match(by["imageTooLargeForPlayers:huge.png"].data.players, /Tom \(8192 px\)/);
  assert.equal(by["imageTooLargeForPlayers:wide.webp"].severity, 3);
  assert.equal(by["imagePng:big.png"].severity, 1);
  assert.equal(by["videoHeavy:fx.webm"].severity, 3);
  assert.equal(by["videoHeavy:fx.webm"].fixes.length, 0);
  assert.equal(by["crowd.walls:"].severity, 1);
  assert.equal(by["crowd.animatedLights:"].severity, 1);
  assert.equal(by["crowd.videos:"].severity, 1);
  assert.ok(!by["token.webp"]);
  assert.equal(by["imageTooLargeForPlayers:huge.png"].fixes[0].kind, "optimize");
});

test("a light scene has no findings", () => {
  const summary = summarizeScene([asset("map.webp", 3 * MB, 4000, 3000, ["background"])], {walls: 200, lights: 10});
  assert.deepEqual(diagnoseScene(summary), []);
});

test("which files can get a smaller copy", () => {
  assert.equal(canOptimize(asset("a.png", 1, 1, 1, ["background"], {type: "image/png"})), true);
  assert.equal(canOptimize(asset("a.png", 1, 1, 1, ["token"], {type: "image/png"})), false);
  assert.equal(canOptimize(asset("a.webm", 1, 1, 1, ["tile"], {video: true})), false);
  assert.equal(canOptimize(asset("a.webp", 1, 1, 1, ["tile"], {animated: true})), false);
  assert.equal(canOptimize(asset("a.svg", 1, 1, 1, ["tile"], {type: "image/svg+xml"})), false);
});
