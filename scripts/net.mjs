/**
 * The module socket. Players send their reports only to the GMs, never to other players. GMs send requests (report
 * now, report often while I watch, please open the doctor) to players.
 */

import {SOCKET} from "./config.mjs";

/** Handlers by message type. */
const handlers = new Map();

let registered = false;

/**
 * Install the socket listener once.
 */
export function registerSocket() {
  if ( registered || !game.socket ) return;
  registered = true;
  game.socket.on(SOCKET, (message, senderId) => {
    // Messages can arrive while Foundry still prepares the world, before the users exist
    const sender = game.users?.get(senderId);
    if ( !sender || !message || (typeof message !== "object") ) return;
    const handler = handlers.get(message.type);
    if ( !handler ) return;
    try {
      handler(message, sender);
    } catch(err) {
      console.error(err);
    }
  });
}

/**
 * Handle a message type.
 * @param {string} type
 * @param {(message: object, sender: User) => void} fn
 */
export function onMessage(type, fn) {
  handlers.set(type, fn);
}

/**
 * The connected GMs other than this user.
 * @returns {string[]}
 */
export function gmIds() {
  return game.users.filter(u => u.active && u.isGM && (u.id !== game.user.id)).map(u => u.id);
}

/**
 * Send a message to the GMs.
 * @param {object} message
 * @returns {boolean}  Whether a GM was there
 */
export function sendToGMs(message) {
  const ids = gmIds();
  if ( !ids.length || !game.socket ) return false;
  game.socket.emit(SOCKET, message, {recipients: ids});
  return true;
}

/**
 * Send a message to some users.
 * @param {object} message
 * @param {string[]} recipients
 */
export function sendTo(message, recipients) {
  const ids = recipients.filter(id => id !== game.user.id);
  if ( ids.length && game.socket ) game.socket.emit(SOCKET, message, {recipients: ids});
}
