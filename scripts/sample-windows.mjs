/**
 * Sample windows (api.samples, contract in samples.mjs): the window of the Performance Doctor, the guides and the
 * questions of the module with made-up numbers, so translators and testers see every result state without a slow
 * computer, a heavy map or a table full of players. Nothing here measures, changes a graphics setting, converts a file
 * or writes: the window reads the data of sample-data.mjs, every button that would act only says that it does nothing,
 * no usage counter counts.
 */

import {MODULE_ID, num, sampleOwners, t} from "./config.mjs";
import {PerformanceDoctor} from "./doctor-app.mjs";
import {guideContent, optimizeContent, optimizeResultContent, reloadContent} from "./dialogs.mjs";
import {loadoutsHint} from "./loadouts.mjs";
import {SlowGamePrompt} from "./prompt.mjs";
import {KINDS, SAMPLE_OWNERS, buildSample} from "./sample-data.mjs";
import {closeSample, markSample, openSampleHtml, sampleActions, sampleId, sampleText} from "./samples.mjs";

/** Actions of the window that only look: switch a tab, open a guide or a row, close the hint, open the settings. */
const LOOKING = ["pickTab", "guide", "toggleRow", "dismissBanner", "openSettings"];

/** The guides of the module. */
const GUIDES = ["accelChrome", "accelEdge", "accelOpera", "accelBrave", "accelFirefox", "accelSafari", "accelApp", "drivers",
  "browserUpdate", "gpuChoice", "power", "network"];

/** The window over made-up data. */
class SampleDoctor extends PerformanceDoctor {
  constructor(key, data) {
    super({id: sampleId(MODULE_ID, key), actions: sampleActions(PerformanceDoctor, LOOKING)});
    this.sample = data.sample;
    this.tab = data.tab;
    if ( data.sceneId ) this.sceneId = data.sceneId;
    if ( data.wizard ) this.wizard = data.wizard;
    markSample(this);
  }

  /** A sample has no measurement behind the assistant: nothing here starts one. */
  async startWizard() {
    return null;
  }
}

/** The texts of the data that follow the language. */
function dataText(key) {
  if ( key === "place" ) return sampleText("place");
  return t(`SPD.Sample.${key}`);
}

/** What the sample needs that only the window knows: texts and the shapes of the template. */
function prepare(kind) {
  const data = buildSample(kind, {text: dataText});
  const sample = data.sample;
  if ( data.busy?.experiments ) {
    data.busy = {...data.busy, experiments: t("SPD.Experiment.step", {step: 2, total: 5, name: t("SPD.Experiment.videos", {count: 2})})};
  }
  if ( sample.loadouts?.hint ) sample.loadouts = {hint: loadoutsHint("missing")};
  if ( sample.loadoutTest ) {
    const {names, before} = sample.loadoutTest;
    sample.loadoutTest = {loadoutId: "sample", text: t("SPD.Loadouts.running", {modules: names.join(", ")}),
      before: t("SPD.Loadouts.before", {total: num(before)})};
  }
  return data;
}

async function openDoctor(kind) {
  const key = kind;
  await closeSample(sampleId(MODULE_ID, key));
  for ( const [owner, title] of Object.entries(SAMPLE_OWNERS) ) sampleOwners.set(owner, title);
  const data = prepare(kind);
  const app = new SampleDoctor(key, data);
  if ( data.busy ) app.busy = data.busy;
  if ( data.banner ) app.banner = t("SPD.Banner.gmAsked", {name: data.banner.name});
  await app.render({force: true});
  return app;
}

/** The slow game hint over a made-up frame rate. */
class SampleHint extends SlowGamePrompt {
  constructor() {
    super({id: sampleId(MODULE_ID, "prompt"), actions: sampleActions(SlowGamePrompt, [])});
    this.fps = 14.2;
    markSample(this);
  }
}

async function openHint() {
  await closeSample(sampleId(MODULE_ID, "prompt"));
  const app = new SampleHint();
  await app.render({force: true});
  return app;
}

/** Sizes of the smaller copy that the question after the conversion shows. */
function madeSizes(smaller) {
  return {originalBytes: 44 * 1024 * 1024, bytes: smaller ? 6.2 * 1024 * 1024 : 46 * 1024 * 1024, originalWidth: 7600, originalHeight: 5200,
    width: smaller ? 6144 : 7600, height: smaller ? 4204 : 5200};
}

/**
 * The sample windows of the module (api.samples).
 * @returns {{id: string, label: string, group: string, open: () => Promise<object>}[]}
 */
export function sampleWindows() {
  const label = key => t(`SPD.Sample.entry.${key}`);
  const entries = KINDS.map(kind => {
    const group = kind.startsWith("assistant") ? "assistant" : kind.startsWith("player") ? "player" : "window";
    return {id: kind, group: t(`SPD.Sample.group.${group}`), label: label(kind), open: () => openDoctor(kind)};
  });
  const dialog = (id, title, body, width = 440) => entries.push({id, group: t("SPD.Sample.group.dialogs"), label: label(id),
    open: () => openSampleHtml({moduleId: MODULE_ID, id, title: typeof title === "function" ? title() : title, body, width})});
  dialog("reload", () => t("SPD.Reload.title"), () => `${reloadContent()}<p><button type="button">${t("SPD.Reload.now")}</button> `
    + `<button type="button">${t("SPD.Reload.later")}</button></p>`);
  dialog("optimize", () => t("SPD.Optimize.title"), () => `${optimizeContent("worlds/demo/maps/old-mill-day.png", 2)}<p>`
    + `<button type="button">${t("SPD.Optimize.make")}</button> <button type="button">${t("SPD.Optimize.cancel")}</button></p>`);
  dialog("optimize-result", () => t("SPD.Optimize.title"), () => `${optimizeResultContent(madeSizes(true), 3)}<p>`
    + `<button type="button">${t("SPD.Optimize.use")}</button> <button type="button">${t("SPD.Optimize.cancel")}</button></p>`);
  dialog("optimize-worse", () => t("SPD.Optimize.title"), () => `${optimizeResultContent(madeSizes(false), 1)}<p>`
    + `<button type="button">${t("SPD.Optimize.use")}</button> <button type="button">${t("SPD.Optimize.cancel")}</button></p>`);
  entries.push({id: "prompt", group: t("SPD.Sample.group.dialogs"), label: label("prompt"), open: openHint});
  for ( const id of GUIDES ) {
    entries.push({id: `guide-${id}`, group: t("SPD.Sample.group.guides"), label: t(`SPD.Guide.${id}.title`),
      open: () => openSampleHtml({moduleId: MODULE_ID, id: `guide-${id}`, title: t(`SPD.Guide.${id}.title`),
        body: () => `${guideContent(id)}<p><button type="button">${t("SPD.Guide.close")}</button></p>`, width: 460})});
  }
  return entries;
}
