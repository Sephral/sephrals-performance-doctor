/**
 * The diagnosis: plain functions that turn measured numbers into findings. A finding names a problem in words a
 * player understands and offers what helps: a setting to change with one click, a guide, a test or a message to the
 * GM. Nothing here touches Foundry, so the rules are tested without it.
 *
 * Severity: 3 serious, 2 noticeable, 1 hint, 0 all good. Texts come from SPD.Finding.<id>.title and .text.
 */

import {fpsRating} from "./meter.mjs";

/** Foundry's canvas performance modes. */
export const MODES = {LOW: 0, MED: 1, HIGH: 2, MAX: 3};

/** Bytes per second below which a line counts as slow (12 Mbit/s) and very slow (5 Mbit/s). */
export const SLOW_LINE = 1.5e6;
export const VERY_SLOW_LINE = 0.625e6;

/** Scene download sizes that take noticeably long and far too long on an average line. */
export const SCENE_BYTES = {warn: 25 * 1024 * 1024, serious: 80 * 1024 * 1024};

/** Latency (round trip, ms) that feels sluggish and that makes the game hard to play. */
export const LATENCY = {warn: 300, serious: 1000};

/**
 * A finding.
 * @param {string} id
 * @param {string} area      "pc", "settings", "network", "scene", "modules", "world" or "table"
 * @param {number} severity
 * @param {object} [data]    Values for the texts
 * @param {object[]} [fixes]
 * @returns {object}
 */
export function finding(id, area, severity, data={}, fixes=[]) {
  return {id, area, severity, data, fixes};
}

/**
 * Sort findings: serious first, then by area order.
 * @param {object[]} list
 * @returns {object[]}
 */
export function sortFindings(list) {
  const order = ["pc", "settings", "network", "scene", "modules", "world", "table"];
  return [...list].sort((a, b) => (b.severity - a.severity) || (order.indexOf(a.area) - order.indexOf(b.area)));
}

/**
 * The worst severity of a list, 0 for none.
 * @param {object[]} list
 * @returns {number}
 */
export function worst(list) {
  return list.reduce((max, f) => Math.max(max, f.severity), 0);
}

/**
 * Where the time of a slow frame goes. Scripts of the canvas run on the processor, the drawing itself on the
 * graphics chip. When the scripts take most of each frame the processor is the bottleneck, otherwise the graphics
 * chip (or the browser waiting for it).
 * @param {object} frames   Result of meter.summarize
 * @returns {"cpu"|"gpu"|null}
 */
export function bottleneck(frames) {
  if ( !frames?.frames || (frames.cpuShare === null) ) return null;
  if ( (frames.cpuShare >= 0.5) || (frames.longShare >= 0.25) ) return "cpu";
  return "gpu";
}

/**
 * The guide that fits a browser for switching hardware acceleration on.
 * @param {{name: string, engine: string, app: boolean}} browser
 * @returns {string}
 */
export function accelerationGuide(browser) {
  if ( browser?.app ) return "accelApp";
  const byName = {Chrome: "accelChrome", Chromium: "accelChrome", Edge: "accelEdge", Opera: "accelOpera",
    Brave: "accelBrave", Vivaldi: "accelChrome", Firefox: "accelFirefox", Safari: "accelSafari"};
  return byName[browser?.name] ?? (browser?.engine === "firefox" ? "accelFirefox" : "accelChrome");
}

/**
 * The findings about this computer, its settings and its connection.
 * @param {object} input
 * @param {object} input.env        environment.readEnvironment()
 * @param {object} input.frames     meter.summarize() of the last seconds
 * @param {object} [input.latency]  meter.latency()
 * @param {object} [input.bandwidth]  network.bandwidth()
 * @param {object} [input.memory]   meter.memoryInfo()
 * @param {object} [input.scene]    Summary of the viewed scene (sceneSummary)
 * @param {boolean} [input.canvas=true]   Is a canvas there at all?
 * @returns {object[]}
 */
export function diagnoseClient({env, frames, latency, bandwidth, memory, scene, canvas=true}) {
  const out = [];
  const gpu = env?.gpu ?? {};
  const settings = env?.settings ?? {};
  const browser = env?.browser ?? {};
  const dpr = env?.screen?.dpr ?? 1;

  // The graphics chip
  if ( gpu.software ) {
    out.push(finding("softwareRenderer", "pc", 3, {gpu: gpu.name || gpu.renderer || "?", browser: browser.name ?? ""},
      [{kind: "guide", guide: accelerationGuide(browser)}, {kind: "guide", guide: "drivers"}]));
  }
  if ( canvas && (gpu.webgl2 === false) && !gpu.software && gpu.renderer ) {
    out.push(finding("noWebGL2", "pc", 3, {}, [{kind: "guide", guide: "browserUpdate"}, {kind: "guide", guide: "drivers"}]));
  }
  if ( env?.issues?.includes("browserVersionIncompatible") ) {
    out.push(finding("oldBrowser", "pc", 2, {browser: `${browser.name} ${browser.version}`.trim()},
      [{kind: "guide", guide: "browserUpdate"}]));
  }
  if ( settings.noCanvas ) out.push(finding("noCanvas", "settings", 1));

  // Frames
  const enough = (frames?.seconds ?? 0) >= 5;
  if ( canvas && !settings.noCanvas && (frames?.hiddenSeconds ?? 0) >= 5 && !enough ) {
    out.push(finding("hiddenTab", "pc", 1));
  }
  if ( canvas && enough && Number.isFinite(frames.fps) ) {
    const target = frames.target || 60;
    const rating = fpsRating(frames.fps, target);
    const fps = Math.round(frames.fps);
    const limit = bottleneck(frames);
    const mode = settings.effectiveMode ?? settings.performanceMode;
    const slow = rating !== "good";
    if ( !slow ) {
      out.push(finding("framesGood", "pc", 0, {fps, target}));
      if ( (settings.maxFPS ?? 60) <= 30 && (frames.cpuShare ?? 1) < 0.35 && !gpu.software ) {
        out.push(finding("fpsCapped", "settings", 1, {fps, max: settings.maxFPS},
          [{kind: "setting", key: "maxFPS", value: 60}]));
      }
    }
    else {
      out.push(finding(limit === "cpu" ? "slowCpu" : "slowGpu", "pc", rating === "poor" ? 3 : 2,
        {fps, target, cpu: Math.round((frames.cpuShare ?? 0) * 100)},
        limit === "cpu" ? [{kind: "action", action: "profile"}, {kind: "action", action: "experiments"}]
          : [{kind: "action", action: "experiments"}, {kind: "action", action: "wizard"}]));

      // Settings that cost the graphics chip the most
      if ( settings.scaling && (dpr > 1.05) ) {
        out.push(finding("hidpi", "settings", limit === "gpu" ? 2 : 1,
          {dpr: Math.round(dpr * 100) / 100, factor: Math.round(dpr * dpr * 10) / 10},
          [{kind: "setting", key: "pixelRatioResolutionScaling", value: false, reload: true}]));
      }
      if ( Number.isInteger(mode) && (mode >= MODES.HIGH) ) {
        out.push(finding("modeHigh", "settings", 2, {}, [{kind: "setting", key: "performanceMode", value: MODES.MED}]));
      }
      else if ( (mode === MODES.MED) && (rating === "poor") ) {
        out.push(finding("modeMedium", "settings", 2, {}, [{kind: "setting", key: "performanceMode", value: MODES.LOW}]));
      }
      if ( settings.lightAnimation && ((scene?.animatedLights ?? 1) > 0) && (mode !== MODES.LOW) ) {
        out.push(finding("lightAnimation", "settings", 1, {count: scene?.animatedLights ?? null},
          [{kind: "setting", key: "lightAnimation", value: false}]));
      }
      if ( settings.visionAnimation && (rating === "poor") ) {
        out.push(finding("visionAnimation", "settings", 1, {}, [{kind: "setting", key: "visionAnimation", value: false}]));
      }
      if ( (gpu.kind === "integrated") && (env?.os === "Windows") ) {
        out.push(finding("integratedGpu", "pc", 1, {gpu: gpu.name}, [{kind: "guide", guide: "gpuChoice"}]));
      }
      if ( env?.battery && !env.battery.charging ) {
        out.push(finding("battery", "pc", 2, {level: Math.round((env.battery.level ?? 0) * 100)},
          [{kind: "guide", guide: "power"}]));
      }
      if ( (frames.fps >= 26) && (frames.fps <= 32) && ((settings.maxFPS ?? 60) >= 60) && (frames.cpuShare ?? 1) < 0.35 ) {
        out.push(finding("fps30", "pc", 1, {fps}, [{kind: "guide", guide: "power"}]));
      }
      if ( (limit === "gpu") && ((env?.canvasPixels ?? 0) > 8e6) ) {
        out.push(finding("largeCanvas", "pc", 1, {mp: Math.round((env.canvasPixels / 1e6) * 10) / 10}));
      }
      if ( browser.engine === "firefox" ) out.push(finding("tryChromium", "pc", 1));
    }
    if ( (frames.longShare ?? 0) >= 0.12 ) {
      out.push(finding("blocked", "modules", frames.longShare >= 0.3 ? 3 : 2,
        {share: Math.round(frames.longShare * 100)}, [{kind: "action", action: "profile"}]));
    }
  }

  // Memory
  if ( memory?.used && memory?.limit && ((memory.used / memory.limit) > 0.85) ) {
    out.push(finding("memoryFull", "pc", 2, {used: memory.used, limit: memory.limit}, [{kind: "action", action: "reload"}]));
  }
  if ( memory?.textures && (memory.textures > 2.5 * 1024 * 1024 * 1024) ) {
    out.push(finding("textureMemory", "scene", 1, {bytes: memory.textures}));
  }

  // Connection
  if ( (latency?.samples ?? 0) >= 2 ) {
    if ( latency.avg >= LATENCY.serious ) {
      out.push(finding("latencyHigh", "network", 3, {ms: Math.round(latency.avg)}, [{kind: "guide", guide: "network"}]));
    }
    else if ( latency.avg >= LATENCY.warn ) {
      out.push(finding("latencyHigh", "network", 2, {ms: Math.round(latency.avg)}, [{kind: "guide", guide: "network"}]));
    }
  }
  if ( (latency?.failures ?? 0) >= 2 ) {
    out.push(finding("connectionDrops", "network", 2, {count: latency.failures}, [{kind: "guide", guide: "network"}]));
  }
  if ( bandwidth?.bytesPerSecond ) {
    const bps = bandwidth.bytesPerSecond;
    if ( bps < SLOW_LINE ) {
      out.push(finding("slowLine", "network", bps < VERY_SLOW_LINE ? 3 : 2,
        {speed: bps, map: 50 * 1024 * 1024, ms: ((50 * 1024 * 1024) / bps) * 1000},
        [bandwidth.source === "test" ? {kind: "guide", guide: "network"} : {kind: "action", action: "speedTest"}]));
    }
  }
  if ( env?.connection?.saveData ) out.push(finding("saveData", "network", 1));

  // The viewed scene, as far as this computer is concerned
  if ( scene ) out.push(...diagnoseSceneForClient(scene, {gpu, bandwidth}));
  return sortFindings(out);
}

/**
 * What the viewed scene means for this computer: the download, and images larger than the graphics chip can hold.
 * File names are not part of it, so a player learns nothing about hidden content.
 * @param {object} scene      sceneSummary()
 * @param {object} context
 * @returns {object[]}
 */
export function diagnoseSceneForClient(scene, {gpu, bandwidth}) {
  const out = [];
  const bytes = scene.totalBytes ?? 0;
  if ( bytes >= SCENE_BYTES.warn ) {
    const ms = bandwidth?.bytesPerSecond ? (bytes / bandwidth.bytesPerSecond) * 1000 : null;
    out.push(finding("sceneHeavy", "scene", bytes >= SCENE_BYTES.serious ? 3 : 2, {bytes, ms},
      [{kind: "tellGM"}]));
  }
  if ( gpu?.maxTexture && (scene.largestSide > gpu.maxTexture) ) {
    out.push(finding("sceneTooLargeForGpu", "scene", 3, {side: scene.largestSide, max: gpu.maxTexture}, [{kind: "tellGM"}]));
  }
  return out;
}

/**
 * Settings changes a set of findings suggests, without duplicates, most helpful first.
 * @param {object[]} findings
 * @returns {{key: string, value: *, reload: boolean, finding: string}[]}
 */
export function suggestedSettings(findings) {
  const seen = new Map();
  for ( const f of sortFindings(findings) ) {
    for ( const fix of f.fixes ) {
      if ( (fix.kind !== "setting") || seen.has(fix.key) ) continue;
      seen.set(fix.key, {key: fix.key, value: fix.value, reload: !!fix.reload, finding: f.id});
    }
  }
  return [...seen.values()];
}

/**
 * The verdict for the module measurement: how heavy each owner is.
 * @param {object[]} rows   Rows of the profile (owner, msPerSecond, maxMs, ...)
 * @param {object} [options]
 * @param {string} [options.self]   Owner key of this module, never blamed
 * @returns {object[]}
 */
export function diagnoseProfile(rows, {self}={}) {
  const out = [];
  for ( const row of rows ) {
    if ( (row.owner === self) || ["core", "unknown"].includes(row.owner) ) continue;
    const share = row.msPerSecond / 1000;
    if ( share >= 0.1 ) {
      out.push(finding("moduleHeavy", "modules", share >= 0.25 ? 3 : 2,
        {owner: row.owner, share: Math.round(share * 100), ms: Math.round(row.msPerSecond)},
        [{kind: "action", action: "modulesManage"}, {kind: "tellGM"}]));
    }
    else if ( row.maxMs >= 100 ) {
      out.push(finding("moduleSpike", "modules", 2, {owner: row.owner, ms: Math.round(row.maxMs), label: row.topLabel ?? ""},
        [{kind: "action", action: "modulesManage"}, {kind: "tellGM"}]));
    }
  }
  return sortFindings(out);
}
