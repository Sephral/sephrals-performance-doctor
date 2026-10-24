import assert from "node:assert/strict";
import test from "node:test";
import {emptyBucket, fpsRating, readLongFrame, summarize} from "../scripts/meter.mjs";

/**
 * A second with frames.
 * @param {number} frames
 * @param {number} cpuPerFrame
 * @param {object} [extra]
 * @returns {object}
 */
function second(frames, cpuPerFrame, extra={}) {
  return {...emptyBucket(0), frames, interval: frames ? 1000 : 0, cpu: frames * cpuPerFrame, maxInterval: frames ? 1000 / frames : 0,
    idle: false, ...extra};
}

test("frames per second and the share of scripts", () => {
  const stats = summarize([second(60, 2), second(58, 2), second(62, 2)], 60);
  assert.equal(stats.seconds, 3);
  assert.equal(Math.round(stats.fps), 60);
  assert.ok(Math.abs(stats.cpuShare - 0.12) < 0.001);
  assert.equal(stats.fpsLow, 58);
});

test("hidden, idle and loading seconds do not count", () => {
  const stats = summarize([second(60, 1), second(2, 1, {hidden: true}), second(0, 0, {idle: true}),
    second(3, 1, {loading: true})], 60);
  assert.equal(stats.seconds, 1);
  assert.equal(stats.fps, 60);
  assert.equal(stats.hiddenSeconds, 1);
});

test("a frozen second counts with no frames", () => {
  const stats = summarize([second(4, 10), second(0, 0)], 60);
  assert.equal(stats.fps, 2);
  assert.equal(stats.fpsLow, 0);
});

test("nothing to summarize", () => {
  const stats = summarize([], 60);
  assert.equal(stats.fps, null);
  assert.equal(stats.seconds, 0);
});

test("long tasks give a blocked share", () => {
  const stats = summarize([second(30, 5, {longMs: 300}), second(30, 5, {longMs: 100})], 60);
  assert.ok(Math.abs(stats.longShare - 0.2) < 0.001);
});

test("ratings of frame rates", () => {
  assert.equal(fpsRating(59, 60), "good");
  assert.equal(fpsRating(29, 30), "good");
  assert.equal(fpsRating(30, 60), "fair");
  assert.equal(fpsRating(12, 60), "poor");
  assert.equal(fpsRating(5, 60), "poor");
  assert.equal(fpsRating(null, 60), "none");
});

test("long animation frames give their scripts and owners", () => {
  const frame = readLongFrame({startTime: 100, duration: 120, blockingDuration: 70, renderStart: 200,
    styleAndLayoutStart: 210, scripts: [{sourceURL: "http://h/modules/heavy/x.js", sourceFunctionName: "tick",
      invoker: "TimerHandler:setInterval", invokerType: "user-callback", duration: 90, forcedStyleAndLayoutDuration: 3}]});
  assert.equal(frame.ms, 120);
  assert.equal(frame.render, 20);
  assert.equal(frame.layout, 10);
  assert.deepEqual(frame.scripts[0], {owner: "module:heavy", url: "http://h/modules/heavy/x.js", fn: "tick",
    invoker: "TimerHandler:setInterval", type: "user-callback", ms: 90, layout: 3});
});
