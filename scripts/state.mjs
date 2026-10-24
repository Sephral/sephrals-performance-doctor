/**
 * What this client knows right now: the numbers of the meter, this computer, the connection and the viewed scene,
 * and the findings that follow from them. The window, the report to the GM and the hint for slow games all read it
 * from here, so they always agree.
 */

import {readEnvironment} from "./environment.mjs";
import {frameStats, latency, memoryInfo} from "./meter.mjs";
import {bandwidth} from "./network.mjs";
import {diagnoseClient} from "./rules.mjs";
import {checkScene} from "./scene-check.mjs";

/** The check of the viewed scene, by scene id. */
let viewed = null;
let viewedPromise = null;

/** Last test results of this client. */
export const results = {experiments: null, profile: null};

/**
 * The numbers the diagnosis of this client uses.
 * @param {number} [seconds=15]   Seconds of frames to look at
 * @returns {object}
 */
export function snapshot(seconds=15) {
  return {
    env: readEnvironment(),
    frames: frameStats(seconds),
    latency: latency(),
    bandwidth: bandwidth(),
    memory: memoryInfo(),
    scene: (viewed && (viewed.id === globalThis.canvas?.scene?.id)) ? viewed : null,
    canvas: !!globalThis.canvas?.initialized
  };
}

/**
 * The findings of this client.
 * @param {object} [snap]
 * @returns {object[]}
 */
export function clientFindings(snap=snapshot()) {
  return diagnoseClient(snap);
}

/**
 * Check the viewed scene in the background. Most of its files are in the cache already, so this rarely downloads
 * anything but a few header bytes.
 * @param {object} [options]
 * @param {boolean} [options.fresh=false]
 * @returns {Promise<object|null>}
 */
export function checkViewedScene({fresh=false}={}) {
  const scene = globalThis.canvas?.scene;
  if ( !scene ) return Promise.resolve(null);
  if ( !fresh && viewed && (viewed.id === scene.id) ) return Promise.resolve(viewed);
  if ( !fresh && viewedPromise?.sceneId === scene.id ) return viewedPromise;
  const promise = checkScene(scene, {fresh, includeSounds: false}).then(summary => {
    if ( globalThis.canvas?.scene?.id === summary.id ) viewed = summary;
    return summary;
  }).catch(err => {
    console.warn("sephrals-performance-doctor | Scene check failed", err);
    return null;
  }).finally(() => {
    if ( viewedPromise === promise ) viewedPromise = null;
  });
  promise.sceneId = scene.id;
  viewedPromise = promise;
  return promise;
}

/**
 * The check of the viewed scene, if done.
 * @returns {object|null}
 */
export function viewedScene() {
  return (viewed && (viewed.id === globalThis.canvas?.scene?.id)) ? viewed : null;
}

/** Forget the check of the viewed scene, for example after its files changed. */
export function forgetViewedScene() {
  viewed = null;
}
