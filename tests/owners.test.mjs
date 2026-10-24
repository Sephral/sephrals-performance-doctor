import assert from "node:assert/strict";
import test from "node:test";
import {SELF, ownerFromStack, ownerFromUrl, resourceOwner, stackUrls, urlPath} from "../scripts/owners.mjs";

test("the path of a URL leaves out origin, query and hash", () => {
  assert.equal(urlPath("http://localhost:30000/modules/a%20b/x.mjs?v=1#y"), "/modules/a b/x.mjs");
  assert.equal(urlPath("modules/foo/bar.js?x"), "modules/foo/bar.js");
});

test("files belong to modules, systems, worlds or Foundry", () => {
  assert.equal(ownerFromUrl("http://localhost:30000/modules/dice-so-nice/main.js"), "module:dice-so-nice");
  assert.equal(ownerFromUrl("https://example.com/foundry/systems/dnd5e/dnd5e.mjs"), "system:dnd5e");
  assert.equal(ownerFromUrl("http://localhost/worlds/test/scripts/macro.js"), "world");
  assert.equal(ownerFromUrl("http://localhost:30000/scripts/foundry.mjs"), "core");
  assert.equal(ownerFromUrl("chrome-extension://abc/content.js"), "extension");
  assert.equal(ownerFromUrl("https://assets.forge-vtt.com/bazaar/modules/jb2a/1.0.0/scripts/x.js"), "module:jb2a");
  assert.equal(ownerFromUrl(""), null);
});

test("downloads outside Foundry's folders and packages are content", () => {
  globalThis.location = {origin: "http://localhost:30000", href: "http://localhost:30000/game"};
  assert.equal(resourceOwner("http://localhost:30000/scripts/vendor.mjs"), "core");
  assert.equal(resourceOwner("http://localhost:30000/icons/svg/mystery-man.svg"), "core");
  assert.equal(resourceOwner("http://localhost:30000/maps/dragon-lair.webp"), "content");
  assert.equal(resourceOwner("http://localhost:30000/worlds/test/assets/scenes/a.webp"), "content");
  assert.equal(resourceOwner("http://localhost:30000/modules/jb2a/x.webm"), "module:jb2a");
  assert.equal(resourceOwner("http://localhost:30000/vtt/scripts/foundry.mjs", "vtt"), "core");
  assert.equal(resourceOwner("https://s3.amazonaws.com/bucket/icons/x.png"), "content");
});

test("stack traces of Chromium and Firefox give their URLs", () => {
  const chrome = `Error
    at captureOwner (http://h/modules/sephrals-performance-doctor/scripts/owners.mjs:120:5)
    at http://h/modules/foo/foo.mjs:3:7
    at Array.forEach (<anonymous>)
    at Hooks.callAll (http://h/scripts/foundry.mjs:100:20)`;
  assert.deepEqual(stackUrls(chrome), ["http://h/modules/sephrals-performance-doctor/scripts/owners.mjs",
    "http://h/modules/foo/foo.mjs", "http://h/scripts/foundry.mjs"]);
  const firefox = "captureOwner@http://h/modules/x/a.mjs:1:2\n@http://h/systems/dnd5e/dnd5e.mjs:5:6\n";
  assert.deepEqual(stackUrls(firefox), ["http://h/modules/x/a.mjs", "http://h/systems/dnd5e/dnd5e.mjs"]);
});

test("the owner is the innermost package after the attribution's own frames", () => {
  const stack = `Error
    at captureOwner (http://h/modules/sephrals-performance-doctor/scripts/owners.mjs:1:1)
    at tagOwner (http://h/modules/sephrals-performance-doctor/scripts/owners.mjs:2:1)
    at Hooks.on (http://h/modules/sephrals-performance-doctor/scripts/owners.mjs:3:1)
    at Hooks.once (http://h/scripts/foundry.mjs:9:9)
    at http://h/modules/lights/lights.mjs:4:4
    at http://h/systems/dnd5e/dnd5e.mjs:5:5`;
  assert.equal(ownerFromStack(stack, 3), "module:lights");
  // A registration of the module itself
  const own = stack.replace("http://h/modules/lights/lights.mjs", "http://h/modules/sephrals-performance-doctor/scripts/spd.mjs");
  assert.equal(ownerFromStack(own, 3), SELF);
  // Only Foundry
  assert.equal(ownerFromStack("Error\n    at a (http://h/scripts/foundry.mjs:1:1)", 0), "core");
});
