/**
 * Downloads: what this browser fetched, from which package, and how fast its connection to the server is. The
 * browser reports every finished download (Resource Timing), the module only adds them up. Files from the browser
 * cache cost no download and do not count.
 */

import {resourceOwner} from "./owners.mjs";

/** Smallest download that tells something about the speed of the line. */
const MIN_SAMPLE_BYTES = 64 * 1024;

/** Downloads per owner. */
const byOwner = new Map();

/** Recent downloads, oldest first. */
const recent = [];

/** Samples for the speed estimate. */
const samples = [];

/** Result of the last speed test. */
let speedTest = null;

/** Files the module itself reads only partly (the first bytes of an image): their downloads say nothing. */
const partial = new Set();

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * Estimate the download speed from finished downloads. Downloads that overlap share the line, so they are merged
 * into busy stretches: the bytes of a stretch divided by its length. Stretches too small to fill the line are
 * left out.
 * @param {{start: number, end: number, bytes: number}[]} list
 * @param {object} [options]
 * @param {number} [options.minBytes=524288]   Smallest stretch that counts
 * @param {number} [options.minMs=150]         Shortest stretch that counts
 * @returns {{bytesPerSecond: number, stretches: number, bytes: number}|null}
 */
export function estimateBandwidth(list, {minBytes=512 * 1024, minMs=150}={}) {
  const sorted = list.filter(s => (s.end > s.start) && (s.bytes > 0)).sort((a, b) => a.start - b.start);
  const stretches = [];
  for ( const s of sorted ) {
    const last = stretches.at(-1);
    if ( last && (s.start <= last.end) ) {
      last.end = Math.max(last.end, s.end);
      last.bytes += s.bytes;
    }
    else stretches.push({start: s.start, end: s.end, bytes: s.bytes});
  }
  const usable = stretches.filter(s => (s.bytes >= minBytes) && ((s.end - s.start) >= minMs));
  if ( !usable.length ) return null;
  const bytes = usable.reduce((sum, s) => sum + s.bytes, 0);
  const ms = usable.reduce((sum, s) => sum + (s.end - s.start), 0);
  return {bytesPerSecond: (bytes / ms) * 1000, stretches: usable.length, bytes};
}

/**
 * Seconds a download of a size takes at a speed, with a second for setting up the connection.
 * @param {number} bytes
 * @param {number} bytesPerSecond
 * @returns {number|null}   Milliseconds
 */
export function downloadTime(bytes, bytesPerSecond) {
  if ( !(bytesPerSecond > 0) || !Number.isFinite(bytes) ) return null;
  return ((bytes / bytesPerSecond) * 1000) + (bytes > 0 ? 300 : 0);
}

/**
 * Read one Resource Timing entry.
 * @param {PerformanceResourceTiming} entry
 * @param {string} [routePrefix]
 * @returns {object}
 */
export function readEntry(entry, routePrefix="") {
  const bytes = entry.transferSize ?? 0;
  const size = entry.encodedBodySize ?? 0;
  return {
    url: entry.name,
    owner: resourceOwner(entry.name, routePrefix),
    type: entry.initiatorType,
    start: entry.startTime,
    responseStart: entry.responseStart || 0,
    end: entry.responseEnd || (entry.startTime + entry.duration),
    bytes,
    size,
    // A transfer of a few hundred bytes for a large body is a "not modified" answer: the file came from the cache
    cached: (bytes === 0) || ((size > 2048) && (bytes < 1024))
  };
}

/* -------------------------------------------- */
/*  Collecting                                  */
/* -------------------------------------------- */

let started = false;

/**
 * Start collecting downloads, including the ones since the page began to load. Runs once when the script loads.
 */
export function startNetwork() {
  if ( started ) return;
  started = true;
  try {
    performance.setResourceTimingBufferSize?.(5000);
  } catch {
    // Older browsers: the default buffer of 250 entries
  }
  try {
    new PerformanceObserver(list => {
      for ( const entry of list.getEntries() ) add(entry);
    }).observe({type: "resource", buffered: true});
  } catch {
    // No Resource Timing: the download numbers stay empty
  }
}

function routePrefix() {
  return String(globalThis.ROUTE_PREFIX ?? "").replace(/(^\/+)|(\/+$)/g, "");
}

/**
 * Add one finished download.
 * @param {PerformanceResourceTiming} entry
 */
function add(entry) {
  const item = readEntry(entry, routePrefix());
  if ( item.url.includes("/socket.io/") ) return;
  if ( (entry.responseStatus === 206) || partial.delete(item.url) ) return;
  const owner = byOwner.get(item.owner) ?? {requests: 0, bytes: 0, size: 0, cached: 0};
  owner.requests++;
  owner.size += item.size;
  if ( item.cached ) owner.cached++;
  else owner.bytes += item.bytes;
  byOwner.set(item.owner, owner);
  recent.push(item);
  if ( recent.length > 3000 ) recent.splice(0, recent.length - 3000);
  if ( !item.cached && (item.bytes >= MIN_SAMPLE_BYTES) && item.responseStart ) {
    samples.push({start: item.responseStart, end: item.end, bytes: item.bytes});
    if ( samples.length > 400 ) samples.splice(0, samples.length - 400);
  }
}

/**
 * Leave out the next download of a file: the module reads only its first bytes.
 * @param {string} src
 */
export function ignorePartial(src) {
  try {
    partial.add(new URL(src, globalThis.location?.href).href);
  } catch {
    // Not a URL: nothing will be downloaded either
  }
}

/**
 * Add the load of a large scene as a speed sample. Foundry downloads scene images in a worker, outside the page's
 * download list, so the load time of the whole scene stands in for them.
 * @param {number} bytes
 * @param {number} ms
 */
export function addLoadSample(bytes, ms) {
  const end = performance.now();
  samples.push({start: end - ms, end, bytes});
  if ( samples.length > 400 ) samples.splice(0, samples.length - 400);
}

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * Downloads per owner, largest first.
 * @returns {{owner: string, requests: number, bytes: number, size: number, cached: number}[]}
 */
export function downloadsByOwner() {
  return [...byOwner.entries()].map(([owner, v]) => ({owner, ...v})).sort((a, b) => b.bytes - a.bytes);
}

/**
 * Downloads that finished between two moments.
 * @param {number} from   performance.now() timestamp
 * @param {number} [to=Infinity]
 * @returns {object[]}
 */
export function downloadsBetween(from, to=Infinity) {
  return recent.filter(r => (r.end >= from) && (r.start <= to));
}

/**
 * The last download of a file, matched by its path.
 * @param {string} src
 * @returns {object|null}
 */
export function lastDownloadOf(src) {
  if ( !src ) return null;
  let target;
  try {
    target = new URL(src, globalThis.location?.href).href;
  } catch {
    return null;
  }
  for ( let i = recent.length - 1; i >= 0; i-- ) {
    const url = recent[i].url.split("#")[0];
    if ( (url === target) || (url.split("?")[0] === target.split("?")[0]) ) return recent[i];
  }
  return null;
}

/**
 * The download speed of this browser: the last speed test when it is recent, the estimate from downloads otherwise.
 * @returns {{bytesPerSecond: number, source: string}|null}
 */
export function bandwidth() {
  const fresh = speedTest && ((Date.now() - speedTest.at) < 30 * 60 * 1000);
  if ( fresh ) return {bytesPerSecond: speedTest.bytesPerSecond, source: "test"};
  const estimate = estimateBandwidth(samples);
  if ( estimate ) return {bytesPerSecond: estimate.bytesPerSecond, source: "estimate"};
  if ( speedTest ) return {bytesPerSecond: speedTest.bytesPerSecond, source: "test"};
  return null;
}

/**
 * Measure the download speed: fetch an image of Foundry (1.5 MB, not compressible) a few times without the cache.
 * @param {object} [options]
 * @param {number} [options.rounds=3]
 * @param {number} [options.maxMs=12000]    Stop after this long
 * @returns {Promise<{bytesPerSecond: number, bytes: number, ms: number}|null>}
 */
export async function runSpeedTest({rounds=3, maxMs=12000}={}) {
  const path = "canvas/tokens/rings-steel.webp";
  const base = globalThis.foundry?.utils?.getRoute?.(path) ?? `/${path}`;
  let bytes = 0;
  let ms = 0;
  const begin = performance.now();
  for ( let i = 0; i < rounds; i++ ) {
    if ( (performance.now() - begin) > maxMs ) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, maxMs - (performance.now() - begin)));
    try {
      const response = await fetch(`${base}?spd=${Date.now()}${i}`, {cache: "no-store", signal: controller.signal});
      if ( !response.ok || !response.body ) break;
      const reader = response.body.getReader();
      const start = performance.now();
      let got = 0;
      for ( ;; ) {
        const {done, value} = await reader.read();
        if ( done ) break;
        got += value.byteLength;
      }
      bytes += got;
      ms += performance.now() - start;
    } catch {
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  if ( !bytes || !ms ) return null;
  speedTest = {bytesPerSecond: (bytes / ms) * 1000, bytes, ms, at: Date.now()};
  return speedTest;
}

/** The last speed test, if any. */
export function lastSpeedTest() {
  return speedTest;
}

export const __test__ = {add, samples, recent, byOwner};
