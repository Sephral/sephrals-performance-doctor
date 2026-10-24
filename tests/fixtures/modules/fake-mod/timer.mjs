// A "module" that starts a repeating timer, for the interval test. Its path contains /modules/fake-mod/.
export function startTimer(fn, delay) {
  return setInterval(fn, delay);
}
