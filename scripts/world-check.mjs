/**
 * The world check (GM): how much data every player downloads when joining, what makes it large, and where the
 * server keeps the most data. The join download is measured from the data this client received when it joined.
 */

import {finding, sortFindings} from "./rules.mjs";

/** The collections of the join download, in the order of Foundry's world data. */
export const COLLECTIONS = ["actors", "items", "scenes", "journal", "messages", "tables", "playlists", "macros", "cards",
  "combats", "folders", "users", "settings", "packs"];

/** The document class of each collection, for names. */
const DOCUMENT_NAMES = {actors: "Actor", items: "Item", scenes: "Scene", journal: "JournalEntry", messages: "ChatMessage",
  tables: "RollTable", playlists: "Playlist", macros: "Macro", cards: "Cards", combats: "Combat", folders: "Folder",
  users: "User", settings: "Setting"};

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * The size of a value as JSON, in bytes.
 * @param {*} value
 * @returns {number}
 */
export function jsonBytes(value) {
  const text = JSON.stringify(value ?? null) ?? "";
  if ( typeof Blob !== "undefined" ) return new Blob([text]).size;
  return Buffer.byteLength(text, "utf8");
}

/**
 * The parts of the join download.
 * @param {object} data   game.data
 * @returns {{collections: object[], total: number, largest: object[], embedded: object[]}}
 */
export function analyzeData(data) {
  const collections = [];
  const documents = [];
  let total = 0;
  for ( const key of COLLECTIONS ) {
    const list = Array.isArray(data?.[key]) ? data[key] : [];
    let bytes = 0;
    for ( const doc of list ) {
      // The length of the JSON text: exact for plain text, a little low for umlauts and other letters
      const text = JSON.stringify(doc ?? null) ?? "";
      bytes += text.length;
      if ( (key !== "packs") && (key !== "settings") ) {
        documents.push({collection: key, id: doc._id, name: doc.name ?? doc.flavor ?? doc._id, bytes: text.length,
          embedded: key === "messages" ? 0 : countDataUrisIn(text)});
      }
    }
    total += bytes;
    collections.push({key, count: list.length, bytes});
  }
  const rest = jsonBytes(Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !COLLECTIONS.includes(k))));
  total += rest;
  collections.push({key: "other", count: null, bytes: rest});
  documents.sort((a, b) => b.bytes - a.bytes);
  return {
    collections: collections.sort((a, b) => b.bytes - a.bytes),
    total,
    largest: documents.slice(0, 10),
    embedded: documents.filter(d => d.embedded > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 10)
  };
}

/**
 * How many images a document carries inside its data (data: URIs), which every player downloads with the world.
 * @param {object} doc
 * @returns {number}
 */
export function countDataUris(doc) {
  return countDataUrisIn(JSON.stringify(doc ?? {}));
}

/**
 * How many data: URIs of images a JSON text holds.
 * @param {string} text
 * @returns {number}
 */
function countDataUrisIn(text) {
  return (text.match(/data:image\/[a-z+]+;base64,/gi) ?? []).length;
}

/**
 * The findings of a world check.
 * @param {object} analysis   analyzeData()
 * @param {object} [extra]
 * @param {number} [extra.messages]       Chat messages now
 * @param {object} [extra.disk]           Sizes on the server's disk by collection
 * @param {number} [extra.activeModules]
 * @returns {object[]}
 */
export function diagnoseWorld(analysis, {messages=0, disk=null, activeModules=0}={}) {
  const out = [];
  const mb = 1024 * 1024;
  const part = key => analysis.collections.find(c => c.key === key)?.bytes ?? 0;
  if ( analysis.total >= 20 * mb ) {
    out.push(finding("worldLarge", "world", analysis.total >= 60 * mb ? 3 : 2, {bytes: analysis.total}));
  }
  const chat = part("messages");
  if ( (messages >= 1500) || (chat >= 8 * mb) ) {
    out.push(finding("chatLarge", "world", ((messages >= 5000) || (chat >= 20 * mb)) ? 3 : 2, {count: messages, bytes: chat},
      [{kind: "action", action: "exportChat"}, {kind: "action", action: "flushChat"}]));
  }
  for ( const doc of analysis.largest.filter(d => d.bytes >= 2 * mb).slice(0, 5) ) {
    out.push(finding("documentLarge", "world", doc.bytes >= 8 * mb ? 3 : 2,
      {name: doc.name, collection: doc.collection, bytes: doc.bytes},
      [{kind: "openDocument", collection: doc.collection, id: doc.id}]));
  }
  for ( const doc of analysis.embedded.slice(0, 5) ) {
    out.push(finding("documentImages", "world", 2, {name: doc.name, collection: doc.collection, count: doc.embedded,
      bytes: doc.bytes}, [{kind: "openDocument", collection: doc.collection, id: doc.id}]));
  }
  if ( part("packs") >= 6 * mb ) out.push(finding("packIndexes", "world", 1, {bytes: part("packs")}));
  if ( part("scenes") >= 15 * mb ) out.push(finding("scenesLarge", "world", 1, {bytes: part("scenes")}));
  if ( disk?.fog >= 50 * mb ) out.push(finding("fogLarge", "world", 1, {bytes: disk.fog}));
  if ( activeModules >= 100 ) out.push(finding("manyModules", "world", 1, {count: activeModules}));
  return sortFindings(out);
}

/* -------------------------------------------- */
/*  Runtime                                     */
/* -------------------------------------------- */

/**
 * Ask the server how large the world's databases are on disk (the same request as Foundry's support report).
 * @param {number} [timeout=15000]
 * @returns {Promise<Record<string, number>|null>}
 */
export function diskSizes(timeout=15000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeout);
    try {
      game.socket.emit("sizeInfo", sizes => {
        clearTimeout(timer);
        resolve(sizes && (typeof sizes === "object") ? sizes : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * Check the world.
 * @returns {Promise<object>}
 */
export async function checkWorld() {
  const analysis = analyzeData(game.data);
  const disk = await diskSizes();
  const activeModules = game.modules.filter(m => m.active).length;
  const messages = game.messages?.size ?? 0;
  const findings = diagnoseWorld(analysis, {messages, disk, activeModules});
  return {...analysis, disk, activeModules, messages, packs: game.packs?.size ?? 0, findings, at: Date.now()};
}

/**
 * The document behind a row of the check.
 * @param {string} collection
 * @param {string} id
 * @returns {foundry.abstract.Document|null}
 */
export function documentOf(collection, id) {
  const name = DOCUMENT_NAMES[collection];
  if ( !name ) return null;
  return game.collections.get(name)?.get(id) ?? null;
}
