// The hub's Google Calendar service: the API client, pending sign-ins, and the sync loop.
import { googleClient, newState } from "./client.js";
import { syncGoogle } from "./sync.js";

export const SYNC_EVERY_MS = 60_000;

/**
 * @param opts.today    () => 'YYYY-MM-DD'
 * @param opts.fetchImpl injectable fetch (tests use a fake Google)
 * @param opts.nudgeMs  after a change in the hub, sync this soon (0 = only on the timer)
 */
export function createGoogle(db, { clientId, clientSecret, today, fetchImpl, nudgeMs = 0 }) {
  const client = googleClient({ clientId, clientSecret, fetchImpl });
  const states = new Map(); // sign-in state -> { redirectUri, expires }
  let running = null;
  let queued = null;
  let timer = null;
  let nudge = null;

  const google = {
    client,
    configured: client.configured,

    /** Start a sign-in; returns the state to send to Google. */
    begin(redirectUri) {
      const now = Date.now();
      for (const [k, v] of states) if (v.expires < now) states.delete(k);
      const state = newState();
      states.set(state, { redirectUri, expires: now + 10 * 60_000 });
      return state;
    },
    /** The redirect URI a returning sign-in started with, once. */
    finish(state) {
      const s = states.get(state);
      states.delete(state);
      return s && s.expires > Date.now() ? s.redirectUri : null;
    },

    /** Sync now. If one is already running, run once more after it (it may have started before a change). */
    sync() {
      if (running) {
        queued ??= running.then(() => { queued = null; return google.sync(); });
        return queued;
      }
      running = syncGoogle(db, client, today()).finally(() => { running = null; });
      return running;
    },
    /** Something changed in the hub: sync shortly, so Google shows it within seconds. */
    changed() {
      if (!nudgeMs || !client.configured) return;
      clearTimeout(nudge);
      nudge = setTimeout(() => void google.sync(), nudgeMs);
      nudge.unref?.();
    },
    start(ms = SYNC_EVERY_MS) {
      if (!client.configured || timer) return;
      void google.sync();
      timer = setInterval(() => void google.sync(), ms);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      clearTimeout(nudge);
      timer = null;
    },
  };
  return google;
}
