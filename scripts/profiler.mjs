/**
 * The module measurement. For a few seconds every hook callback, every canvas ticker listener and the timers and
 * animation frames of packages run inside a stopwatch, and the time goes to the package that registered them. When
 * the measurement ends, every callback gets its original function back. Time a callback spends in callbacks it
 * triggers counts for the inner one only.
 *
 * The startup measurement does the same from the moment the module's script loads until Foundry is ready, once,
 * after the user asked for it and reloaded.
 */

import {readStorage, writeStorage} from "./config.mjs";
import {
  captureOwner, hookEntries, hookWrappers, ownerOf, startTimingIntervals, stopTimingIntervals, tagOwner, tracksIntervals,
  watchRegistrations
} from "./owners.mjs";
import {longFramesSince} from "./meter.mjs";
import {downloadsByOwner} from "./network.mjs";

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * An empty accumulator.
 * @returns {Map<string, object>}
 */
export function createAccumulator() {
  return new Map();
}

/**
 * Add a measured call.
 * @param {Map<string, object>} acc
 * @param {string} owner
 * @param {string} kind     "hook", "ticker", "timer" or "frame"
 * @param {string} label    The hook name or the function name
 * @param {number} ms       Own time of the call
 */
export function record(acc, owner, kind, label, ms) {
  let row = acc.get(owner);
  if ( !row ) {
    row = {owner, ms: 0, calls: 0, maxMs: 0, maxLabel: "", kinds: {}, labels: new Map()};
    acc.set(owner, row);
  }
  row.ms += ms;
  row.calls++;
  if ( ms > row.maxMs ) {
    row.maxMs = ms;
    row.maxLabel = label;
  }
  row.kinds[kind] = (row.kinds[kind] ?? 0) + ms;
  const key = `${kind}:${label}`;
  const entry = row.labels.get(key) ?? {kind, label, ms: 0, calls: 0};
  entry.ms += ms;
  entry.calls++;
  row.labels.set(key, entry);
}

/**
 * The time of long animation frames per owner: the scripts the browser names as the start of the work.
 * @param {object[]} frames   meter.readLongFrame() results
 * @returns {Map<string, {ms: number, layout: number, invokers: Map<string, number>}>}
 */
export function longFrameTime(frames) {
  const result = new Map();
  for ( const frame of frames ) {
    for ( const script of frame.scripts ) {
      const row = result.get(script.owner) ?? {ms: 0, layout: 0, invokers: new Map()};
      row.ms += script.ms;
      row.layout += script.layout;
      const invoker = script.type || "script";
      row.invokers.set(invoker, (row.invokers.get(invoker) ?? 0) + script.ms);
      result.set(script.owner, row);
    }
  }
  return result;
}

/**
 * The result rows of a measurement, heaviest first.
 * @param {Map<string, object>} acc
 * @param {object} options
 * @param {number} options.durationMs        How long the measurement ran
 * @param {object[]} [options.longFrames]    Long animation frames during the measurement
 * @returns {object[]}
 */
export function summarizeProfile(acc, {durationMs, longFrames=[]}) {
  const seconds = Math.max(durationMs, 1) / 1000;
  const lft = longFrameTime(longFrames);
  const owners = new Set([...acc.keys(), ...lft.keys()]);
  const rows = [];
  for ( const owner of owners ) {
    const row = acc.get(owner);
    const longFrame = lft.get(owner);
    const measured = row?.ms ?? 0;
    const ms = Math.max(measured, longFrame?.ms ?? 0);
    const labels = row ? [...row.labels.values()].sort((a, b) => b.ms - a.ms).slice(0, 6) : [];
    rows.push({
      owner,
      ms,
      msPerSecond: ms / seconds,
      calls: row?.calls ?? 0,
      maxMs: row?.maxMs ?? 0,
      topLabel: row?.maxLabel ?? "",
      kinds: {...(row?.kinds ?? {}), ...(longFrame && (longFrame.ms > measured) ? {long: longFrame.ms - measured} : {})},
      labels: labels.map(l => ({...l, msPerSecond: l.ms / seconds})),
      longMs: longFrame?.ms ?? 0,
      layoutMs: longFrame?.layout ?? 0,
      invokers: longFrame ? Object.fromEntries(longFrame.invokers) : {}
    });
  }
  return rows.sort((a, b) => b.ms - a.ms);
}

/**
 * A readable label for a ticker listener: the function name, or the class of its context.
 * @param {Function} fn
 * @param {object} context
 * @returns {string}
 */
export function listenerLabel(fn, context) {
  const name = String(fn?.name ?? "").replace(/^bound /, "");
  if ( context && (context === globalThis.canvas?.app) ) return "canvas.app.render";
  const owner = context?.constructor?.name;
  if ( owner && (owner !== "Object") ) return name ? `${owner}.${name}` : owner;
  return name || "anonymous";
}

/* -------------------------------------------- */
/*  The stopwatch                               */
/* -------------------------------------------- */

/** The running measurement, or null. */
let session = null;

/** Child time of the calls on the stack. */
const stack = [];

/**
 * Run a function inside the stopwatch of a session.
 * @param {object} s
 * @param {string} owner
 * @param {string} kind
 * @param {string} label
 * @param {Function} fn
 * @param {*} self
 * @param {any[]} args
 * @returns {*}
 */
function timed(s, owner, kind, label, fn, self, args) {
  const start = performance.now();
  stack.push(0);
  try {
    return fn.apply(self, args);
  } finally {
    const total = performance.now() - start;
    const child = stack.pop() ?? 0;
    if ( stack.length ) stack[stack.length - 1] += total;
    if ( session === s ) record(s.acc, owner, kind, label, Math.max(0, total - child));
  }
}

/**
 * Put a stopwatch around one hook callback.
 * @param {object} s
 * @param {object} entry   The entry Foundry keeps: {hook, id, fn, once}
 */
function wrapHookEntry(s, entry) {
  if ( !entry || hookWrappers.has(entry) || (typeof entry.fn !== "function") ) return;
  const original = entry.fn;
  const owner = ownerOf(original);
  const hook = entry.hook;
  const wrapper = function(...args) {
    return timed(s, owner, "hook", hook, original, this, args);
  };
  Object.defineProperty(wrapper, "name", {value: original.name});
  entry.fn = wrapper;
  hookWrappers.set(entry, {original, wrapper});
  s.entries.push(entry);
}

/**
 * Give every wrapped hook callback its original back.
 * @param {object} s
 */
function unwrapHooks(s) {
  for ( const entry of s.entries ) {
    const known = hookWrappers.get(entry);
    if ( known && (entry.fn === known.wrapper) ) entry.fn = known.original;
    hookWrappers.delete(entry);
  }
  s.entries.length = 0;
}

/**
 * Put stopwatches on everything the session watches.
 * @param {object} s
 */
function install(s) {
  // Hook callbacks registered so far, and every new one
  for ( const entry of hookEntries() ) wrapHookEntry(s, entry);
  s.cleanups.push(watchRegistrations(entry => wrapHookEntry(s, entry)));

  // Ticker listeners: all tickers share the listener class, so its emit is patched for the session
  const head = globalThis.canvas?.app?.ticker?._head ?? globalThis.PIXI?.Ticker?.shared?._head;
  const proto = head ? Object.getPrototypeOf(head) : null;
  if ( proto?.emit ) {
    const emit = proto.emit;
    proto.emit = function(deltaTime) {
      const fn = this.fn;
      if ( !fn ) return emit.call(this, deltaTime);
      const owner = ownerOf(fn);
      return timed(s, owner, "ticker", listenerLabel(fn, this.context), emit, this, [deltaTime]);
    };
    s.cleanups.push(() => {
      proto.emit = emit;
    });
  }

  // Animation frames and timers of packages. Foundry's own (the canvas ticker among them) stay untouched.
  const win = globalThis;
  const raf = win.requestAnimationFrame;
  const setTimer = win.setTimeout;
  const setRepeat = win.setInterval;
  let budget = 0;
  let budgetSecond = 0;
  const ownerFor = fn => {
    if ( typeof fn !== "function" ) return null;
    const known = ownerOf(fn);
    if ( known !== "unknown" ) return known;
    // Reading the stack costs a little, so it is rationed for callbacks created anew on every call
    const now = Math.floor(performance.now() / 1000);
    if ( now !== budgetSecond ) {
      budgetSecond = now;
      budget = 0;
    }
    if ( ++budget > 150 ) return null;
    return tagOwner(fn, captureOwner());
  };
  const shouldWrap = owner => owner && !["core", "unknown"].includes(owner);
  win.requestAnimationFrame = function(callback) {
    const owner = ownerFor(callback);
    if ( !shouldWrap(owner) ) return raf.call(win, callback);
    const label = callback.name || "requestAnimationFrame";
    return raf.call(win, function(time) {
      return timed(s, owner, "frame", label, callback, this, [time]);
    });
  };
  win.setTimeout = function(callback, delay, ...args) {
    const owner = ownerFor(callback);
    if ( !shouldWrap(owner) ) return setTimer.call(win, callback, delay, ...args);
    const label = callback.name || "setTimeout";
    return setTimer.call(win, function() {
      return timed(s, owner, "timer", label, callback, this, args);
    }, delay);
  };
  // Repeating timers of packages are known from the start of the page and restarted as timed copies; without the
  // attribution only new ones can be measured
  if ( tracksIntervals() ) {
    startTimingIntervals((record, self) => timed(s, record.owner, "timer", record.callback.name || "setInterval",
      record.callback, self, record.args));
  }
  else {
    win.setInterval = function(callback, delay, ...args) {
      const owner = ownerFor(callback);
      if ( !shouldWrap(owner) ) return setRepeat.call(win, callback, delay, ...args);
      const label = callback.name || "setInterval";
      return setRepeat.call(win, function() {
        return timed(s, owner, "timer", label, callback, this, args);
      }, delay);
    };
  }
  s.cleanups.push(() => {
    win.requestAnimationFrame = raf;
    win.setTimeout = setTimer;
    win.setInterval = setRepeat;
    if ( tracksIntervals() ) stopTimingIntervals();
  });
}

/**
 * End a session and collect its result.
 * @param {object} s
 * @returns {object}
 */
function finish(s) {
  if ( session === s ) session = null;
  unwrapHooks(s);
  for ( const fn of s.cleanups.splice(0).reverse() ) {
    try {
      fn();
    } catch(err) {
      console.error(err);
    }
  }
  const end = performance.now();
  const durationMs = end - s.start;
  const rows = summarizeProfile(s.acc, {durationMs, longFrames: longFramesSince(s.start)});
  return {durationMs, rows, at: Date.now(), kind: s.kind};
}

/* -------------------------------------------- */
/*  Public                                      */
/* -------------------------------------------- */

/**
 * Is a measurement running?
 * @returns {boolean}
 */
export function isProfiling() {
  return !!session;
}

/**
 * Measure for some seconds.
 * @param {object} [options]
 * @param {number} [options.seconds=15]
 * @param {(fraction: number) => void} [options.onProgress]
 * @returns {Promise<{durationMs: number, rows: object[], at: number}>}
 */
export async function profile({seconds=15, onProgress}={}) {
  if ( session ) throw new Error("A measurement is already running");
  const s = {kind: "live", start: performance.now(), acc: createAccumulator(), entries: [], cleanups: []};
  session = s;
  try {
    install(s);
    const total = seconds * 1000;
    while ( (performance.now() - s.start) < total ) {
      await new Promise(resolve => globalThis.setTimeout(resolve, 250));
      onProgress?.(Math.min(1, (performance.now() - s.start) / total));
      if ( session !== s ) break;
    }
  } catch(err) {
    finish(s);
    throw err;
  }
  return finish(s);
}

/** Stop a running measurement at once (for example when the window closes). */
export function abortProfile() {
  if ( session ) finish(session);
}

/* -------------------------------------------- */
/*  Startup measurement                         */
/* -------------------------------------------- */

/** Moments of the start of this page, performance.now() timestamps. */
export const phases = {script: performance.now()};

/** The running startup measurement. */
let startup = null;

/**
 * Ask for a startup measurement at the next load of the page.
 */
export function armStartupProfile() {
  writeStorage("startupProfile", String(Date.now()));
}

/**
 * Start the startup measurement if it was asked for in the last ten minutes. Runs when the script loads.
 * @returns {boolean}
 */
export function beginStartupIfArmed() {
  const armed = Number(readStorage("startupProfile"));
  writeStorage("startupProfile", null);
  if ( !armed || ((Date.now() - armed) > 10 * 60 * 1000) ) return false;
  const s = {kind: "startup", start: 0, acc: createAccumulator(), entries: [], cleanups: []};
  session = s;
  startup = s;
  install(s);
  return true;
}

/**
 * Note a moment of the start.
 * @param {string} name
 */
export function markPhase(name) {
  phases[name] ??= performance.now();
}

/**
 * End the startup measurement and build its report.
 * @returns {object|null}
 */
export function endStartup() {
  const s = startup;
  startup = null;
  if ( !s ) return null;
  const result = finish(s);
  return {...result, phases: startupPhases(), downloads: downloadsByOwner().slice(0, 15)};
}

/** Is a startup measurement running? */
export function isStartupProfiling() {
  return !!startup;
}

/**
 * The stages of the start, in milliseconds since the page began to load.
 * @returns {object}
 */
export function startupPhases() {
  const nav = performance.getEntriesByType?.("navigation")?.[0];
  return {
    html: nav?.responseEnd ?? null,
    scripts: phases.domReady ?? nav?.domContentLoadedEventStart ?? null,
    init: phases.init ?? null,
    setup: phases.setup ?? null,
    canvas: phases.canvasReady ?? null,
    ready: phases.ready ?? null,
    done: phases.readyDone ?? null
  };
}
