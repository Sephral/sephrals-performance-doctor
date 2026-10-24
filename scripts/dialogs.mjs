/**
 * Small dialogs: the step-by-step guides, the questions before a reload and the flow that makes a smaller copy of
 * a heavy image.
 */

import {MODULE_ID, esc, formatBytes, setting, t} from "./config.mjs";
import {makeOptimized, scenesUsing, storeOptimized, useCopy} from "./image-tools.mjs";
import {fileName, forgetProbes} from "./scene-check.mjs";

const {DialogV2} = foundry.applications.api;

/**
 * Turn a guide text into HTML: one step per line, `code` becomes a field to copy.
 * @param {string} text
 * @returns {string}
 */
export function guideHtml(text) {
  const line = s => esc(s).replace(/`([^`]+)`/g, (m, code) =>
    `<code class="spd-copy" data-copy="${code}" data-tooltip="${esc(t("SPD.Guide.copy"))}">${code}</code>`);
  const steps = String(text ?? "").split("\n").map(s => s.trim()).filter(Boolean);
  return `<ol class="spd-steps">${steps.map(s => `<li>${line(s)}</li>`).join("")}</ol>`;
}

/**
 * Show a guide.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function showGuide(id) {
  const intro = game.i18n.has(`SPD.Guide.${id}.intro`) ? `<p>${esc(t(`SPD.Guide.${id}.intro`))}</p>` : "";
  const outro = game.i18n.has(`SPD.Guide.${id}.outro`) ? `<p class="spd-muted">${esc(t(`SPD.Guide.${id}.outro`))}</p>` : "";
  const content = `<div class="spd spd-guide" data-spd-theme="${esc(setting("theme"))}">${intro}`
    + `${guideHtml(t(`SPD.Guide.${id}.steps`))}${outro}</div>`;
  await DialogV2.prompt({
    window: {title: t(`SPD.Guide.${id}.title`), icon: "fa-solid fa-list-check"},
    position: {width: 460},
    content,
    ok: {label: t("SPD.Guide.close"), icon: "fa-solid fa-check"},
    render: (event, dialog) => bindCopy(dialog.element ?? event?.target?.element)
  }).catch(() => null);
}

/**
 * Make the code fields of an element copy their text on click.
 * @param {HTMLElement} element
 */
export function bindCopy(element) {
  element?.querySelectorAll?.("[data-copy]").forEach(el => el.addEventListener("click", () => {
    game.clipboard?.copyPlainText?.(el.dataset.copy);
    ui.notifications.info(t("SPD.Guide.copied", {text: el.dataset.copy}));
  }));
}

/**
 * Ask whether to reload now.
 * @returns {Promise<boolean>}
 */
export async function confirmReload() {
  const yes = await DialogV2.confirm({
    window: {title: t("SPD.Reload.title"), icon: "fa-solid fa-rotate-right"},
    content: `<p>${esc(t("SPD.Reload.text"))}</p>`,
    yes: {label: t("SPD.Reload.now")},
    no: {label: t("SPD.Reload.later")}
  }).catch(() => false);
  if ( yes ) foundry.utils.debouncedReload?.() ?? window.location.reload();
  return !!yes;
}

/**
 * Make a smaller copy of an image of a scene and let the GM use it.
 * @param {string} src
 * @param {Scene} scene
 * @returns {Promise<boolean>}   Whether the scene now uses the copy
 */
export async function optimizeFlow(src, scene) {
  const others = scenesUsing(src).filter(s => s.id !== scene.id);
  const sides = [0, 8192, 6144, 4096];
  const options = sides.map(s => `<option value="${s}" ${s === 8192 ? "selected" : ""}>${esc(s ? t("SPD.Optimize.side", {side: s})
    : t("SPD.Optimize.keep"))}</option>`).join("");
  const content = `<div class="spd spd-dialog" data-spd-theme="${esc(setting("theme"))}">
    <p>${esc(t("SPD.Optimize.intro", {file: fileName(src)}))}</p>
    <div class="form-group"><label>${esc(t("SPD.Optimize.size"))}</label><select name="maxSide">${options}</select></div>
    <div class="form-group"><label>${esc(t("SPD.Optimize.quality"))}</label>
      <select name="quality"><option value="0.92">${esc(t("SPD.Optimize.q.high"))}</option>
      <option value="0.85" selected>${esc(t("SPD.Optimize.q.normal"))}</option>
      <option value="0.75">${esc(t("SPD.Optimize.q.small"))}</option></select></div>
    ${others.length ? `<label class="spd-check"><input type="checkbox" name="others" checked> ${esc(t("SPD.Optimize.others",
      {count: others.length}))}</label>` : ""}
    <p class="spd-muted">${esc(t("SPD.Optimize.keepsOriginal"))}</p></div>`;
  const choice = await DialogV2.wait({
    window: {title: t("SPD.Optimize.title"), icon: "fa-solid fa-wand-magic-sparkles"},
    position: {width: 440},
    content,
    buttons: [
      {action: "make", label: t("SPD.Optimize.make"), icon: "fa-solid fa-gears", default: true,
        callback: (event, button) => ({maxSide: Number(button.form.elements.maxSide.value),
          quality: Number(button.form.elements.quality.value), others: !!button.form.elements.others?.checked})},
      {action: "cancel", label: t("SPD.Optimize.cancel"), callback: () => null}
    ],
    rejectClose: false
  }).catch(() => null);
  if ( !choice ) return false;

  const note = ui.notifications.info(t("SPD.Optimize.working", {file: fileName(src)}), {permanent: true});
  let made;
  try {
    made = await makeOptimized(src, choice);
  } catch(err) {
    ui.notifications.remove?.(note);
    const reason = ["animated", "too large", "no webp", "unknown size"].includes(err.message)
      ? t(`SPD.Optimize.error.${err.message.replace(" ", "")}`) : err.message;
    ui.notifications.error(t("SPD.Optimize.failed", {reason}));
    return false;
  }
  ui.notifications.remove?.(note);

  const saved = made.originalBytes - made.bytes;
  const summary = t("SPD.Optimize.result", {before: formatBytes(made.originalBytes), after: formatBytes(made.bytes),
    from: `${made.originalWidth} × ${made.originalHeight}`, to: `${made.width} × ${made.height}`});
  const worse = saved <= 0;
  const use = await DialogV2.confirm({
    window: {title: t("SPD.Optimize.title"), icon: "fa-solid fa-wand-magic-sparkles"},
    content: `<div class="spd spd-dialog" data-spd-theme="${esc(setting("theme"))}"><p>${esc(summary)}</p>
      ${worse ? `<p class="spd-warn">${esc(t("SPD.Optimize.notSmaller"))}</p>` : ""}
      <p>${esc(t("SPD.Optimize.question", {count: 1 + (choice.others ? others.length : 0)}))}</p></div>`,
    yes: {label: t("SPD.Optimize.use"), icon: "fa-solid fa-check"},
    no: {label: t("SPD.Optimize.cancel")}
  }).catch(() => false);
  if ( !use ) return false;

  try {
    const path = await storeOptimized(made.file);
    const scenes = [scene, ...(choice.others ? others : [])];
    await useCopy(scenes, src, path, {before: made.originalBytes, after: made.bytes});
    forgetProbes([src, path]);
    ui.notifications.info(t("SPD.Optimize.done", {saved: formatBytes(Math.max(0, saved)), count: scenes.length}));
    return true;
  } catch(err) {
    console.error(`${MODULE_ID} | Upload of the optimized image failed`, err);
    const reason = err.message === "permission" ? t("SPD.Optimize.error.permission") : err.message;
    ui.notifications.error(t("SPD.Optimize.failed", {reason}));
    return false;
  }
}
