/**
 * The window of the Performance Doctor. Tabs: Overview (status, findings, the "make it faster" assistant), This
 * computer, Scene, Modules, and for GMs Players and World. Live numbers update every second without redrawing the
 * window, everything else redraws when it changes.
 */

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

import {
  MODULE_ID, TEMPLATES, formatBytes, formatDuration, formatSpeed, isShown, num, ownerName, setting, t
} from "./config.mjs";
import {bindCopy, confirmReload, optimizeFlow, showGuide} from "./dialogs.mjs";
import {runExperiments, strongestEffect, moduleFilterNames} from "./experiments.mjs";
import {PRESETS, applyPreset, applySettings, currentValues, madeChanges, undoChanges} from "./fixes.mjs";
import {copiesOf, restoreOriginal} from "./image-tools.mjs";
import {loadoutsHint, loadoutsState, runningTest, switchBack, testChoices, testWithout} from "./loadouts.mjs";
import {fpsRating, fpsSeries, frameStats, latency, measureFrames, memoryInfo, onSecond, supportsLongFrames} from "./meter.mjs";
import {bandwidth, downloadsByOwner, downloadTime, lastSpeedTest, runSpeedTest} from "./network.mjs";
import {SELF} from "./owners.mjs";
import {abortProfile, armStartupProfile, isProfiling, profile} from "./profiler.mjs";
import {MODES, diagnoseProfile, sortFindings, suggestedSettings} from "./rules.mjs";
import {canOptimize, checkScene, diagnoseScene, fileName} from "./scene-check.mjs";
import {checkViewedScene, clientFindings, forgetViewedScene, results, snapshot} from "./state.mjs";
import {
  askToCheck, diagnoseTable, issueTitle, playerCapabilities, playerMessages, recentLoads, tableRows, tellGM, watchPlayers
} from "./table.mjs";
import {countFeature, markUsed} from "./usage.mjs";
import {checkWorld, documentOf} from "./world-check.mjs";

/** Tabs, and which need GM rights. */
const TABS = [
  {id: "overview", icon: "fa-solid fa-heart-pulse"},
  {id: "pc", icon: "fa-solid fa-display"},
  {id: "scene", icon: "fa-solid fa-map"},
  {id: "modules", icon: "fa-solid fa-puzzle-piece"},
  {id: "players", icon: "fa-solid fa-users", gm: true},
  {id: "world", icon: "fa-solid fa-earth-europe", gm: true}
];

/** Icons and classes by severity. */
const SEVERITY = {
  3: {css: "bad", icon: "fa-solid fa-circle-exclamation"},
  2: {css: "warn", icon: "fa-solid fa-triangle-exclamation"},
  1: {css: "hint", icon: "fa-solid fa-lightbulb"},
  0: {css: "good", icon: "fa-solid fa-circle-check"}
};

/** Seconds the assistant measures. */
const WIZARD_SECONDS = 10;

/** Last results that outlive the window, per client. */
const memory = {scenes: new Map(), world: null, speed: null};

export class PerformanceDoctor extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "spd-doctor",
    classes: ["spd", "spd-doctor"],
    window: {title: "SPD.Title", icon: "fa-solid fa-stethoscope", resizable: false},
    position: {width: 580, height: "auto"},
    actions: {
      pickTab: PerformanceDoctor.#onPickTab,
      fix: PerformanceDoctor.#onFix,
      guide: PerformanceDoctor.#onGuide,
      run: PerformanceDoctor.#onRun,
      preset: PerformanceDoctor.#onPreset,
      undo: PerformanceDoctor.#onUndo,
      tellGM: PerformanceDoctor.#onTellGM,
      wizard: PerformanceDoctor.#onWizard,
      optimize: PerformanceDoctor.#onOptimize,
      restore: PerformanceDoctor.#onRestore,
      ask: PerformanceDoctor.#onAsk,
      openDocument: PerformanceDoctor.#onOpenDocument,
      dismissBanner: PerformanceDoctor.#onDismissBanner,
      toggleRow: PerformanceDoctor.#onToggleRow,
      testWithout: PerformanceDoctor.#onTestWithout,
      loadoutBack: PerformanceDoctor.#onLoadoutBack,
      openSettings: PerformanceDoctor.#onOpenSettings
    }
  };

  /** @override */
  static PARTS = {
    body: {
      template: `${TEMPLATES}/doctor.hbs`,
      templates: ["overview", "pc", "scene", "modules", "players", "world", "finding"].map(p => `${TEMPLATES}/${p}.hbs`),
      scrollable: [".spd-scroll"]
    }
  };

  /** The open tab. */
  tab = "overview";

  /** The scene of the Scene tab (GM), null for the viewed scene. */
  sceneId = null;

  /** A line on top, for example when the GM asked to check. */
  banner = null;

  /** Running tasks with their progress. */
  busy = {};

  /** Rows of a result table that are open. */
  openRows = new Set();

  /** Modules ticked for a test without them, and the measurement the ticks belong to. */
  withoutIds = new Set();
  #withoutFor = null;

  /** Share of the time the scripts used in the shown measurement, in percent. */
  #profileShare = null;

  /** The assistant: stage and numbers. */
  wizard = {stage: "idle"};

  /** Fingerprint of what the last full render showed, so the regular refresh only redraws on changes. */
  #shown = "";

  #offSecond = null;
  #tick = 0;

  /** @override */
  get title() {
    return t("SPD.Title");
  }

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    // A gear in the title bar opens the module's settings, players have settings of their own too
    const close = frame.querySelector(".window-header [data-action=close]");
    if ( close ) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "header-control icon fa-solid fa-gear";
      button.dataset.action = "openSettings";
      button.dataset.tooltip = t("SPD.Action.settings");
      button.setAttribute("aria-label", t("SPD.Action.settings"));
      close.before(button);
    }
    return frame;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const gm = game.user.isGM;
    if ( !gm && TABS.find(x => x.id === this.tab)?.gm ) this.tab = "overview";
    const snap = snapshot();
    const findings = clientFindings(snap);
    context.tabs = TABS.filter(x => !x.gm || gm).map(x => ({...x, label: t(`SPD.Tab.${x.id}`), active: this.tab === x.id}));
    context.tab = Object.fromEntries(TABS.map(x => [x.id, this.tab === x.id]));
    context.banner = this.banner;
    context.status = this.#status(snap, findings);
    context.live = this.#liveValues(snap);
    context.gm = gm;
    context.busy = this.busy;
    switch ( this.tab ) {
      case "overview": Object.assign(context, this.#overview(snap, findings)); break;
      case "pc": Object.assign(context, this.#pc(snap)); break;
      case "scene": Object.assign(context, await this.#scene(snap)); break;
      case "modules": Object.assign(context, this.#modules()); break;
      case "players": Object.assign(context, this.#players()); break;
      case "world": Object.assign(context, this.#world()); break;
    }
    this.#shown = this.#fingerprint(findings);
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.dataset.spdTheme = setting("theme");
    this.#drawSparkline();
    bindCopy(this.element);
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", event => this.#onChange(event));
    this.#offSecond = onSecond(() => this.#everySecond());
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#offSecond?.();
    this.#offSecond = null;
    if ( this.busy.profile ) abortProfile();
  }

  /* -------------------------------------------- */
  /*  Status and live values                      */
  /* -------------------------------------------- */

  #status(snap, findings) {
    const frames = snap.frames;
    const gpu = snap.env.gpu;
    const rating = fpsRating(frames.fps, frames.target);
    const fps = Number.isFinite(frames.fps) ? Math.round(frames.fps) : null;
    let key = "waiting";
    let css = "none";
    if ( gpu.software ) {
      key = "noAcceleration";
      css = "bad";
    }
    else if ( !snap.canvas || snap.env.settings.noCanvas ) key = "noCanvas";
    else if ( frames.seconds < 5 ) key = frames.hiddenSeconds >= 5 ? "hidden" : "waiting";
    else {
      key = {good: "smooth", fair: "fair", poor: "slow"}[rating] ?? "waiting";
      css = {good: "good", fair: "warn", poor: "bad"}[rating] ?? "none";
    }
    const serious = findings.filter(f => f.severity >= 2 && (f.id !== "slowGpu") && (f.id !== "slowCpu")).length;
    return {css, title: t(`SPD.Status.${key}.title`, {fps: fps ?? "–", target: frames.target}),
      text: t(`SPD.Status.${key}.text`, {fps: fps ?? "–", target: frames.target}),
      more: serious ? t("SPD.Status.more", {count: serious}) : ""};
  }

  #liveValues(snap) {
    const frames = snap.frames;
    const lat = snap.latency;
    const bw = snap.bandwidth;
    return {
      fps: Number.isFinite(frames.fps) ? num(frames.fps, frames.fps < 10 ? 1 : 0) : "–",
      fpsCss: {good: "good", fair: "warn", poor: "bad"}[fpsRating(frames.fps, frames.target)] ?? "",
      latency: lat.avg ? `${Math.round(lat.avg)} ms` : "–",
      latencyCss: !lat.avg ? "" : (lat.avg >= 1000 ? "bad" : (lat.avg >= 300 ? "warn" : "good")),
      speed: bw ? formatSpeed(bw.bytesPerSecond) : "–",
      speedCss: !bw ? "" : (bw.bytesPerSecond < 0.625e6 ? "bad" : (bw.bytesPerSecond < 1.5e6 ? "warn" : "good")),
      cpu: Number.isFinite(frames.cpuMs) ? `${num(frames.cpuMs, 1)} ms` : "–"
    };
  }

  /** Update the live numbers and the graph; redraw when the findings changed. */
  #everySecond() {
    if ( !this.rendered ) return;
    const snap = snapshot(15);
    const live = this.#liveValues(snap);
    for ( const [key, value] of Object.entries(live) ) {
      if ( key.endsWith("Css") ) continue;
      const el = this.element.querySelector(`[data-live="${key}"]`);
      if ( !el ) continue;
      el.textContent = value;
      const css = live[`${key}Css`];
      if ( css !== undefined ) el.closest(".spd-live-item")?.setAttribute("data-state", css);
    }
    this.#drawSparkline();
    if ( this.wizard.stage === "measuring" || this.wizard.stage === "verifying" ) return;
    if ( (++this.#tick % 4) !== 0 ) return;
    if ( Object.values(this.busy).some(Boolean) ) return;
    if ( !["overview", "pc", "players"].includes(this.tab) ) return;
    if ( this.element.contains(document.activeElement) && document.activeElement.matches("select, input") ) return;
    if ( this.#fingerprint(clientFindings(snap)) !== this.#shown ) this.render();
  }

  #fingerprint(findings) {
    const status = fpsRating(frameStats(15).fps, 60);
    const base = findings.map(f => `${f.id}:${f.severity}`).join("|") + status;
    // A running load changes the print every few seconds, so its time keeps counting
    if ( this.tab === "players" ) return base + JSON.stringify(tableRows().map(r => [r.id, r.report?.fps, r.report?.rating,
      r.report?.latency, r.load?.phase, r.load?.phase === "loading" ? Math.floor((Date.now() - r.load.startedAt) / 4000) : r.load?.ms]));
    return base;
  }

  #drawSparkline() {
    const svg = this.element?.querySelector(".spd-spark");
    if ( !svg ) return;
    const series = fpsSeries(60);
    const max = Math.max(60, ...series.filter(v => v !== null));
    const w = 120;
    const h = 28;
    const points = [];
    series.forEach((v, i) => {
      if ( v === null ) return;
      points.push(`${((i / (series.length - 1)) * w).toFixed(1)},${(h - 2 - ((v / max) * (h - 4))).toFixed(1)}`);
    });
    const line = svg.querySelector("polyline");
    if ( line ) line.setAttribute("points", points.join(" "));
  }

  /* -------------------------------------------- */
  /*  Findings                                    */
  /* -------------------------------------------- */

  /**
   * Values of a finding as its texts show them.
   * @param {object} data
   * @returns {object}
   */
  static formatData(data) {
    const out = {};
    for ( const [key, value] of Object.entries(data ?? {}) ) {
      if ( value === null || value === undefined ) out[key] = "–";
      else if ( ["bytes", "used", "limit", "map", "size"].includes(key) ) out[key] = formatBytes(value);
      else if ( ["ms", "time", "typical"].includes(key) ) out[key] = formatDuration(value);
      else if ( key === "speed" ) out[key] = formatSpeed(value);
      else if ( key === "owner" ) out[key] = ownerName(value);
      else if ( key === "issue" ) out[key] = issueTitle({id: value});
      else if ( key === "collection" ) out[key] = t(`SPD.World.collection.${value}`);
      else out[key] = value;
    }
    return out;
  }

  /**
   * A finding ready for the template.
   * @param {object} f
   * @param {number} index   Position in the list the buttons refer to
   * @param {string} list    Name of that list
   * @returns {object}
   */
  #viewFinding(f, index, list) {
    const data = PerformanceDoctor.formatData(f.data);
    const sev = SEVERITY[f.severity] ?? SEVERITY[1];
    const key = `SPD.Finding.${f.id}`;
    return {
      ...sev,
      id: f.id,
      title: t(`${key}.title`, data),
      text: game.i18n.has(`${key}.text`) ? t(`${key}.text`, data) : "",
      buttons: f.fixes.map((fix, i) => this.#viewFix(fix, `${list}:${index}:${i}`)).filter(Boolean)
    };
  }

  #viewFix(fix, ref) {
    const gm = game.user.isGM;
    switch ( fix.kind ) {
      case "setting": return {action: "fix", ref, icon: "fa-solid fa-wand-magic-sparkles", primary: true,
        label: t(`SPD.Fix.setting.${fix.key}.${String(fix.value)}`), hint: fix.reload ? t("SPD.Fix.needsReload") : ""};
      case "guide": return {action: "guide", ref, icon: "fa-solid fa-list-check", label: t(`SPD.Guide.${fix.guide}.button`)};
      case "action": {
        if ( ["modulesManage", "exportChat", "flushChat", "optimizeAll"].includes(fix.action) && !gm ) return null;
        if ( (fix.action === "experiments") && !globalThis.canvas?.ready ) return null;
        return {action: "run", ref, icon: ACTION_ICONS[fix.action] ?? "fa-solid fa-play", label: t(`SPD.Action.${fix.action}`)};
      }
      case "tellGM": {
        if ( gm ) return null;
        const online = game.users.some(u => u.active && u.isGM);
        return {action: "tellGM", ref, icon: "fa-solid fa-paper-plane", label: t("SPD.Action.tellGM"), disabled: !online,
          hint: online ? "" : t("SPD.Action.noGM")};
      }
      case "optimize": return gm ? {action: "optimize", ref, src: fix.src, icon: "fa-solid fa-wand-magic-sparkles", primary: true,
        label: t("SPD.Action.optimize")} : null;
      case "openDocument": return {action: "openDocument", ref, collection: fix.collection, id: fix.id,
        icon: "fa-solid fa-up-right-from-square", label: t("SPD.Action.openDocument")};
    }
    return null;
  }

  /** The finding lists the buttons of the last render refer to. */
  lists = {};

  #findingRef(ref) {
    const [list, index, fixIndex] = String(ref).split(":");
    const f = this.lists[list]?.[Number(index)];
    return {finding: f, fix: f?.fixes?.[Number(fixIndex)]};
  }

  #showFindings(list, name, {skipGood=true}={}) {
    const shown = skipGood ? list.filter(f => f.severity > 0) : list;
    this.lists[name] = shown;
    return shown.map((f, i) => this.#viewFinding(f, i, name));
  }

  /* -------------------------------------------- */
  /*  Tabs                                        */
  /* -------------------------------------------- */

  #overview(snap, findings) {
    const shown = findings.filter(f => !["framesGood"].includes(f.id));
    const context = {findings: this.#showFindings(shown, "client"), wizard: this.#wizardView(snap)};
    context.allGood = !shown.some(f => f.severity >= 1) && (snap.frames.seconds >= 5);
    if ( game.user.isGM ) {
      const rows = tableRows().filter(r => !r.self);
      const troubled = rows.filter(r => r.report?.issues?.some(i => i.severity >= 2) || (r.load?.phase === "loading"));
      context.tableLine = rows.length ? t(troubled.length ? "SPD.Overview.playersTrouble" : "SPD.Overview.playersFine",
        {count: troubled.length, total: rows.length}) : t("SPD.Overview.noPlayers");
      context.tableTrouble = troubled.length > 0;
    }
    return context;
  }

  #wizardView(snap) {
    const w = this.wizard;
    const view = {stage: w.stage, [w.stage]: true, progress: Math.round((w.progress ?? 0) * 100)};
    if ( w.stage === "proposal" ) {
      view.items = w.proposal.map((p, i) => ({...p, index: i, label: t(`SPD.Fix.setting.${p.key}.${String(p.value)}`),
        why: t(`SPD.Finding.${p.finding}.title`, PerformanceDoctor.formatData(w.findings.find(f => f.id === p.finding)?.data))}));
      view.baseline = w.baseline ? num(w.baseline.fps, 1) : "–";
      const other = w.findings.filter(f => !f.fixes.some(x => x.kind === "setting") && (f.severity >= 2)
        && !["slowGpu", "slowCpu"].includes(f.id));
      view.urgent = this.#showFindings(other.filter(f => f.severity >= 3), "wizardUrgent");
      view.other = this.#showFindings(other.filter(f => f.severity < 3), "wizard");
      view.nothing = !view.items.length;
    }
    if ( w.stage === "result" ) {
      const before = w.baseline?.fps ?? 0;
      const after = w.after?.fps ?? 0;
      view.before = num(before, 1);
      view.after = num(after, 1);
      view.gain = before ? Math.round(((after - before) / before) * 100) : 0;
      view.better = after > (before * 1.15);
      view.still = fpsRating(after, frameStats(5).target) !== "good";
      view.canUndo = madeChanges().length > 0;
    }
    return view;
  }

  #pc(snap) {
    const env = snap.env;
    const gpu = env.gpu;
    const values = currentValues();
    const modes = [MODES.LOW, MODES.MED, MODES.HIGH, MODES.MAX];
    const modeLabels = {0: "SETTINGS.PerformanceModeLow", 1: "SETTINGS.PerformanceModeMed", 2: "SETTINGS.PerformanceModeHigh",
      3: "SETTINGS.PerformanceModeMax"};
    const toggle = key => ({key, label: t(`SPD.PC.setting.${key}`), hint: t(`SPD.PC.settingHint.${key}`), toggle: true,
      on: !!values[key]});
    const mem = memoryInfo();
    const experiments = results.experiments;
    const best = strongestEffect(experiments);
    return {
      gpu: {name: gpu.name || t("SPD.PC.unknown"), kind: t(`SPD.PC.kind.${gpu.kind}`), kindCss: gpu.software ? "bad" : "",
        maxTexture: gpu.maxTexture ? `${gpu.maxTexture} px` : "–", webgl: gpu.webgl2 ? "WebGL 2" : "WebGL 1",
        raw: gpu.renderer},
      device: [
        {label: t("SPD.PC.browser"), value: `${env.browser.name} ${env.browser.version}`.trim()},
        {label: t("SPD.PC.os"), value: env.os || "–"},
        {label: t("SPD.PC.screen"), value: `${env.screen.width} × ${env.screen.height}`
          + (env.screen.dpr !== 1 ? ` · ${t("SPD.PC.scale", {scale: num(env.screen.dpr * 100)})}` : "")},
        {label: t("SPD.PC.canvas"), value: env.canvasPixels ? t("SPD.PC.megapixels", {mp: num(env.canvasPixels / 1e6, 1)}) : "–"},
        {label: t("SPD.PC.cores"), value: env.cores ?? "–"},
        {label: t("SPD.PC.memory"), value: mem?.used ? `${formatBytes(mem.used)} / ${formatBytes(mem.limit)}` : "–"},
        {label: t("SPD.PC.textures"), value: mem?.textures ? formatBytes(mem.textures) : "–"}
      ],
      settings: [
        {key: "performanceMode", label: t("SPD.PC.setting.performanceMode"), hint: t("SPD.PC.settingHint.performanceMode"),
          select: true, options: modes.map(m => ({value: m, label: t(modeLabels[m]), selected: values.performanceMode === m}))},
        {key: "maxFPS", label: t("SPD.PC.setting.maxFPS"), hint: t("SPD.PC.settingHint.maxFPS"), select: true,
          options: [10, 20, 30, 40, 50, 60].map(v => ({value: v, label: String(v), selected: values.maxFPS === v}))},
        toggle("pixelRatioResolutionScaling"),
        toggle("lightAnimation"),
        toggle("visionAnimation"),
        toggle("mipmap")
      ],
      presets: Object.keys(PRESETS).map(id => ({id, label: t(`SPD.Preset.${id}.name`), hint: t(`SPD.Preset.${id}.hint`)})),
      changes: madeChanges().map(c => t(`SPD.PC.setting.${c.key}`)).join(", "),
      experiments: experiments ? {
        baseline: num(experiments.baseline.fps, 1),
        rows: experiments.results.map(r => ({label: t(`SPD.Experiment.${r.id}`, {count: r.count ?? ""}), fps: num(r.fps, 1),
          gain: Math.round(r.gain * 100), better: r.gain >= 0.25})),
        verdict: best ? t(`SPD.Experiment.verdict.${best.id}`, {gain: Math.round(best.gain * 100)}) : t("SPD.Experiment.verdict.none"),
        filters: moduleFilterNames().slice(0, 6).map(f => `${f.name} (${f.count})`).join(", ")
      } : null,
      canExperiment: !!globalThis.canvas?.ready,
      speed: lastSpeedTest() ? {value: formatSpeed(lastSpeedTest().bytesPerSecond),
        map: formatDuration(downloadTime(50 * 1024 * 1024, lastSpeedTest().bytesPerSecond))} : null,
      bandwidthEstimate: (snap.bandwidth?.source === "estimate") ? formatSpeed(snap.bandwidth.bytesPerSecond) : null
    };
  }

  async #scene(snap) {
    const gm = game.user.isGM;
    const scene = (gm && this.sceneId ? game.scenes.get(this.sceneId) : null) ?? globalThis.canvas?.scene ?? null;
    const context = {sceneChoices: gm ? game.scenes.contents.sort((a, b) => a.name.localeCompare(b.name)).map(s => ({
      id: s.id, name: s.navName || s.name, selected: s.id === scene?.id, active: s.active})) : null};
    if ( !scene ) return {...context, noScene: true};
    context.sceneName = scene.navName || scene.name;
    let summary = memory.scenes.get(scene.id);
    // A check that failed is not repeated on its own, only by "Check again"
    if ( !summary && (this.#failedScene === scene.id) && !this.busy.scene ) return {...context, failed: true};
    if ( !summary && !this.busy.scene ) {
      this.busy.scene = true;
      this.#runScene(scene);
    }
    if ( !summary ) return {...context, checking: true};
    const bw = snap.bandwidth;
    const players = gm ? playerCapabilities() : [];
    const findings = gm ? diagnoseScene(summary, {players}) : sortFindings(clientFindings(snap).filter(f => f.area === "scene"));
    context.result = {
      bytes: formatBytes(summary.totalBytes),
      unknown: summary.unknown,
      mine: bw ? formatDuration(downloadTime(summary.totalBytes, bw.bytesPerSecond)) : null,
      times: [6, 16, 50, 100].map(mbit => ({label: `${mbit} Mbit/s`,
        time: formatDuration(downloadTime(summary.totalBytes, (mbit * 1e6) / 8))})),
      largest: summary.largestSide ? `${num(summary.largestSide)} px` : "–",
      gpu: formatBytes(summary.gpuMemory),
      counts: Object.entries(summary.counts).filter(([k]) => k !== "levels" || summary.counts.levels > 1)
        .map(([k, v]) => ({label: t(`SPD.Scene.count.${k}`), value: v})),
      dims: summary.width ? `${num(summary.width)} × ${num(summary.height)} px` : "",
      age: Math.round((Date.now() - summary.at) / 1000)
    };
    context.findings = this.#showFindings(findings, "scene");
    if ( gm ) {
      const copies = copiesOf(scene);
      context.assets = summary.assets.filter(a => !a.audio).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, 40)
        .map(a => ({
          src: a.src,
          name: fileName(a.src),
          roles: [...a.roles].map(r => t(`SPD.Scene.role.${r}`)).join(", "),
          uses: a.uses,
          multi: a.uses > 1,
          bytes: a.bytes === null ? "?" : formatBytes(a.bytes),
          px: a.width ? `${a.width} × ${a.height}` : "–",
          heavy: ((a.bytes ?? 0) >= 15 * 1024 * 1024) || (Math.max(a.width ?? 0, a.height ?? 0) >= 8192),
          optimize: canOptimize(a) && (((a.bytes ?? 0) >= 2 * 1024 * 1024) || (Math.max(a.width ?? 0, a.height ?? 0) > 4096)),
          copy: copies.some(c => c.to === a.src),
          error: a.error
        }));
      context.sounds = summary.soundBytes ? formatBytes(summary.soundBytes) : null;
      context.loads = recentLoads(scene.id).slice(0, 12).map(l => this.#viewLoad(l));
    }
    return context;
  }

  /** The scene whose last check failed. */
  #failedScene = null;

  async #runScene(scene, fresh=false) {
    try {
      const summary = await checkScene(scene, {fresh});
      memory.scenes.set(scene.id, summary);
      this.#failedScene = null;
      if ( scene.id === globalThis.canvas?.scene?.id ) {
        forgetViewedScene();
        checkViewedScene();
      }
    } catch(err) {
      console.error(err);
      this.#failedScene = scene.id;
      ui.notifications.error(t("SPD.Scene.failed"));
    } finally {
      this.busy.scene = false;
      if ( this.rendered ) this.render();
    }
  }

  #viewLoad(l) {
    const user = game.users.get(l.userId);
    return {name: user?.name ?? "?", scene: l.sceneName, phase: l.phase, loading: l.phase === "loading",
      failed: l.phase === "failed", time: l.ms !== null && l.ms !== undefined ? formatDuration(l.ms)
        : formatDuration(Date.now() - l.startedAt), bytes: l.bytes ? formatBytes(l.bytes) : "",
      speed: l.speed ? formatSpeed(l.speed) : "", slow: (l.ms ?? (Date.now() - l.startedAt)) >= setting("slowLoadSeconds") * 1000,
      files: (l.failed ?? []).join(", ") || l.error || ""};
  }

  #modules() {
    const profileResult = results.profile;
    const context = {measuring: this.busy.profile ? Math.max(1, Math.round(this.busy.profile * 100)) : null,
      longFrames: supportsLongFrames()};
    const canSwitch = game.user.isGM && game.user.can("SETTINGS_MODIFY");
    const test = canSwitch && (loadoutsState() === "ready") ? runningTest() : null;
    if ( test ) {
      context.loadoutTest = {...test, before: test.before === null ? "" : t("SPD.Loadouts.before", {total: num(test.before)})};
    }
    if ( profileResult ) {
      const rows = profileResult.rows.filter(r => r.ms > 0.5);
      const top = rows.slice(0, 14);
      const max = Math.max(1, ...top.map(r => r.msPerSecond));
      this.#profileShare = rows.reduce((s, r) => s + r.msPerSecond, 0) / 10;
      context.profile = {
        seconds: Math.round(profileResult.durationMs / 1000),
        rows: top.map(r => ({
          owner: r.owner,
          name: ownerName(r.owner),
          self: r.owner === SELF,
          core: r.owner === "core",
          perSecond: num(r.msPerSecond, r.msPerSecond < 10 ? 1 : 0),
          share: num(Math.min(100, r.msPerSecond / 10), 1),
          bar: Math.max(2, Math.round((r.msPerSecond / max) * 100)),
          css: r.owner === SELF ? "self" : (r.msPerSecond >= 250 ? "bad" : (r.msPerSecond >= 100 ? "warn" : "")),
          slowest: r.maxMs >= 1 ? `${num(r.maxMs, 0)} ms` : "",
          open: this.openRows.has(r.owner),
          kinds: Object.entries(r.kinds).filter(([, ms]) => ms > 0.5).sort((a, b) => b[1] - a[1])
            .map(([k, ms]) => `${t(`SPD.Modules.kind.${k}`)} ${num(ms / (profileResult.durationMs / 1000), 1)} ms/s`).join(" · "),
          labels: r.labels.slice(0, 6).map(l => ({label: l.label, kind: t(`SPD.Modules.kind.${l.kind}`), calls: l.calls,
            perSecond: num(l.msPerSecond, 1)}))
        })),
        total: num(this.#profileShare, 0)
      };
      const moduleFindings = diagnoseProfile(profileResult.rows, {self: SELF});
      context.findings = this.#showFindings(moduleFindings, "modules");
      if ( game.user.isGM ) context.loadouts = this.#loadoutsView(profileResult, top, moduleFindings, canSwitch);
    }
    context.downloads = downloadsByOwner().filter(d => d.bytes > 0).slice(0, 8).map(d => ({name: ownerName(d.owner),
      bytes: formatBytes(d.bytes), requests: d.requests}));
    const startup = setting("startupReport");
    if ( startup?.rows ) {
      const p = startup.phases ?? {};
      const seg = (a, b) => ((p[a] !== null) && (p[b] !== null) && (p[b] >= p[a])) ? formatDuration(p[b] - p[a]) : "–";
      context.startup = {
        when: new Date(startup.at).toLocaleString(),
        total: p.done ? formatDuration(p.done) : (p.ready ? formatDuration(p.ready) : "–"),
        phases: [
          {label: t("SPD.Startup.phase.scripts"), time: p.scripts ? formatDuration(p.scripts) : "–"},
          {label: t("SPD.Startup.phase.world"), time: seg("scripts", "init")},
          {label: t("SPD.Startup.phase.init"), time: seg("init", "setup")},
          {label: t("SPD.Startup.phase.canvas"), time: seg("setup", "ready")},
          {label: t("SPD.Startup.phase.ready"), time: seg("ready", "done")}
        ],
        rows: startup.rows.filter(r => (r.owner !== "core") && (r.owner !== SELF) && (r.ms >= 20)).slice(0, 10)
          .map(r => ({name: ownerName(r.owner), time: formatDuration(r.ms), css: r.ms >= 1000 ? "bad" : (r.ms >= 300 ? "warn" : "")})),
        downloads: (startup.downloads ?? []).filter(d => d.bytes > 512 * 1024).slice(0, 6)
          .map(d => ({name: ownerName(d.owner), bytes: formatBytes(d.bytes)}))
      };
    }
    context.gmOnlyHint = !game.user.isGM;
    return context;
  }

  /**
   * Below the measurement, for the GM: the modules to switch off for a test with Module Loadouts, or a quiet hint to
   * it when a module costs too much and Module Loadouts is missing or too old.
   * @param {object} profileResult
   * @param {object[]} rows          The rows the table shows
   * @param {object[]} findings      Findings of the measurement
   * @param {boolean} canSwitch      May this user switch modules?
   * @returns {object|null}
   */
  #loadoutsView(profileResult, rows, findings, canSwitch) {
    const flagged = findings.map(f => f.data?.owner).filter(owner => String(owner ?? "").startsWith("module:"));
    const state = loadoutsState();
    if ( state !== "ready" ) return flagged.length ? {hint: loadoutsHint(state)} : null;
    if ( !canSwitch ) return null;
    const choices = testChoices(rows, flagged, id => !!game.modules.get(id)?.active);
    if ( !choices.length ) return null;
    // A new measurement ticks its own modules with a finding
    if ( this.#withoutFor !== profileResult ) {
      this.#withoutFor = profileResult;
      this.withoutIds = new Set(choices.filter(c => c.flagged).map(c => c.id));
    }
    return {
      choices: choices.map(c => ({id: c.id, name: ownerName(c.owner), on: this.withoutIds.has(c.id),
        perSecond: num(c.msPerSecond, c.msPerSecond < 10 ? 1 : 0)})),
      any: choices.some(c => this.withoutIds.has(c.id))
    };
  }

  #players() {
    const rows = tableRows();
    const view = rows.map(r => {
      const rep = r.report;
      const issue = rep?.issues?.[0];
      return {
        id: r.id, name: r.name, color: r.color, self: r.self, gm: r.isGM,
        fps: Number.isFinite(rep?.fps) && (rep?.fps !== null) ? num(rep.fps, rep.fps < 10 ? 1 : 0) : "–",
        fpsCss: {good: "good", fair: "warn", poor: "bad"}[rep?.rating] ?? "",
        latency: rep?.latency ? `${rep.latency} ms` : "–",
        latencyCss: !rep?.latency ? "" : (rep.latency >= 1000 ? "bad" : (rep.latency >= 300 ? "warn" : "")),
        speed: rep?.speed ? formatSpeed(rep.speed) : "–",
        speedCss: !rep?.speed ? "" : (rep.speed < 0.625e6 ? "bad" : (rep.speed < 1.5e6 ? "warn" : "")),
        gpu: rep ? (rep.gpu.software ? t("SPD.Players.software") : (rep.gpu.name || "?")) : "",
        gpuCss: rep?.gpu.software ? "bad" : "",
        browser: rep?.browser ?? "",
        load: r.load ? this.#viewLoad(r.load) : null,
        issue: issue ? issueTitle(issue) : (rep ? t("SPD.Players.noIssue") : t(r.self ? "SPD.Players.you" : "SPD.Players.noReport")),
        issueCss: issue ? (SEVERITY[issue.severity]?.css ?? "") : "",
        stale: (r.age ?? 0) > 90,
        hidden: !!rep?.hidden,
        canAsk: !r.self
      };
    });
    const findings = diagnoseTable(rows);
    return {
      rows: view,
      findings: this.#showFindings(findings, "table"),
      loads: recentLoads().slice(0, 10).map(l => this.#viewLoad(l)),
      messages: playerMessages().slice(0, 8).map(m => ({name: m.name, issue: issueTitle(m.finding),
        time: new Date(m.at).toLocaleTimeString()})),
      alone: rows.filter(r => !r.self).length === 0
    };
  }

  #world() {
    const w = memory.world;
    if ( !w ) return {worldIdle: !this.busy.world};
    const disk = w.disk ?? {};
    return {
      worldResult: {
        total: formatBytes(w.total),
        rows: w.collections.filter(c => c.bytes > 0).map(c => ({label: t(`SPD.World.collection.${c.key}`),
          count: c.count ?? "", bytes: formatBytes(c.bytes),
          disk: disk[c.key] ? formatBytes(disk[c.key]) : ""})),
        largest: w.largest.slice(0, 8).map(d => ({name: d.name, kind: t(`SPD.World.collection.${d.collection}`),
          bytes: formatBytes(d.bytes), collection: d.collection, id: d.id, images: d.embedded})),
        fog: disk.fog ? formatBytes(disk.fog) : null,
        modules: w.activeModules,
        packs: w.packs,
        messages: w.messages
      },
      findings: this.#showFindings(w.findings, "world")
    };
  }

  /* -------------------------------------------- */
  /*  Assistant                                   */
  /* -------------------------------------------- */

  async #measure(stage) {
    this.wizard = {...this.wizard, stage, progress: 0};
    this.render();
    const total = WIZARD_SECONDS * 1000;
    const start = performance.now();
    const timer = setInterval(() => {
      this.wizard.progress = Math.min(1, (performance.now() - start) / total);
      const bar = this.element?.querySelector(".spd-wizard .spd-progress > span");
      if ( bar ) bar.style.width = `${Math.round(this.wizard.progress * 100)}%`;
    }, 250);
    try {
      return await measureFrames(total);
    } finally {
      clearInterval(timer);
    }
  }

  async startWizard() {
    if ( !globalThis.canvas?.ready ) {
      ui.notifications.warn(t("SPD.Wizard.noCanvas"));
      return;
    }
    countFeature(MODULE_ID, "wizardRun");
    const baseline = await this.#measure("measuring");
    const snap = snapshot(WIZARD_SECONDS);
    snap.frames = {...snap.frames, fps: baseline.fps, seconds: Math.max(snap.frames.seconds, 5)};
    const findings = clientFindings(snap);
    this.wizard = {stage: "proposal", baseline, findings, proposal: suggestedSettings(findings).map(p => ({...p, on: true}))};
    this.render();
  }

  async applyWizard() {
    const chosen = this.wizard.proposal.filter(p => p.on);
    if ( !chosen.length ) return;
    const wished = Object.fromEntries(chosen.map(p => [p.key, p.value]));
    const {changed, reload} = await applySettings(wished);
    countFeature(MODULE_ID, "fixApply");
    if ( reload ) {
      await game.settings.set(MODULE_ID, "wizard", {stage: "verify", baseline: this.wizard.baseline, at: Date.now(),
        applied: changed.map(c => c.key)});
      this.wizard = {stage: "reload", baseline: this.wizard.baseline};
      this.render();
      return;
    }
    await this.verifyWizard(this.wizard.baseline);
  }

  /**
   * Measure after the changes and compare.
   * @param {object} baseline
   */
  async verifyWizard(baseline) {
    await waitForCanvas();
    const after = await this.#measure("verifying");
    this.wizard = {stage: "result", baseline, after};
    this.render();
  }

  /* -------------------------------------------- */
  /*  Events                                      */
  /* -------------------------------------------- */

  async #onChange(event) {
    const el = event.target;
    if ( el.name === "spd-scene" ) {
      this.sceneId = el.value;
      this.render();
      return;
    }
    if ( el.dataset.setting ) {
      const key = el.dataset.setting;
      const value = el.type === "checkbox" ? el.checked : Number(el.value);
      const {reload} = await applySettings({[key]: value});
      if ( reload ) await confirmReload();
      this.render();
      return;
    }
    if ( el.dataset.proposal !== undefined ) {
      const item = this.wizard.proposal?.[Number(el.dataset.proposal)];
      if ( item ) item.on = el.checked;
    }
    if ( el.name === "spd-without" ) {
      if ( el.checked ) this.withoutIds.add(el.value);
      else this.withoutIds.delete(el.value);
      const button = this.element.querySelector("[data-action=testWithout]");
      if ( button ) button.disabled = !this.withoutIds.size;
    }
  }

  static #onPickTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  static async #onFix(event, target) {
    const {fix} = this.#findingRef(target.dataset.ref);
    if ( !fix ) return;
    const {reload} = await applySettings({[fix.key]: fix.value});
    countFeature(MODULE_ID, "fixApply");
    ui.notifications.info(t("SPD.Fix.applied"));
    if ( reload ) await confirmReload();
    this.render();
  }

  static async #onGuide(event, target) {
    const {fix} = this.#findingRef(target.dataset.ref);
    if ( fix?.guide ) await showGuide(fix.guide);
  }

  static async #onRun(event, target) {
    const ref = target.dataset.ref ? this.#findingRef(target.dataset.ref).fix?.action : null;
    const action = ref ?? target.dataset.task;
    await this.runTask(action);
  }

  /**
   * Run one of the tasks of the window.
   * @param {string} action
   */
  async runTask(action) {
    switch ( action ) {
      case "profile": return this.#runProfile();
      case "experiments": return this.#runExperiments();
      case "speedTest": return this.#runSpeed();
      case "wizard": {
        this.tab = "overview";
        return this.startWizard();
      }
      case "reload": return confirmReload();
      case "modulesManage": return new foundry.applications.sidebar.apps.ModuleManagement().render({force: true});
      case "exportChat": return game.messages.export();
      case "flushChat": {
        await game.messages.flush();
        memory.world = null;
        return this.render();
      }
      case "optimizeAll":
      case "openScene": {
        this.tab = "scene";
        return this.render();
      }
      case "rescan": {
        const scene = (this.sceneId ? game.scenes.get(this.sceneId) : null) ?? globalThis.canvas?.scene;
        if ( !scene ) return;
        memory.scenes.delete(scene.id);
        this.busy.scene = true;
        this.render();
        return this.#runScene(scene, true);
      }
      case "world": return this.#runWorld();
      case "startup": {
        armStartupProfile();
        countFeature(MODULE_ID, "startupProfile");
        return confirmReload();
      }
      case "watch": {
        watchPlayers(120);
        ui.notifications.info(t("SPD.Players.watching"));
        return;
      }
      case "askAll": {
        for ( const u of game.users.filter(x => x.active && (x.id !== game.user.id)) ) askToCheck(u.id);
        ui.notifications.info(t("SPD.Players.askedAll"));
        return;
      }
      case "wizardApply": return this.applyWizard();
      case "wizardReload": return confirmReload();
      case "wizardUndo": {
        const {reload} = await undoChanges();
        countFeature(MODULE_ID, "fixUndo");
        this.wizard = {stage: "idle"};
        if ( reload ) await confirmReload();
        return this.render();
      }
      case "wizardDone": {
        this.wizard = {stage: "idle"};
        return this.render();
      }
      case "wizardAgain": return this.startWizard();
    }
  }

  async #runProfile() {
    if ( isProfiling() ) return;
    countFeature(MODULE_ID, "moduleProfile");
    this.tab = "modules";
    this.busy.profile = 0.001;
    this.render();
    try {
      results.profile = await profile({seconds: 15, onProgress: p => {
        this.busy.profile = Math.max(0.001, p);
        const bar = this.element?.querySelector(".spd-modules .spd-progress > span");
        if ( bar ) bar.style.width = `${Math.round(p * 100)}%`;
      }});
    } catch(err) {
      console.error(err);
    } finally {
      this.busy.profile = null;
      if ( this.rendered ) this.render();
    }
  }

  async #runExperiments() {
    countFeature(MODULE_ID, "graphicsTest");
    this.tab = "pc";
    this.busy.experiments = t("SPD.Experiment.starting");
    this.render();
    try {
      results.experiments = await runExperiments({onStep: step => {
        this.busy.experiments = t("SPD.Experiment.step", {step: step.index + 1, total: step.total,
          name: t(`SPD.Experiment.${step.id}`, {count: ""})});
        const el = this.element?.querySelector("[data-busy='experiments']");
        if ( el ) el.textContent = this.busy.experiments;
      }});
    } finally {
      this.busy.experiments = null;
      if ( this.rendered ) this.render();
    }
  }

  async #runSpeed() {
    this.tab = "pc";
    this.busy.speed = true;
    this.render();
    try {
      const result = await runSpeedTest();
      if ( !result ) ui.notifications.warn(t("SPD.PC.speedFailed"));
    } finally {
      this.busy.speed = false;
      if ( this.rendered ) this.render();
    }
  }

  async #runWorld() {
    countFeature(MODULE_ID, "worldCheck");
    this.busy.world = true;
    this.render();
    try {
      memory.world = await checkWorld();
    } catch(err) {
      console.error(err);
      ui.notifications.error(t("SPD.World.failed"));
    } finally {
      this.busy.world = false;
      if ( this.rendered ) this.render();
    }
  }

  static async #onPreset(event, target) {
    const {reload} = await applyPreset(target.dataset.preset);
    countFeature(MODULE_ID, "fixApply");
    ui.notifications.info(t("SPD.Preset.applied", {name: t(`SPD.Preset.${target.dataset.preset}.name`)}));
    if ( reload ) await confirmReload();
    this.render();
  }

  static async #onUndo() {
    const {reload} = await undoChanges();
    countFeature(MODULE_ID, "fixUndo");
    ui.notifications.info(t("SPD.PC.undone"));
    if ( reload ) await confirmReload();
    this.render();
  }

  static #onTellGM(event, target) {
    const {finding: f} = this.#findingRef(target.dataset.ref);
    if ( !f ) return;
    if ( tellGM(f) ) {
      ui.notifications.info(t("SPD.Action.told"));
      target.disabled = true;
    }
    else ui.notifications.warn(t("SPD.Action.noGM"));
  }

  static async #onWizard(event, target) {
    await this.runTask(target.dataset.step);
  }

  static async #onOptimize(event, target) {
    const scene = (this.sceneId ? game.scenes.get(this.sceneId) : null) ?? globalThis.canvas?.scene;
    const src = target.dataset.src;
    if ( !scene || !src ) return;
    this.busy.optimize = true;
    try {
      const done = await optimizeFlow(src, scene);
      if ( done ) {
        countFeature(MODULE_ID, "webpCopy");
        memory.scenes.delete(scene.id);
        this.busy.scene = true;
        this.#runScene(scene, true);
      }
    } finally {
      this.busy.optimize = false;
      this.render();
    }
  }

  static async #onRestore(event, target) {
    const scene = (this.sceneId ? game.scenes.get(this.sceneId) : null) ?? globalThis.canvas?.scene;
    if ( !scene ) return;
    await restoreOriginal(scene, target.dataset.src);
    ui.notifications.info(t("SPD.Scene.restored"));
    memory.scenes.delete(scene.id);
    this.busy.scene = true;
    this.#runScene(scene, true);
  }

  static #onAsk(event, target) {
    askToCheck(target.dataset.user);
    ui.notifications.info(t("SPD.Players.asked", {name: game.users.get(target.dataset.user)?.name ?? "?"}));
  }

  static #onOpenDocument(event, target) {
    const doc = documentOf(target.dataset.collection, target.dataset.id);
    if ( doc?.sheet ) doc.sheet.render(true);
    else if ( doc ) ui.notifications.info(doc.name ?? doc.id);
  }

  static #onDismissBanner() {
    this.banner = null;
    this.render();
  }

  static #onToggleRow(event, target) {
    const key = target.dataset.row;
    if ( this.openRows.has(key) ) this.openRows.delete(key);
    else this.openRows.add(key);
    this.render();
  }

  static async #onTestWithout(event, target) {
    const ids = [...this.withoutIds].filter(id => game.modules.get(id)?.active);
    if ( !ids.length ) return;
    target.disabled = true;
    try {
      if ( await testWithout(ids, {before: this.#profileShare}) ) countFeature(MODULE_ID, "loadoutTest");
    } finally {
      if ( this.rendered ) this.render();
    }
  }

  static async #onLoadoutBack(event, target) {
    target.disabled = true;
    try {
      await switchBack(target.dataset.loadout);
    } finally {
      if ( this.rendered ) this.render();
    }
  }

  static async #onOpenSettings() {
    const sheet = game.settings.sheet;
    await sheet.render({force: true, tab: {categories: MODULE_ID}});
    try {
      sheet.changeTab(MODULE_ID, "categories");
    } catch(err) {
      console.warn(`${MODULE_ID} | The settings have no tab for this module`, err);
    }
    sheet.bringToFront?.();
  }
}

/** Icons of the task buttons. */
const ACTION_ICONS = {
  profile: "fa-solid fa-stopwatch",
  experiments: "fa-solid fa-flask",
  speedTest: "fa-solid fa-gauge-high",
  wizard: "fa-solid fa-wand-magic-sparkles",
  reload: "fa-solid fa-rotate-right",
  modulesManage: "fa-solid fa-cubes",
  exportChat: "fa-solid fa-file-export",
  flushChat: "fa-solid fa-trash",
  optimizeAll: "fa-solid fa-map",
  openScene: "fa-solid fa-map"
};

/**
 * Wait until the canvas shows a scene again (after a setting redrew it), and a moment longer.
 * @returns {Promise<void>}
 */
async function waitForCanvas() {
  for ( let i = 0; i < 100; i++ ) {
    if ( globalThis.canvas?.ready && !globalThis.canvas.loading ) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await new Promise(resolve => setTimeout(resolve, 1500));
}

/**
 * Open the window.
 * @param {object} [options]
 * @param {string} [options.tab]
 * @param {string} [options.sceneId]
 * @param {string} [options.banner]   A line on top
 * @returns {Promise<PerformanceDoctor>}
 */
export async function openDoctor({tab, sceneId, banner}={}) {
  const app = foundry.applications.instances.get(PerformanceDoctor.DEFAULT_OPTIONS.id) ?? new PerformanceDoctor();
  if ( tab ) app.tab = tab;
  if ( sceneId !== undefined ) app.sceneId = sceneId;
  if ( banner ) app.banner = banner;
  await app.render({force: true});
  app.bringToFront?.();
  markUsed(MODULE_ID);
  return app;
}

/**
 * The window, if it is open.
 * @returns {PerformanceDoctor|undefined}
 */
export function doctorApp() {
  const app = foundry.applications.instances.get(PerformanceDoctor.DEFAULT_OPTIONS.id);
  return isShown(app) ? app : undefined;
}

/** Redraw the window if it is open. */
export function refreshDoctor() {
  doctorApp()?.render();
}

/**
 * Forget the result of a scene check, for example after the scene changed.
 * @param {string} sceneId
 */
export function forgetSceneResult(sceneId) {
  memory.scenes.delete(sceneId);
}

/**
 * Remember a scene check done elsewhere (the warning on activation).
 * @param {object} summary
 */
export function rememberSceneResult(summary) {
  if ( summary?.id ) memory.scenes.set(summary.id, summary);
}

