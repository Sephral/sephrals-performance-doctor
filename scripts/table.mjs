/**
 * The table: every client tells the GMs how it is doing (frame rate, delay, download speed, graphics chip, its
 * biggest problem) and how long it needed to load each scene. The GMs' clients collect it, warn about players who
 * wait long for a scene, and show it all in the "Players" tab. A player can switch the sharing off.
 */

import {MODULE_ID, formatBytes, formatDuration, ownerName, setting, t} from "./config.mjs";
import {readGpu} from "./environment.mjs";
import {fpsRating, setLoading} from "./meter.mjs";
import {addLoadSample} from "./network.mjs";
import {onMessage, sendTo, sendToGMs} from "./net.mjs";
import {LATENCY, SLOW_LINE, finding, sortFindings} from "./rules.mjs";
import {collectAssets} from "./scene-check.mjs";
import {checkViewedScene, clientFindings, forgetViewedScene, snapshot} from "./state.mjs";

/**
 * Problems of a player's own computer or line that the GM hears about. A heavy scene or a heavy module the GM sees in
 * their own checks, so those do not raise an alert per player.
 */
export const ALERT_IDS = new Set(["softwareRenderer", "noWebGL2", "oldBrowser", "slowGpu", "slowCpu", "memoryFull",
  "latencyHigh", "connectionDrops", "slowLine", "sceneTooLargeForGpu"]);

/** Seconds between two regular reports, and while a GM watches. */
const REPORT_SECONDS = 30;
const WATCH_SECONDS = 5;

/** The latest report of each user, on a GM's client. */
const reports = new Map();

/** Scene loads by user (the running or last one), and the last loads of everyone. */
const loads = new Map();
const loadHistory = [];

/** What players asked the GM to look at. */
const messages = [];

/** Alerts already shown, so each shows once. */
const alerted = new Set();

/** Who wants to hear about changes (the window). */
const listeners = new Set();

/** Until when a GM wants frequent reports. */
let watchUntil = 0;

/** The load of the running scene draw on this client. */
let currentLoad = null;

/** Loads that finished before the socket could carry them. */
const pendingLoads = [];

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * The short report a client sends.
 * @param {object} snap      state.snapshot()
 * @param {object[]} findings
 * @returns {object}
 */
export function buildReport(snap, findings) {
  const {env, frames, latency, bandwidth, memory} = snap;
  return {
    type: "report",
    v: 1,
    fps: Number.isFinite(frames?.fps) ? Math.round(frames.fps * 10) / 10 : null,
    target: frames?.target ?? 60,
    cpu: Number.isFinite(frames?.cpuShare) ? Math.round(frames.cpuShare * 100) : null,
    rating: fpsRating(frames?.fps, frames?.target),
    latency: latency?.avg ? Math.round(latency.avg) : null,
    speed: bandwidth?.bytesPerSecond ? Math.round(bandwidth.bytesPerSecond) : null,
    speedSource: bandwidth?.source ?? null,
    gpu: {name: env?.gpu?.name ?? "", kind: env?.gpu?.kind ?? "unknown", software: !!env?.gpu?.software,
      maxTexture: env?.gpu?.maxTexture ?? null},
    browser: `${env?.browser?.name ?? ""} ${env?.browser?.version ?? ""}`.trim(),
    os: env?.os ?? "",
    dpr: env?.screen?.dpr ?? 1,
    mode: env?.settings?.effectiveMode ?? env?.settings?.performanceMode ?? null,
    maxFPS: env?.settings?.maxFPS ?? null,
    memory: (memory?.used && memory?.limit) ? Math.round((memory.used / memory.limit) * 100) : null,
    hidden: !!env?.hidden,
    issues: findings.filter(f => f.severity >= 2).slice(0, 4).map(f => ({id: f.id, severity: f.severity,
      data: compactData(f.data)}))
  };
}

/**
 * Keep only small values of a finding's data for the report.
 * @param {object} data
 * @returns {object}
 */
function compactData(data) {
  const out = {};
  for ( const [key, value] of Object.entries(data ?? {}) ) {
    if ( (typeof value === "number") || (typeof value === "boolean") ) out[key] = value;
    else if ( (typeof value === "string") && (value.length <= 80) ) out[key] = value;
  }
  return out;
}

/**
 * Findings for the whole table, from the reports of the players.
 * @param {{name: string, report: object}[]} rows
 * @returns {object[]}
 */
export function diagnoseTable(rows) {
  const out = [];
  const players = rows.filter(r => r.report && !r.self);
  const withSpeed = players.filter(r => r.report.speed > 0);
  const slow = withSpeed.filter(r => r.report.speed < SLOW_LINE);
  if ( (withSpeed.length >= 2) && (slow.length === withSpeed.length) ) {
    out.push(finding("allSlowDownloads", "table", 2, {count: slow.length}));
  }
  const withLatency = players.filter(r => r.report.latency > 0);
  const laggy = withLatency.filter(r => r.report.latency >= LATENCY.warn);
  if ( (withLatency.length >= 2) && (laggy.length === withLatency.length) ) {
    out.push(finding("allHighLatency", "table", 2, {count: laggy.length}));
  }
  for ( const r of players ) {
    const worst = r.report.issues?.find(i => ALERT_IDS.has(i.id));
    if ( worst && (worst.severity >= 3) ) out.push(finding("playerProblem", "table", 2, {name: r.name, issue: worst.id}));
  }
  return sortFindings(out);
}

/* -------------------------------------------- */
/*  This client: reports and scene loads        */
/* -------------------------------------------- */

/**
 * Send a report to the GMs now.
 */
export function sendReport() {
  if ( !game.users ) return;
  const snap = snapshot();
  const report = buildReport(snap, clientFindings(snap));
  if ( game.user.isGM ) receiveReport(report, game.user);
  if ( !setting("shareWithGM") ) return;
  sendToGMs(report);
}

/**
 * Start the regular reports. Call once in "ready".
 */
export function startReporting() {
  onMessage("request", (message, sender) => {
    if ( sender.isGM ) sendReport();
  });
  onMessage("watch", (message, sender) => {
    if ( !sender.isGM ) return;
    watchUntil = Math.max(watchUntil, Date.now() + (Math.min(Number(message.seconds) || 60, 300) * 1000));
    sendReport();
  });
  let last = 0;
  setInterval(() => {
    const now = Date.now();
    const every = (now < watchUntil) ? WATCH_SECONDS : REPORT_SECONDS;
    if ( (now - last) < (every * 1000) - 250 ) return;
    last = now;
    sendReport();
  }, 1000);
  setTimeout(sendReport, 4000);
  for ( const load of pendingLoads.splice(0) ) sendLoad(load);
}

/**
 * Hook "canvasInit": a scene starts to load.
 * @param {Canvas} c
 */
export function onCanvasInit(c) {
  const scene = c?.scene;
  if ( !scene ) return;
  currentLoad = {sceneId: scene.id, sceneName: scene.navName || scene.name, start: performance.now()};
  forgetViewedScene();
  setLoading(true);
  sendLoad({phase: "start", sceneId: scene.id, sceneName: currentLoad.sceneName});
}

/**
 * Hook "canvasReady": the scene is drawn. Foundry downloads its images in a worker, which the page's download list
 * does not see, so the size comes from the scene check (header requests, mostly answered from the cache). A long
 * load of a large scene also tells the speed of the line: download and decoding together, so rather too low.
 * @param {Canvas} c
 */
export async function onCanvasReady(c) {
  setLoading(false);
  const load = currentLoad;
  currentLoad = null;
  if ( !load || (c?.scene?.id !== load.sceneId) ) return;
  const ms = performance.now() - load.start;
  const failed = failedImages(c.scene);
  const summary = await checkViewedScene().catch(() => null);
  const bytes = (summary?.id === load.sceneId) ? summary.totalBytes : null;
  const measurable = (bytes >= 5 * 1024 * 1024) && (ms >= 3000);
  if ( measurable ) addLoadSample(bytes, ms);
  sendLoad({phase: failed.length ? "failed" : "done", sceneId: load.sceneId, sceneName: load.sceneName,
    ms: Math.round(ms), bytes, files: summary?.files ?? null,
    speed: measurable ? Math.round((bytes / ms) * 1000) : null, failed: failed.slice(0, 5)});
}

/**
 * Hook "error": Foundry could not draw the scene.
 * @param {string} location
 * @param {Error} error
 */
export function onError(location, error) {
  if ( (location !== "Canvas#draw") || !currentLoad ) return;
  const load = currentLoad;
  currentLoad = null;
  setLoading(false);
  sendLoad({phase: "failed", sceneId: load.sceneId, sceneName: load.sceneName,
    ms: Math.round(performance.now() - load.start), error: String(error?.message ?? error).slice(0, 200), failed: []});
}

/**
 * Images of a scene that the canvas could not load.
 * @param {Scene} scene
 * @returns {string[]}  File names
 */
function failedImages(scene) {
  const getTexture = globalThis.foundry?.canvas?.getTexture;
  if ( !getTexture ) return [];
  return collectAssets(scene)
    .filter(a => [...a.roles].some(r => ["background", "foreground", "tile"].includes(r)))
    .filter(a => !a.src.startsWith("data:"))
    .filter(a => {
      try {
        return !getTexture(a.src);
      } catch {
        return false;
      }
    })
    .map(a => a.src.split("/").pop());
}

/**
 * Send a load event, or keep it until the socket is ready.
 * @param {object} load
 */
function sendLoad(load) {
  const message = {type: "load", ...load};
  if ( game.user?.isGM ) receiveLoad(message, game.user);
  if ( !game.ready && !game.socket ) {
    pendingLoads.push(load);
    return;
  }
  try {
    if ( setting("shareWithGM") ) sendToGMs(message);
  } catch {
    pendingLoads.push(load);
  }
}

/**
 * Tell the GMs about a finding of this client.
 * @param {object} f
 * @returns {boolean}
 */
export function tellGM(f) {
  return sendToGMs({type: "tell", finding: {id: f.id, severity: f.severity, data: compactData(f.data)}});
}

/* -------------------------------------------- */
/*  GM: collecting                              */
/* -------------------------------------------- */

/**
 * Start listening as a GM. Call once in "ready".
 */
export function startCollecting() {
  if ( !game.user.isGM ) return;
  onMessage("report", (message, sender) => receiveReport(message, sender));
  onMessage("load", (message, sender) => receiveLoad(message, sender));
  onMessage("tell", (message, sender) => receiveTell(message, sender));
  setInterval(checkSlowLoads, 2000);
  // Ask everyone for a report: this GM may just have reloaded
  sendTo({type: "request"}, game.users.filter(u => u.active).map(u => u.id));
}

function changed() {
  for ( const fn of listeners ) {
    try {
      fn();
    } catch(err) {
      console.error(err);
    }
  }
}

/**
 * Hear about new reports and loads.
 * @param {Function} fn
 * @returns {() => void}
 */
export function onTableChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function receiveReport(message, sender) {
  if ( !game.user.isGM ) return;
  reports.set(sender.id, {report: message, at: Date.now()});
  if ( sender.id !== game.user.id ) alertReport(message, sender);
  changed();
}

function receiveLoad(message, sender) {
  if ( !game.user.isGM ) return;
  const now = Date.now();
  if ( message.phase === "start" ) {
    loads.set(sender.id, {userId: sender.id, sceneId: message.sceneId, sceneName: message.sceneName, phase: "loading",
      startedAt: now});
  }
  else {
    const entry = {userId: sender.id, sceneId: message.sceneId, sceneName: message.sceneName, phase: message.phase,
      startedAt: now - (message.ms ?? 0), ms: message.ms ?? null, bytes: message.bytes ?? null, files: message.files ?? null,
      cached: message.cached ?? null, speed: message.speed ?? null, failed: message.failed ?? [], error: message.error ?? null,
      endedAt: now};
    loads.set(sender.id, entry);
    loadHistory.unshift(entry);
    if ( loadHistory.length > 40 ) loadHistory.length = 40;
    if ( sender.id !== game.user.id ) alertLoadDone(entry, sender);
  }
  changed();
}

function receiveTell(message, sender) {
  if ( !game.user.isGM || !message.finding?.id ) return;
  messages.unshift({userId: sender.id, name: sender.name, finding: message.finding, at: Date.now()});
  if ( messages.length > 20 ) messages.length = 20;
  if ( setting("gmAlerts") ) {
    ui.notifications?.info(t("SPD.Alert.tell", {name: sender.name, issue: issueTitle(message.finding)}));
  }
  changed();
}

/**
 * The short title of a finding for the GM's view.
 * @param {{id: string}} f
 * @returns {string}
 */
export function issueTitle(f) {
  const key = `SPD.Short.${f.id}`;
  const data = {...(f.data ?? {})};
  if ( data.owner ) data.owner = ownerName(data.owner);
  return game.i18n.has(key) ? t(key, data) : t(`SPD.Finding.${f.id}.title`, data);
}

/**
 * Warn the GM once per player about serious problems.
 * @param {object} report
 * @param {User} sender
 */
function alertReport(report, sender) {
  if ( !setting("gmAlerts") ) return;
  const worst = report.issues?.find(i => (i.severity >= 3) && ALERT_IDS.has(i.id));
  if ( !worst ) return;
  const key = `${sender.id}:${worst.id}`;
  if ( alerted.has(key) ) return;
  alerted.add(key);
  ui.notifications?.warn(t("SPD.Alert.player", {name: sender.name, issue: issueTitle(worst)}));
}

/**
 * Tell the GM when a player needed long for a scene or could not load parts of it.
 * @param {object} entry
 * @param {User} sender
 */
function alertLoadDone(entry, sender) {
  if ( !setting("gmAlerts") ) return;
  const limit = setting("slowLoadSeconds") * 1000;
  if ( entry.phase === "failed" ) {
    ui.notifications?.warn(t("SPD.Alert.loadFailed", {name: sender.name, scene: entry.sceneName,
      files: (entry.failed ?? []).join(", ") || entry.error || "?"}));
  }
  else if ( (entry.ms ?? 0) >= limit ) {
    const key = `done:${sender.id}:${entry.sceneId}`;
    if ( alerted.has(key) ) return;
    alerted.add(key);
    ui.notifications?.info(t("SPD.Alert.loadSlow", {name: sender.name, scene: entry.sceneName,
      time: formatDuration(entry.ms), bytes: formatBytes(entry.bytes ?? 0)}));
  }
}

/** Warn while a player still waits for a scene. */
function checkSlowLoads() {
  if ( !setting("gmAlerts") ) return;
  const limit = setting("slowLoadSeconds") * 1000;
  const now = Date.now();
  for ( const load of loads.values() ) {
    if ( (load.phase !== "loading") || ((now - load.startedAt) < limit) ) continue;
    const user = game.users.get(load.userId);
    if ( !user?.active || (user.id === game.user.id) ) continue;
    const key = `wait:${load.userId}:${load.sceneId}:${load.startedAt}`;
    if ( alerted.has(key) ) continue;
    alerted.add(key);
    ui.notifications?.warn(t("SPD.Alert.stillLoading", {name: user.name, scene: load.sceneName,
      time: formatDuration(now - load.startedAt)}));
    changed();
  }
}

/* -------------------------------------------- */
/*  GM: reading                                 */
/* -------------------------------------------- */

/**
 * The rows of the "Players" tab: every connected user with the last report and scene load.
 * @returns {object[]}
 */
export function tableRows() {
  const now = Date.now();
  return game.users.filter(u => u.active).map(user => {
    const known = reports.get(user.id);
    return {
      id: user.id,
      name: user.name,
      color: user.color?.css ?? user.color ?? "#888",
      isGM: user.isGM,
      self: user.id === game.user.id,
      report: known?.report ?? null,
      age: known ? Math.round((now - known.at) / 1000) : null,
      load: loads.get(user.id) ?? null
    };
  }).sort((a, b) => (a.self - b.self) || a.name.localeCompare(b.name));
}

/**
 * The last scene loads.
 * @param {string} [sceneId]   Only of this scene
 * @returns {object[]}
 */
export function recentLoads(sceneId) {
  return loadHistory.filter(l => !sceneId || (l.sceneId === sceneId));
}

/** What players asked the GM to look at. */
export function playerMessages() {
  return messages;
}

/**
 * What the GM knows about the players' graphics chips and lines, for the scene check.
 * @returns {{name: string, maxTexture: number|null, bytesPerSecond: number|null}[]}
 */
export function playerCapabilities() {
  const rows = tableRows().filter(r => !r.self || !r.report);
  const list = rows.filter(r => r.report).map(r => ({name: r.name, maxTexture: r.report.gpu?.maxTexture ?? null,
    bytesPerSecond: r.report.speed ?? null}));
  return list;
}

/**
 * Ask everyone (or one user) for frequent reports for a while.
 * @param {number} [seconds=60]
 * @param {string[]} [ids]
 */
export function watchPlayers(seconds=60, ids) {
  const targets = ids ?? game.users.filter(u => u.active && (u.id !== game.user.id)).map(u => u.id);
  sendTo({type: "watch", seconds}, targets);
  sendReport();
}

/**
 * Ask a player to open the Performance Doctor.
 * @param {string} userId
 */
export function askToCheck(userId) {
  sendTo({type: "open", from: game.user.name}, [userId]);
}

/** Forget the alerts shown, for tests. */
export function resetAlerts() {
  alerted.clear();
}

/** The GPU of this client, for the GM's own row. */
export function ownGpu() {
  return readGpu();
}

export const __test__ = {compactData, reports, loads, loadHistory, MODULE_ID};
