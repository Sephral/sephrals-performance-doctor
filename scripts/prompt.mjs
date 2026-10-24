/**
 * The hint for a slow game: when the frame rate stays low for a while, a small window offers help. It shows once
 * per session at most, can be snoozed and switched off, and never while a scene loads or the tab is hidden.
 */

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

import {MODULE_ID, TEMPLATES, num, setting, t} from "./config.mjs";
import {fpsRating, frameStats, onSecond} from "./meter.mjs";
import {openDoctor} from "./doctor-app.mjs";

/** Seconds the game has to be slow before the hint shows. */
const SLOW_SECONDS = 45;

/** Minutes the hint keeps quiet after "Later". */
const SNOOZE_MINUTES = 30;

let shownThisSession = false;
let slowSince = null;

class SlowGamePrompt extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "spd-prompt",
    classes: ["spd", "spd-prompt"],
    window: {title: "SPD.Prompt.title", icon: "fa-solid fa-stethoscope", minimizable: false, resizable: false},
    position: {width: 320, height: "auto"},
    actions: {
      help: SlowGamePrompt.#onHelp,
      later: SlowGamePrompt.#onLater,
      never: SlowGamePrompt.#onNever
    }
  };

  /** @override */
  static PARTS = {body: {template: `${TEMPLATES}/prompt.hbs`}};

  /** The frame rate that started it. */
  fps = 0;

  /** @override */
  get title() {
    return t("SPD.Prompt.title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.text = t("SPD.Prompt.text", {fps: num(this.fps, this.fps < 10 ? 1 : 0)});
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.dataset.spdTheme = setting("theme");
  }

  static async #onHelp() {
    await this.close();
    await openDoctor({tab: "overview"});
  }

  static async #onLater() {
    await game.settings.set(MODULE_ID, "promptSnooze", Date.now() + (SNOOZE_MINUTES * 60 * 1000));
    await this.close();
  }

  static async #onNever() {
    await game.settings.set(MODULE_ID, "autoPrompt", false);
    ui.notifications.info(t("SPD.Prompt.off"));
    await this.close();
  }
}

/**
 * Watch the frame rate and offer help when it stays low. Call once in "ready".
 */
export function watchForSlowGame() {
  onSecond(() => {
    if ( shownThisSession || !setting("autoPrompt") ) return;
    if ( Date.now() < (setting("promptSnooze") ?? 0) ) return;
    if ( !globalThis.canvas?.ready || document.hidden ) {
      slowSince = null;
      return;
    }
    const stats = frameStats(10);
    if ( (stats.seconds < 8) || (fpsRating(stats.fps, stats.target) !== "poor") ) {
      slowSince = null;
      return;
    }
    slowSince ??= Date.now();
    if ( (Date.now() - slowSince) < SLOW_SECONDS * 1000 ) return;
    if ( foundry.applications.instances.get("spd-doctor")?.rendered ) return;
    shownThisSession = true;
    const app = new SlowGamePrompt();
    app.fps = stats.fps;
    app.render({force: true, position: {left: 110, top: Math.max(80, window.innerHeight - 330)}});
  });
}
