/**
 * Attribution: which package a piece of code belongs to. JavaScript cannot tell where a function was written, but the
 * call stack at the moment a function is registered names the files involved. The module loads as a library, before
 * the system and the other modules, and notes the owner of every hook callback and canvas ticker listener when it is
 * registered. Nothing is wrapped here, so stack traces of other modules stay as they are.
 */

import {MODULE_ID} from "./config.mjs";

/** Path segments of Foundry's own files. */
const CORE_PATHS = /^\/(?:scripts|client|common|css|fonts|icons|lang|sounds|ui|cards|canvas|nue|tours|templates|docs)\//;

/** The owner of each registered function. */
const owners = new WeakMap();

/** The owner key of this module, which measurements leave out. */
export const SELF = `module:${MODULE_ID}`;

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * The path of a URL without origin, query and hash. A route prefix stays in front.
 * @param {string} url
 * @returns {string}
 */
export function urlPath(url) {
  const text = String(url ?? "");
  const match = text.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/[^?#]*)?/i);
  let path = match ? (match[1] ?? "/") : text.split(/[?#]/)[0];
  try {
    path = decodeURI(path);
  } catch {
    // Keep the raw path when it holds a broken escape
  }
  return path;
}

/**
 * Which package a file belongs to.
 * @param {string} url
 * @returns {string|null}   "module:<id>", "system:<id>", "world", "extension", "core", or null for no URL
 */
export function ownerFromUrl(url) {
  if ( !url ) return null;
  if ( /^(?:chrome|moz|safari-web|ms-browser)-extension:/i.test(url) ) return "extension";
  const path = urlPath(url);
  const pkg = path.match(/\/(modules|systems)\/([^/]+)\//);
  if ( pkg ) return `${pkg[1] === "modules" ? "module" : "system"}:${pkg[2]}`;
  if ( /\/worlds\/[^/]+\//.test(path) ) return "world";
  return "core";
}

/**
 * Which package a downloaded file belongs to. Files outside Foundry's own folders and outside any package are
 * content the GM uploaded: maps, tokens, music.
 * @param {string} url
 * @param {string} [routePrefix]   Foundry's route prefix without slashes, if the server uses one
 * @returns {string}
 */
export function resourceOwner(url, routePrefix="") {
  const owner = ownerFromUrl(url);
  if ( !owner ) return "unknown";
  if ( owner !== "core" ) return owner === "world" ? "content" : owner;
  let path = urlPath(url);
  if ( routePrefix && path.startsWith(`/${routePrefix}/`) ) path = path.slice(routePrefix.length + 1);
  const sameOrigin = !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || (globalThis.location && url.startsWith(globalThis.location.origin));
  if ( sameOrigin && (CORE_PATHS.test(path) || (path === "/") || path.startsWith("/socket.io")) ) return "core";
  if ( sameOrigin && /^\/(?:game|join|setup|license|auth|players|stream)$/.test(path) ) return "core";
  return "content";
}

/**
 * The URLs of a stack trace, innermost first. Understands the formats of Chromium ("at fn (url:1:2)") and of
 * Firefox and Safari ("fn@url:1:2").
 * @param {string} stack
 * @returns {string[]}
 */
export function stackUrls(stack) {
  const urls = [];
  for ( const line of String(stack ?? "").split("\n") ) {
    const match = line.match(/((?:https?|file|blob|(?:chrome|moz|safari-web)-extension):\/\/[^\s()]+?)(?::\d+){1,2}\)?\s*$/i);
    if ( match ) urls.push(match[1]);
  }
  return urls;
}

/**
 * The owner of the code that is running: the innermost package in the stack, skipping Foundry. Code of a module that
 * calls into Foundry, which then registers the callback, belongs to the module.
 * @param {string} stack
 * @param {number} [skip=0]   Frames to leave out first: the functions that look at the stack
 * @returns {string}   An owner key, "core" when no package takes part
 */
export function ownerFromStack(stack, skip=0) {
  for ( const url of stackUrls(stack).slice(skip) ) {
    const owner = ownerFromUrl(url);
    if ( !owner || (owner === "core") ) continue;
    return owner;
  }
  return "core";
}

/* -------------------------------------------- */
/*  Runtime                                     */
/* -------------------------------------------- */

/**
 * The owner of the code that called a patched function. Stack traces are cut after 10 frames in Chromium, so the
 * limit is raised for this one trace: a module often sits deep below Foundry's own calls. The first three frames are
 * the attribution itself (this function, the helper that called it and the patched function).
 * @returns {string}
 */
export function captureOwner() {
  const limit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 60;
    return ownerFromStack(new Error().stack, 3);
  } catch {
    return "unknown";
  } finally {
    Error.stackTraceLimit = limit;
  }
}

/**
 * Remember who registered a function, unless it is known already.
 * @param {Function} fn
 * @param {string} [owner]   Known owner; read from the stack otherwise
 * @returns {string|undefined}
 */
export function tagOwner(fn, owner) {
  if ( typeof fn !== "function" ) return undefined;
  if ( owners.has(fn) ) return owners.get(fn);
  const value = owner ?? captureOwner();
  owners.set(fn, value);
  return value;
}

/**
 * The owner of a registered function.
 * @param {Function} fn
 * @returns {string}   "unknown" for functions registered before the module loaded
 */
export function ownerOf(fn) {
  return (typeof fn === "function" && owners.get(fn)) || "unknown";
}

/**
 * Every entry Foundry keeps for a hook callback. Foundry stores the hook lists as non-enumerable properties.
 * @returns {object[]}  Entries {hook, id, fn, once}
 */
export function hookEntries() {
  const events = globalThis.Hooks?.events;
  if ( !events ) return [];
  return Object.getOwnPropertyNames(events).flatMap(hook => (Array.isArray(events[hook]) ? events[hook] : []));
}

/** Callbacks that run when Hooks.on registers a function, for the startup measurement. */
const onRegister = new Set();

/**
 * Be told about every hook registration.
 * @param {(entry: object) => void} fn   Receives the entry Foundry keeps for the callback
 * @returns {() => void}  Stops it again
 */
export function watchRegistrations(fn) {
  onRegister.add(fn);
  return () => onRegister.delete(fn);
}

/** Translations from an original callback to the wrapper a measurement put in its place, for Hooks.off. */
export const hookWrappers = new WeakMap();

/**
 * Repeating timers of packages, by the id their owner got. A measurement that starts later would never see a timer
 * registered at load, so it swaps such a timer for a timed copy for its duration and back afterwards. The id the
 * owner holds keeps working through clearInterval, and outside a measurement no timer carries a wrapper.
 * @type {Map<number, {owner: string, callback: Function, delay: number, args: any[], current: number}>}
 */
const intervals = new Map();

/** The browser's own timer functions. */
const nativeSetInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;

/** Is a measurement timing the repeating timers? */
let intervalTimer = null;

/** Are repeating timers of packages tracked from the start of the page? */
let intervalsTracked = false;

/**
 * Are repeating timers tracked from the start of the page?
 * @returns {boolean}
 */
export function tracksIntervals() {
  return intervalsTracked;
}

/**
 * Time the repeating timers of packages: each is started again as a timed copy.
 * @param {(record: {owner: string, callback: Function, args: any[]}, self: *) => *} timed   Runs one call
 */
export function startTimingIntervals(timed) {
  intervalTimer = timed;
  for ( const record of intervals.values() ) restartInterval(record);
}

/** Start every repeating timer of a package again as itself. */
export function stopTimingIntervals() {
  intervalTimer = null;
  for ( const record of intervals.values() ) restartInterval(record);
}

/**
 * Start a repeating timer again: timed while a measurement runs, as itself otherwise.
 * @param {object} record
 */
function restartInterval(record) {
  if ( record.current !== undefined ) nativeClearInterval.call(globalThis, record.current);
  const timed = intervalTimer;
  record.current = timed
    ? nativeSetInterval.call(globalThis, function() {
      return timed(record, this);
    }, record.delay)
    : nativeSetInterval.call(globalThis, record.callback, record.delay, ...record.args);
}

let installed = false;

/**
 * Note the owner of hook callbacks and canvas ticker listeners from now on. Runs once when the script loads.
 * @param {object} [options]
 * @param {boolean} [options.enabled=true]   Off: only Hooks.off learns about measurement wrappers
 */
export function installAttribution({enabled=true}={}) {
  if ( installed ) return;
  installed = true;
  const Hooks = globalThis.Hooks;
  if ( Hooks?.on ) {
    const on = Hooks.on;
    const off = Hooks.off;
    Hooks.on = function(hook, fn, options) {
      if ( enabled ) tagOwner(fn);
      const id = on.call(this, hook, fn, options);
      if ( onRegister.size ) {
        const entry = Hooks.events?.[hook]?.at?.(-1);
        if ( entry && (entry.id === id) ) for ( const watcher of onRegister ) watcher(entry);
      }
      return id;
    };
    // While a measurement replaced a callback with its wrapper, Hooks.off(hook, originalFn) must still find it
    Hooks.off = function(hook, fn) {
      if ( typeof fn === "function" ) {
        const entry = Hooks.events?.[hook]?.find?.(e => hookWrappers.get(e)?.original === fn);
        if ( entry ) fn = entry.fn;
      }
      return off.call(this, hook, fn);
    };
  }
  // Repeating timers of packages are noted with their owner, unchanged; clearInterval knows their current id
  if ( enabled && nativeSetInterval && nativeClearInterval ) {
    intervalsTracked = true;
    globalThis.setInterval = function(callback, delay, ...args) {
      if ( typeof callback !== "function" ) return nativeSetInterval.call(globalThis, callback, delay, ...args);
      const owner = tagOwner(callback);
      if ( ["core", "unknown"].includes(owner) ) return nativeSetInterval.call(globalThis, callback, delay, ...args);
      const record = {owner, callback, delay, args, current: undefined};
      restartInterval(record);
      const id = record.current;
      intervals.set(id, record);
      return id;
    };
    globalThis.clearInterval = function(id) {
      const record = intervals.get(id);
      if ( !record ) return nativeClearInterval.call(globalThis, id);
      intervals.delete(id);
      return nativeClearInterval.call(globalThis, record.current);
    };
  }
  const Ticker = globalThis.PIXI?.Ticker;
  if ( enabled && Ticker?.prototype?.add ) {
    const proto = Ticker.prototype;
    const add = proto.add;
    const addOnce = proto.addOnce;
    proto.add = function(fn, context, priority) {
      tagOwner(fn);
      return add.call(this, fn, context, priority);
    };
    proto.addOnce = function(fn, context, priority) {
      tagOwner(fn);
      return addOnce.call(this, fn, context, priority);
    };
  }
}

export const __test__ = {CORE_PATHS};
