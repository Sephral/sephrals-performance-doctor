import assert from "node:assert/strict";
import test from "node:test";
import {downloadTime, estimateBandwidth, readEntry} from "../scripts/network.mjs";

const MB = 1024 * 1024;

test("one large download gives the speed of the line", () => {
  const r = estimateBandwidth([{start: 0, end: 2000, bytes: 4 * MB}]);
  assert.equal(Math.round(r.bytesPerSecond), 2 * MB);
  assert.equal(r.stretches, 1);
});

test("downloads that overlap share the line", () => {
  // Two files of 2 MB at the same time over 2 seconds: the line carries 2 MB per second
  const r = estimateBandwidth([{start: 0, end: 2000, bytes: 2 * MB}, {start: 0, end: 2000, bytes: 2 * MB}]);
  assert.equal(Math.round(r.bytesPerSecond), 2 * MB);
});

test("small or short stretches are left out", () => {
  assert.equal(estimateBandwidth([{start: 0, end: 50, bytes: 100 * 1024}]), null);
  assert.equal(estimateBandwidth([{start: 0, end: 100, bytes: 4 * MB}]), null);
  const r = estimateBandwidth([{start: 0, end: 50, bytes: 100 * 1024}, {start: 5000, end: 6000, bytes: MB}]);
  assert.equal(Math.round(r.bytesPerSecond), MB);
});

test("download time with a moment to connect", () => {
  assert.equal(downloadTime(10 * MB, 2 * MB), 5300);
  assert.equal(downloadTime(10, 0), null);
});

test("a download from the cache costs nothing", () => {
  const base = {name: "http://h/maps/a.webp", initiatorType: "img", startTime: 1, responseStart: 5, responseEnd: 9, duration: 8};
  assert.equal(readEntry({...base, transferSize: 0, encodedBodySize: 5000}).cached, true);
  assert.equal(readEntry({...base, transferSize: 300, encodedBodySize: 5 * MB}).cached, true);
  const fresh = readEntry({...base, transferSize: 5 * MB + 300, encodedBodySize: 5 * MB});
  assert.equal(fresh.cached, false);
  assert.equal(fresh.owner, "content");
});
