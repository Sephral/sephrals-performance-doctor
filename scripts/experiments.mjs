/**
 * The graphics test: switch one kind of effect off for a few seconds, count the frames, switch it on again. The
 * difference shows what costs the most on this computer. Every step is undone before the next starts, also when
 * something fails. Nothing here touches the fog of war or what a player may see of the map.
 */

import {measureFrames} from "./meter.mjs";

/** Milliseconds to wait after a change before counting, and to count. */
const SETTLE_MS = 700;
const MEASURE_MS = 2500;

/** Display objects to walk at most when looking for filters and videos. */
const MAX_NODES = 30000;

/**
 * Walk the display tree of the canvas, leaving out the visibility group (fog of war).
 * @param {(obj: PIXI.DisplayObject) => void} fn
 */
function walk(fn) {
  const root = globalThis.canvas?.stage;
  if ( !root ) return;
  const skip = globalThis.canvas.visibility;
  const queue = [root];
  let count = 0;
  while ( queue.length && (count++ < MAX_NODES) ) {
    const obj = queue.pop();
    if ( !obj || (obj === skip) ) continue;
    fn(obj);
    if ( obj.children?.length ) queue.push(...obj.children);
  }
}

/**
 * The filter classes Foundry and PIXI ship. Filters of any other class come from modules.
 * @returns {Set<Function>}
 */
function coreFilterClasses() {
  const classes = new Set();
  const add = ns => {
    for ( const value of Object.values(ns ?? {}) ) if ( typeof value === "function" ) classes.add(value);
  };
  add(globalThis.foundry?.canvas?.rendering?.filters);
  add(globalThis.PIXI?.filters);
  for ( const name of ["Filter", "AlphaFilter", "BlurFilter", "BlurFilterPass", "ColorMatrixFilter", "FXAAFilter",
    "NoiseFilter", "DisplacementFilter", "SpriteMaskFilter"] ) {
    if ( globalThis.PIXI?.[name] ) classes.add(globalThis.PIXI[name]);
  }
  return classes;
}

/**
 * Filters of modules on the canvas.
 * @returns {{obj: PIXI.DisplayObject, filters: PIXI.Filter[]}[]}
 */
export function findModuleFilters() {
  const core = coreFilterClasses();
  const found = [];
  walk(obj => {
    const filters = obj.filters;
    if ( !Array.isArray(filters) || !filters.length ) return;
    if ( filters.some(f => f && !core.has(f.constructor)) ) found.push({obj, filters});
  });
  return found;
}

/**
 * The names of the module filters on the canvas, with their count.
 * @returns {{name: string, count: number}[]}
 */
export function moduleFilterNames() {
  const core = coreFilterClasses();
  const counts = new Map();
  for ( const {filters} of findModuleFilters() ) {
    for ( const f of filters ) {
      if ( !f || core.has(f.constructor) ) continue;
      const name = f.constructor?.name || "Filter";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([name, count]) => ({name, count})).sort((a, b) => b.count - a.count);
}

/**
 * Videos playing on the canvas.
 * @returns {HTMLVideoElement[]}
 */
export function findVideos() {
  const videos = new Set();
  walk(obj => {
    const source = obj.texture?.baseTexture?.resource?.source;
    if ( (typeof HTMLVideoElement !== "undefined") && (source instanceof HTMLVideoElement) ) videos.add(source);
  });
  return [...videos];
}

/**
 * The tests that make sense on this canvas. Each switches something off and returns how to switch it on again.
 * @returns {{id: string, apply: () => (() => void)}[]}
 */
export function availableExperiments() {
  const c = globalThis.canvas;
  if ( !c?.ready ) return [];
  const list = [];
  if ( c.effects ) {
    list.push({id: "animations", apply: () => {
      c.effects.deactivateAnimation?.();
      return () => c.effects.activateAnimation?.();
    }});
  }
  const videos = findVideos().filter(v => !v.paused);
  if ( videos.length ) {
    list.push({id: "videos", count: videos.length, apply: () => {
      for ( const v of videos ) v.pause();
      return () => {
        for ( const v of videos ) v.play?.().catch(() => {});
      };
    }});
  }
  // The weather layer always holds two containers; it shows weather when one of them has an effect in it
  const weather = [c.weather, c.fxmaster].filter(l => l?.visible && (l.children ?? []).some(ch => ch.children?.length));
  if ( weather.length ) {
    list.push({id: "weather", apply: () => {
      for ( const layer of weather ) layer.visible = false;
      return () => {
        for ( const layer of weather ) layer.visible = true;
      };
    }});
  }
  const filtered = findModuleFilters();
  if ( filtered.length ) {
    list.push({id: "filters", count: filtered.length, apply: () => {
      const core = coreFilterClasses();
      const saved = filtered.map(({obj, filters}) => ({obj, filters}));
      for ( const {obj, filters} of saved ) {
        const kept = filters.filter(f => f && core.has(f.constructor));
        obj.filters = kept.length ? kept : null;
      }
      return () => {
        for ( const {obj, filters} of saved ) {
          if ( !obj.destroyed ) obj.filters = filters;
        }
      };
    }});
  }
  if ( c.effects ) {
    list.push({id: "lighting", apply: () => {
      const was = c.effects.visible;
      c.effects.visible = false;
      return () => {
        c.effects.visible = was;
      };
    }});
  }
  return list;
}

/** Is a test running? */
let running = false;

/**
 * Run the graphics test.
 * @param {object} [options]
 * @param {(step: {id: string, index: number, total: number}) => void} [options.onStep]
 * @returns {Promise<{baseline: object, results: object[]}|null>}  null without a canvas
 */
export async function runExperiments({onStep}={}) {
  if ( running ) return null;
  const experiments = availableExperiments();
  if ( !experiments.length ) return null;
  running = true;
  try {
    const total = experiments.length + 1;
    onStep?.({id: "baseline", index: 0, total});
    await wait(SETTLE_MS);
    const baseline = await measureFrames(MEASURE_MS);
    const results = [];
    for ( const [i, experiment] of experiments.entries() ) {
      onStep?.({id: experiment.id, index: i + 1, total});
      if ( !globalThis.canvas?.ready ) break;
      let restore = null;
      try {
        restore = experiment.apply();
        await wait(SETTLE_MS);
        const measured = await measureFrames(MEASURE_MS);
        results.push({id: experiment.id, count: experiment.count ?? null, ...measured,
          gain: baseline.fps ? (measured.fps - baseline.fps) / baseline.fps : 0});
      } finally {
        try {
          restore?.();
        } catch(err) {
          console.error(err);
        }
      }
    }
    return {baseline, results, at: Date.now()};
  } finally {
    running = false;
  }
}

/**
 * The strongest effect of a test result, if it made a real difference (at least 25 % more frames).
 * @param {{results: object[]}} result
 * @returns {object|null}
 */
export function strongestEffect(result) {
  const best = [...(result?.results ?? [])].sort((a, b) => b.gain - a.gain)[0];
  return best && (best.gain >= 0.25) ? best : null;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
