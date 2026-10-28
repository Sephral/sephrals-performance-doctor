/**
 * Performance Doctor's part of the debug file of Sephral's modules: the numbers of this client and its findings, the
 * last tests, the graphics settings the module changed and still undoes, and what the GM knows about the players
 * (user ids, no names). Registered in "init" like the self-test, nothing here runs before a GM saves a file.
 */

import {MODULE_ID, t} from "./config.mjs";
import {registerDebugMenu, registerDebugProvider} from "./debug-file.mjs";
import {madeChanges} from "./fixes.mjs";
import {phases, startupPhases} from "./profiler.mjs";
import {clientFindings, results, snapshot} from "./state.mjs";
import {tableRows} from "./table.mjs";

/**
 * Run one part and keep its error instead, so one broken reading does not cost the rest.
 * @param {Function} fn
 * @returns {*}
 */
function attempt(fn) {
  try {
    return fn();
  } catch(err) {
    return {error: String(err?.message ?? err)};
  }
}

/**
 * What the doctor knows right now.
 * @returns {object}
 */
export function describeState() {
  const snap = attempt(() => snapshot());
  return {
    snapshot: snap,
    findings: attempt(() => clientFindings(snap).map(({id, area, severity, data}) => ({id, area, severity, data}))),
    tests: {experiments: results.experiments, profile: results.profile},
    changes: attempt(() => madeChanges()),
    phases: attempt(() => ({...phases, ...startupPhases()})),
    players: game.user?.isGM
      ? attempt(() => tableRows().map(({id, isGM, self, report, age, load}) => ({id, isGM, self, report, age, load})))
      : null
  };
}

/**
 * The button in the settings and the doctor's part of the file. Call in "init".
 */
export function registerDebug() {
  registerDebugMenu(MODULE_ID, {name: "SPD.DEBUG.Title", label: "SPD.DEBUG.Save", hint: "SPD.DEBUG.Hint"});
  registerDebugProvider({
    moduleId: MODULE_ID,
    label: () => t("SPD.DEBUG.Entry"),
    notice: file => t("SPD.DEBUG.Saved", {file}),
    recent: () => ({details: describeState()})
  });
}
