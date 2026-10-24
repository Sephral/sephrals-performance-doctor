/**
 * Constants and small helpers shared by the scripts of the module. The module runs on Foundry 13 and 14, so it uses
 * game.i18n instead of the v14 global _loc.
 */

/** The id of this module. */
export const MODULE_ID = "sephrals-performance-doctor";

/** The socket event of this module (the manifest sets "socket": true). */
export const SOCKET = `module.${MODULE_ID}`;

/** The folder of the module's templates. */
export const TEMPLATES = `modules/${MODULE_ID}/templates`;

/** The Foundry versions the module was verified against (see the self-test). */
export const TESTED_VERSIONS = {core: "14.369"};

/** Prefix of the raw local storage keys the module reads before Foundry's settings exist. */
export const STORAGE_PREFIX = `${MODULE_ID}.`;

/**
 * Read a setting of this module.
 * @param {string} key
 * @returns {*}
 */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

/**
 * Localize a key, with optional data.
 * @param {string} key
 * @param {object} [data]
 * @returns {string}
 */
export function t(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

/**
 * The language the module speaks for this user: the module language when one is set, Foundry's otherwise.
 * @returns {string}
 */
export function locale() {
  const choice = game.settings.get(MODULE_ID, "uiLanguage");
  return ["en", "de"].includes(choice) ? choice : game.i18n.lang;
}

/**
 * A number as the module's language writes it.
 * @param {number} value
 * @param {number} [digits=0]   Decimal places
 * @returns {string}
 */
export function num(value, digits=0) {
  return Number(value).toLocaleString(locale(), {minimumFractionDigits: digits, maximumFractionDigits: digits});
}

/**
 * A byte count for people: "820 KB", "4.2 MB", "1.3 GB".
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if ( !Number.isFinite(bytes) || (bytes < 0) ) return "–";
  if ( bytes < 1024 * 1024 ) return `${num(Math.max(1, Math.round(bytes / 1024)))} KB`;
  if ( bytes < 1024 * 1024 * 1024 ) {
    const mb = bytes / (1024 * 1024);
    return `${num(mb, mb < 10 ? 1 : 0)} MB`;
  }
  return `${num(bytes / (1024 * 1024 * 1024), 1)} GB`;
}

/**
 * A download speed in megabits per second, the unit internet plans use.
 * @param {number} bytesPerSecond
 * @returns {string}
 */
export function formatSpeed(bytesPerSecond) {
  if ( !Number.isFinite(bytesPerSecond) || (bytesPerSecond <= 0) ) return "–";
  const mbit = (bytesPerSecond * 8) / 1e6;
  return `${num(mbit, mbit < 10 ? 1 : 0)} Mbit/s`;
}

/**
 * A duration for people: "850 ms", "12 s", "2 min 5 s".
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if ( !Number.isFinite(ms) || (ms < 0) ) return "–";
  if ( ms < 1000 ) return `${num(Math.round(ms))} ms`;
  const s = ms / 1000;
  if ( s < 10 ) return `${num(s, 1)} s`;
  if ( s < 90 ) return `${num(Math.round(s))} s`;
  const minutes = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/**
 * Escape a value for HTML.
 * @param {*} value
 * @returns {string}
 */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;",
    "'": "&#39;"})[ch]);
}

/**
 * Is a window open or on its way? While an application renders, its "rendered" flag is false, and a redraw asked
 * for in that moment would be lost.
 * @param {ApplicationV2|undefined} app
 * @returns {boolean}
 */
export function isShown(app) {
  const states = foundry.applications.api.ApplicationV2.RENDER_STATES;
  return !!app && ((app.state === states.RENDERED) || (app.state === states.RENDERING));
}

/**
 * Read a raw value from local storage, which works before Foundry registered the settings.
 * @param {string} key
 * @returns {string|null}
 */
export function readStorage(key) {
  try {
    return globalThis.localStorage?.getItem(STORAGE_PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Write or remove a raw value in local storage.
 * @param {string} key
 * @param {string|null} value
 */
export function writeStorage(key, value) {
  try {
    if ( value === null ) globalThis.localStorage?.removeItem(STORAGE_PREFIX + key);
    else globalThis.localStorage?.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // Private windows and blocked storage: the feature that needs it simply does not persist
  }
}

/**
 * The display name of an owner key from the attribution ("module:dice-so-nice", "system:dnd5e", "core").
 * @param {string} owner
 * @returns {string}
 */
export function ownerName(owner) {
  if ( !owner ) return t("SPD.Owner.unknown");
  const [kind, id] = owner.split(":");
  if ( kind === "module" ) return game.modules.get(id)?.title ?? id;
  if ( kind === "system" ) return game.system?.id === id ? game.system.title : id;
  if ( ["core", "world", "extension", "content", "unknown", "self"].includes(kind) ) return t(`SPD.Owner.${kind}`);
  return owner;
}
