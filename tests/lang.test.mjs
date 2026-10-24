import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {PRESETS, SETTING_KEYS} from "../scripts/fixes.mjs";
import {FINDING_IDS} from "../scripts/selftest.mjs";
import {SETTINGS} from "../scripts/settings.mjs";
import {COLLECTIONS} from "../scripts/world-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * All keys of a nested translation object, dotted.
 * @param {object} object
 * @param {string} [prefix]
 * @returns {string[]}
 */
function keysOf(object, prefix="") {
  return Object.entries(object).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return (value && (typeof value === "object")) ? keysOf(value, full) : [full];
  });
}

/**
 * All files of a folder, recursively.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function files(dir) {
  const list = await readdir(dir, {withFileTypes: true});
  return (await Promise.all(list.map(e => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])))).flat();
}

const en = JSON.parse(await readFile(path.join(root, "lang/en.json"), "utf8"));
const de = JSON.parse(await readFile(path.join(root, "lang/de.json"), "utf8"));
const enKeys = new Set(keysOf(en));

test("English and German have the same keys", () => {
  assert.deepEqual([...keysOf(de)].sort(), [...enKeys].sort());
});

test("no key is both a text and a group", () => {
  for ( const key of enKeys ) assert.ok(![...enKeys].some(other => other.startsWith(`${key}.`)), key);
});

test("placeholders match between English and German", () => {
  const get = (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj);
  const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for ( const key of enKeys ) assert.deepEqual(holes(get(de, key)), holes(get(en, key)), key);
});

test("public texts use no semicolons", () => {
  for ( const [lang, data] of [["en", en], ["de", de]] ) {
    for ( const key of keysOf(data) ) {
      const value = key.split(".").reduce((o, k) => o?.[k], data);
      assert.ok(!String(value).includes(";"), `${lang} ${key}`);
    }
  }
});

test("every key used by scripts and templates exists", async () => {
  const sources = [...await files(path.join(root, "scripts")), ...await files(path.join(root, "templates"))];
  const used = new Set();
  for ( const file of sources ) {
    const text = await readFile(file, "utf8");
    for ( const match of text.matchAll(/["'`](SPD\.[A-Za-z0-9_.]+)["'`]/g) ) {
      if ( !match[1].endsWith(".") ) used.add(match[1]);
    }
  }
  const add = (...keys) => keys.forEach(k => used.add(k));
  for ( const key of Object.keys(SETTINGS) ) add(`SPD.SETTINGS.${key}.name`, `SPD.SETTINGS.${key}.hint`);
  for ( const id of FINDING_IDS ) add(`SPD.Finding.${id}.title`);
  for ( const key of Object.keys(SETTING_KEYS) ) add(`SPD.PC.setting.${key}`, `SPD.PC.settingHint.${key}`);
  for ( const value of [0, 1, 2, 3] ) add(`SPD.Fix.setting.performanceMode.${value}`);
  for ( const value of [10, 20, 30, 40, 50, 60] ) add(`SPD.Fix.setting.maxFPS.${value}`);
  for ( const key of ["pixelRatioResolutionScaling", "lightAnimation", "visionAnimation", "mipmap"] ) {
    add(`SPD.Fix.setting.${key}.true`, `SPD.Fix.setting.${key}.false`);
  }
  for ( const id of ["accelChrome", "accelEdge", "accelOpera", "accelBrave", "accelFirefox", "accelSafari", "accelApp",
    "drivers", "browserUpdate", "gpuChoice", "power", "network"] ) {
    add(`SPD.Guide.${id}.title`, `SPD.Guide.${id}.button`, `SPD.Guide.${id}.steps`);
  }
  for ( const id of ["profile", "experiments", "speedTest", "wizard", "reload", "modulesManage", "exportChat", "flushChat",
    "optimizeAll", "openScene"] ) add(`SPD.Action.${id}`);
  for ( const id of ["noAcceleration", "noCanvas", "waiting", "hidden", "smooth", "fair", "slow"] ) {
    add(`SPD.Status.${id}.title`, `SPD.Status.${id}.text`);
  }
  for ( const id of ["overview", "pc", "scene", "modules", "players", "world"] ) add(`SPD.Tab.${id}`);
  for ( const id of ["software", "integrated", "dedicated", "apple", "unknown"] ) add(`SPD.PC.kind.${id}`);
  for ( const id of Object.keys(PRESETS) ) add(`SPD.Preset.${id}.name`, `SPD.Preset.${id}.hint`);
  for ( const id of ["animations", "videos", "weather", "filters", "lighting"] ) {
    add(`SPD.Experiment.${id}`, `SPD.Experiment.verdict.${id}`);
  }
  for ( const id of ["walls", "doors", "lights", "animatedLights", "tokens", "visionTokens", "tiles", "videos", "sounds",
    "drawings", "notes", "regions", "levels"] ) add(`SPD.Scene.count.${id}`);
  for ( const id of ["background", "foreground", "fog", "tile", "token", "door", "note", "drawing", "sound"] ) {
    add(`SPD.Scene.role.${id}`);
  }
  for ( const id of ["hook", "ticker", "timer", "frame", "long"] ) add(`SPD.Modules.kind.${id}`);
  for ( const id of ["scripts", "world", "init", "canvas", "ready"] ) add(`SPD.Startup.phase.${id}`);
  for ( const id of [...COLLECTIONS, "other"] ) add(`SPD.World.collection.${id}`);
  for ( const id of ["animated", "toolarge", "nowebp", "unknownsize", "permission"] ) add(`SPD.Optimize.error.${id}`);
  for ( const id of ["unknown", "core", "world", "extension", "content", "self"] ) add(`SPD.Owner.${id}`);
  const missing = [...used].filter(key => !enKeys.has(key));
  assert.deepEqual(missing, []);
});
