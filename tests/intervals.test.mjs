import assert from "node:assert/strict";
import test from "node:test";
import {installAttribution, ownerOf, startTimingIntervals, stopTimingIntervals, tracksIntervals} from "../scripts/owners.mjs";
import {startTimer} from "./fixtures/modules/fake-mod/timer.mjs";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("repeating timers of packages are timed during a measurement only, and their id keeps working", async () => {
  installAttribution();
  assert.equal(tracksIntervals(), true);
  let calls = 0;
  const tick = function fakeTick() {
    calls++;
  };
  const id = startTimer(tick, 10);
  assert.equal(ownerOf(tick), "module:fake-mod");
  const timed = [];
  startTimingIntervals((record, self) => {
    timed.push(record.owner);
    return record.callback.apply(self, record.args);
  });
  await wait(60);
  stopTimingIntervals();
  const timedCount = timed.length;
  assert.ok(timedCount >= 2, `timed ${timedCount}`);
  assert.ok(timed.every(o => o === "module:fake-mod"));
  await wait(40);
  assert.equal(timed.length, timedCount, "no timing after the measurement");
  const before = calls;
  assert.ok(before > timedCount);
  clearInterval(id);
  await wait(40);
  assert.equal(calls, before, "clearInterval with the first id stops the restarted timer");
});

test("timers of Foundry or unknown code stay untouched", async () => {
  installAttribution();
  let calls = 0;
  const id = setInterval(() => calls++, 10);
  await wait(35);
  clearInterval(id);
  const n = calls;
  await wait(30);
  assert.equal(calls, n);
});
