/**
 * Module language: like every Sephral module, the Performance Doctor follows Foundry's language or uses a fixed German or
 * English interface (client setting "uiLanguage"). A fixed choice replaces the module's own strings (the SPD
 * namespace) in Foundry's translations, so every localize call and tooltip follows it.
 */

/** The languages the module ships. */
export const UI_LANGUAGES = ["en", "de"];

/** The setting value which follows Foundry's language. */
export const FOLLOW_FOUNDRY = "default";

/** The module strings as Foundry loaded them; restored when the user follows Foundry again. */
let foundryStrings = null;

/** Loaded language files by language. */
const files = new Map();

/* -------------------------------------------- */

/**
 * The language to force for a setting value, or null to follow Foundry.
 * @param {string} choice   Value of the uiLanguage setting
 * @returns {string|null}
 */
export function forcedLanguage(choice) {
  return UI_LANGUAGES.includes(choice) ? choice : null;
}

/**
 * The module strings for a forced language: the strings of its file over the ones Foundry loaded, so a key missing
 * in the file keeps Foundry's text.
 * @param {object} loaded   The SPD strings Foundry loaded
 * @param {object} forced   The SPD strings of the forced language file
 * @returns {object}
 */
export function mergeStrings(loaded, forced) {
  const merge = (base, over) => {
    const result = {...base};
    for ( const [key, value] of Object.entries(over ?? {}) ) {
      result[key] = (value && (typeof value === "object") && !Array.isArray(value))
        ? merge(base?.[key] ?? {}, value)
        : value;
    }
    return result;
  };
  return merge(loaded ?? {}, forced ?? {});
}

/* -------------------------------------------- */

/**
 * Load one of the module's language files.
 * @param {string} lang
 * @returns {Promise<object>}
 */
async function loadFile(lang) {
  if ( !files.has(lang) ) {
    files.set(lang, fetch(new URL(`../lang/${lang}.json`, import.meta.url))
      .then(response => (response.ok ? response.json() : {}))
      .catch(err => {
        console.warn(`sephrals-performance-doctor | Could not load lang/${lang}.json`, err);
        return {};
      }));
  }
  return files.get(lang);
}

/**
 * Apply the module language to Foundry's translations.
 * @param {string} choice   Value of the uiLanguage setting
 * @returns {Promise<void>}
 */
export async function applyModuleLanguage(choice) {
  const translations = game.i18n.translations;
  foundryStrings ??= foundry.utils.deepClone(translations.SPD ?? {});
  const lang = forcedLanguage(choice);
  if ( !lang ) {
    translations.SPD = foundry.utils.deepClone(foundryStrings);
    return;
  }
  const file = await loadFile(lang);
  translations.SPD = mergeStrings(foundryStrings, file.SPD);
}
