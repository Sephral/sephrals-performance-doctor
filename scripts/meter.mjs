/**
 * The live meter: frame rate, the time the canvas needs per frame, blocked moments, the delay to the server and the
 * memory, kept per second for the last three minutes. It costs two tiny ticker listeners and a timer, so it runs all
 * the time and a measurement can start from what already happened.
 */

import {SELF, ownerFromUrl, tagOwner} from "./owners.mjs";

/** Seconds of history. */
const HISTORY = 180;

/** Ticker priorities around every other listener. */
const FIRST = 1e6;
const LAST = -1e6;

/** Seconds between two latency pings. */
const PING_SECONDS = 20;

/** @type {object[]} Closed seconds, oldest first */
const buckets = [];

/** The second being filled. */
let current = null;

/** Frame start of the running frame and of the one before. */
let frameStart = 0;
let lastFrameStart = 0;

/** Ticker the listeners sit on. */
let ticker = null;

/** Long animation frames (Chromium) of the last minutes. */
const longFrames = [];

/** Latency samples (round trips in ms) and failed pings. */
const pings = [];
let pingFailures = 0;

/** Latest memory reading. */
let memory = null;

/** Who wants to hear about every closed second. */
const listeners = new Set();

/** Is the canvas drawing a scene right now? Set by the load monitor. */
let loading = false;

/** Short frame counts for tests that compare a few seconds with each other. */
const probes = new Set();

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * A new, empty second.
 * @param {number} second
 * @returns {object}
 */
export function emptyBucket(second) {
  return {second, frames: 0, interval: 0, maxInterval: 0, cpu: 0, maxCpu: 0, longMs: 0, longCount: 0,
    hidden: false, idle: true, loading: false};
}

/**
 * Sum up seconds into the numbers the diagnosis uses. Seconds while the tab was hidden, the canvas was idle or a
 * scene was loading do not count: the browser throttles hidden tabs, and loading is its own topic.
 * @param {object[]} seconds
 * @param {number} target    The frame rate the canvas aims for
 * @returns {object}
 */
export function summarize(seconds, target=60) {
  const valid = seconds.filter(b => !b.hidden && !b.idle && !b.loading);
  const frames = valid.reduce((sum, b) => sum + b.frames, 0);
  const result = {seconds: valid.length, frames, target, fps: null, fpsLow: null, frameMs: null, cpuMs: null,
    cpuShare: null, maxFrameMs: null, longMs: 0, longShare: 0, hiddenSeconds: seconds.filter(b => b.hidden).length};
  if ( !valid.length ) return result;
  const perSecond = valid.map(b => b.frames).sort((a, b) => a - b);
  result.fps = frames / valid.length;
  result.fpsLow = perSecond[Math.floor(perSecond.length * 0.1)];
  const interval = valid.reduce((sum, b) => sum + b.interval, 0);
  const cpu = valid.reduce((sum, b) => sum + b.cpu, 0);
  result.frameMs = frames ? interval / frames : null;
  result.cpuMs = frames ? cpu / frames : null;
  result.cpuShare = interval ? Math.min(1, cpu / interval) : null;
  result.maxFrameMs = Math.max(...valid.map(b => b.maxInterval));
  result.longMs = valid.reduce((sum, b) => sum + b.longMs, 0);
  result.longShare = result.longMs / (valid.length * 1000);
  return result;
}

/**
 * How a frame rate feels compared to the target: "good", "fair" or "poor".
 * @param {number|null} fps
 * @param {number} target
 * @returns {string}
 */
export function fpsRating(fps, target=60) {
  if ( !Number.isFinite(fps) ) return "none";
  const goal = Math.min(target || 60, 60);
  if ( (fps >= goal * 0.8) || (fps >= 45) ) return "good";
  if ( (fps >= goal * 0.45) && (fps >= 15) ) return "fair";
  return "poor";
}

/**
 * The scripts of a long animation frame, with their owner.
 * @param {PerformanceEntry} entry
 * @returns {object}
 */
export function readLongFrame(entry) {
  const scripts = Array.from(entry.scripts ?? []).map(s => ({
    owner: ownerFromUrl(s.sourceURL) ?? "unknown",
    url: s.sourceURL ?? "",
    fn: s.sourceFunctionName ?? "",
    invoker: s.invoker ?? "",
    type: s.invokerType ?? "",
    ms: s.duration ?? 0,
    layout: s.forcedStyleAndLayoutDuration ?? 0
  }));
  const render = entry.renderStart ? Math.max(0, (entry.startTime + entry.duration) - entry.renderStart) : 0;
  const layout = entry.styleAndLayoutStart ? Math.max(0, (entry.startTime + entry.duration) - entry.styleAndLayoutStart) : 0;
  return {start: entry.startTime, ms: entry.duration, blocking: entry.blockingDuration ?? 0, scripts, render, layout};
}

/* -------------------------------------------- */
/*  Frame sampling                              */
/* -------------------------------------------- */

function second() {
  return Math.floor(performance.now() / 1000);
}

function onFrameStart() {
  const now = performance.now();
  lastFrameStart = frameStart;
  frameStart = now;
}

function onFrameEnd() {
  const now = performance.now();
  const bucket = currentBucket();
  bucket.frames++;
  bucket.idle = false;
  const cpu = now - frameStart;
  bucket.cpu += cpu;
  bucket.maxCpu = Math.max(bucket.maxCpu, cpu);
  for ( const probe of probes ) {
    probe.frames++;
    probe.cpu += cpu;
  }
  if ( lastFrameStart ) {
    const interval = Math.min(frameStart - lastFrameStart, 10000);
    bucket.interval += interval;
    bucket.maxInterval = Math.max(bucket.maxInterval, interval);
  }
}

function currentBucket() {
  const s = second();
  if ( !current ) current = emptyBucket(s);
  else if ( current.second !== s ) closeBucket(s);
  return current;
}

/**
 * Close the running second and start the next. A second without frames while the canvas shows a scene and the tab
 * is visible is a frozen second, and it counts.
 * @param {number} next
 */
function closeBucket(next) {
  if ( current ) {
    const visible = !document.hidden;
    current.hidden ||= !visible;
    current.loading ||= loading;
    if ( !current.frames && visible && globalThis.canvas?.ready && ticker?.started && !current.loading ) current.idle = false;
    buckets.push(current);
    while ( buckets.length > HISTORY ) buckets.shift();
    // Seconds skipped entirely (a frame that took longer than a second) are frozen seconds too
    for ( let s = current.second + 1; s < next; s++ ) {
      const gap = emptyBucket(s);
      gap.idle = !(visible && globalThis.canvas?.ready);
      gap.loading = loading;
      buckets.push(gap);
    }
    while ( buckets.length > HISTORY ) buckets.shift();
  }
  current = emptyBucket(next);
  current.hidden = document.hidden;
  current.loading = loading;
  for ( const fn of listeners ) {
    try {
      fn();
    } catch(err) {
      console.error(err);
    }
  }
}

/**
 * Put the two listeners on the canvas ticker. Called when the canvas exists; safe to call again.
 */
export function attachTicker() {
  const app = globalThis.canvas?.app;
  if ( !app?.ticker || (ticker === app.ticker) ) return;
  detachTicker();
  ticker = app.ticker;
  tagOwner(onFrameStart, SELF);
  tagOwner(onFrameEnd, SELF);
  ticker.add(onFrameStart, null, FIRST);
  ticker.add(onFrameEnd, null, LAST);
}

function detachTicker() {
  if ( !ticker ) return;
  ticker.remove(onFrameStart, null);
  ticker.remove(onFrameEnd, null);
  ticker = null;
}

/* -------------------------------------------- */
/*  Observers                                   */
/* -------------------------------------------- */

let started = false;

/**
 * Start the observers and the clock. Runs once when the script loads, so long frames during startup are seen too.
 */
export function startMeter() {
  if ( started ) return;
  started = true;
  current = emptyBucket(second());
  setInterval(() => currentBucket(), 250);
  document.addEventListener("visibilitychange", () => {
    if ( document.hidden && current ) current.hidden = true;
  });
  observe("longtask", entry => {
    const bucket = currentBucket();
    bucket.longMs += entry.duration;
    bucket.longCount++;
  });
  observe("long-animation-frame", entry => {
    longFrames.push(readLongFrame(entry));
    const cutoff = performance.now() - (HISTORY * 1000);
    while ( longFrames.length && (longFrames[0].start < cutoff) ) longFrames.shift();
    if ( longFrames.length > 2000 ) longFrames.splice(0, longFrames.length - 2000);
  });
  setInterval(readMemory, 5000);
  readMemory();
}

/**
 * Observe a performance entry type, if the browser knows it.
 * @param {string} type
 * @param {(entry: PerformanceEntry) => void} fn
 * @returns {boolean}
 */
function observe(type, fn) {
  try {
    if ( !PerformanceObserver.supportedEntryTypes?.includes(type) ) return false;
    new PerformanceObserver(list => {
      for ( const entry of list.getEntries() ) fn(entry);
    }).observe({type, buffered: true});
    return true;
  } catch {
    return false;
  }
}

/** Does the browser report long animation frames with their scripts (Chromium 123 and newer)? */
export function supportsLongFrames() {
  return !!globalThis.PerformanceObserver?.supportedEntryTypes?.includes("long-animation-frame");
}

function readMemory() {
  const m = performance.memory;
  const textures = globalThis.foundry?.canvas?.TextureLoader?.approximateTotalMemoryUsage;
  memory = {
    used: m?.usedJSHeapSize ?? null,
    limit: m?.jsHeapSizeLimit ?? null,
    textures: Number.isFinite(textures) ? textures : null
  };
}

/* -------------------------------------------- */
/*  Latency                                     */
/* -------------------------------------------- */

/**
 * Ask the server for its time and measure how long the answer takes. The same request Foundry uses for its own
 * latency display, so it costs the server nothing new.
 * @param {number} [timeout=10000]
 * @returns {Promise<number|null>}  The round trip in ms, null when no answer came
 */
export function ping(timeout=10000) {
  const socket = globalThis.game?.socket;
  if ( !socket?.connected ) return Promise.resolve(null);
  return new Promise(resolve => {
    const start = performance.now();
    const timer = setTimeout(() => {
      pingFailures++;
      resolve(null);
    }, timeout);
    socket.emit("time", () => {
      clearTimeout(timer);
      const rtt = performance.now() - start;
      pings.push(rtt);
      while ( pings.length > 15 ) pings.shift();
      resolve(rtt);
    });
  });
}

/** Ping a few seconds after the start (the server is busy while a client loads), then every 20 seconds. */
export function startPings() {
  setTimeout(() => ping(), 5000);
  setInterval(() => {
    if ( !document.hidden ) ping();
  }, PING_SECONDS * 1000);
}

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * The frame rate the canvas aims for.
 * @returns {number}
 */
export function targetFps() {
  const max = globalThis.canvas?.app?.ticker?.maxFPS;
  return max > 0 ? Math.min(max, 60) : 60;
}

/**
 * The closed seconds of the last moments.
 * @param {number} [seconds=10]
 * @returns {object[]}
 */
export function recentSeconds(seconds=10) {
  return buckets.slice(-seconds);
}

/**
 * Frame numbers of the last seconds.
 * @param {number} [seconds=10]
 * @returns {object}
 */
export function frameStats(seconds=10) {
  return summarize(recentSeconds(seconds), targetFps());
}

/**
 * Frames per second of each of the last seconds, for the small graph. Null for seconds that do not count.
 * @param {number} [seconds=60]
 * @returns {(number|null)[]}
 */
export function fpsSeries(seconds=60) {
  const list = recentSeconds(seconds).map(b => ((b.hidden || b.idle || b.loading) ? null : b.frames));
  while ( list.length < seconds ) list.unshift(null);
  return list;
}

/**
 * The delay to the server.
 * @returns {{avg: number|null, last: number|null, samples: number, failures: number}}
 */
export function latency() {
  if ( !pings.length ) return {avg: null, last: null, samples: 0, failures: pingFailures};
  const sorted = [...pings].sort((a, b) => a - b);
  return {avg: sorted[Math.floor(sorted.length / 2)], last: pings.at(-1), samples: pings.length, failures: pingFailures};
}

/**
 * The latest memory reading.
 * @returns {{used: number|null, limit: number|null, textures: number|null}|null}
 */
export function memoryInfo() {
  return memory;
}

/**
 * Long animation frames since a moment.
 * @param {number} since   performance.now() timestamp
 * @returns {object[]}
 */
export function longFramesSince(since) {
  return longFrames.filter(f => f.start >= since);
}

/**
 * Hear about every closed second.
 * @param {Function} fn
 * @returns {() => void}
 */
export function onSecond(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Tell the meter that the canvas is loading a scene, so these seconds do not count as slow frames.
 * @param {boolean} value
 */
export function setLoading(value) {
  loading = !!value;
  if ( current ) current.loading ||= loading;
}

/** Is the meter on a ticker? */
export function isAttached() {
  return !!ticker;
}

/**
 * Count the frames of the next moments.
 * @param {number} ms
 * @returns {Promise<{fps: number, cpuMs: number|null, frames: number}>}
 */
export function measureFrames(ms) {
  return new Promise(resolve => {
    const probe = {frames: 0, cpu: 0, start: performance.now()};
    probes.add(probe);
    setTimeout(() => {
      probes.delete(probe);
      const elapsed = Math.max(1, performance.now() - probe.start);
      resolve({fps: (probe.frames * 1000) / elapsed, cpuMs: probe.frames ? probe.cpu / probe.frames : null,
        frames: probe.frames});
    }, ms);
  });
}

export const __test__ = {buckets, closeBucket: s => closeBucket(s)};
