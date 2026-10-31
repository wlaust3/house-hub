// A small Google OAuth + Calendar REST client (plain fetch, no SDK).
//
// One Google account is linked to the hub. Its refresh token lives in the database
// (google_link); access tokens are kept in memory and refreshed when they run out.
import crypto from "node:crypto";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
export const API = "https://www.googleapis.com/calendar/v3";
// Full calendar access: the hub creates its own calendar and edits events on the family's calendars.
const SCOPES = "openid email https://www.googleapis.com/auth/calendar";

export class GoogleError extends Error {
  constructor(status, message, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

/** Google said the link is no longer valid (revoked, password changed, app removed). */
export const isRevoked = (e) => e instanceof GoogleError && (e.reason === "invalid_grant" || e.status === 401);

export function googleClient({ clientId, clientSecret, fetchImpl = fetch }) {
  let access = null; // { token, expires, refreshToken }

  async function call(url, init) {
    const res = await fetchImpl(url, init);
    if (res.status === 204) return null;
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const reason = body?.error?.errors?.[0]?.reason ?? (typeof body?.error === "string" ? body.error : undefined);
      throw new GoogleError(res.status, body?.error?.message ?? body?.error_description ?? `Google said HTTP ${res.status}`, reason);
    }
    return body;
  }

  const form = (fields) => ({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

  return {
    configured: !!(clientId && clientSecret),

    authUrl(redirectUri, state) {
      const q = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES,
        access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
      });
      return `${AUTH}?${q}`;
    },

    /** Trade the sign-in code for tokens. Returns { refreshToken, email }. */
    async exchangeCode(code, redirectUri) {
      const t = await call(TOKEN, form({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }));
      if (!t.refresh_token) throw new GoogleError(400, "Google did not give the hub lasting access. Try connecting again.");
      let email = null;
      try { email = JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()).email ?? null; } catch { /* no id token */ }
      access = { token: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000, refreshToken: t.refresh_token };
      return { refreshToken: t.refresh_token, email };
    },

    async revoke(refreshToken) {
      access = null;
      try { await call(REVOKE, form({ token: refreshToken })); } catch { /* already gone */ }
    },

    /** A Calendar API request: request(refreshToken, "GET", "/users/me/calendarList", { query, body }). */
    async request(refreshToken, method, path, { query, body } = {}) {
      if (!access || access.refreshToken !== refreshToken || access.expires < Date.now()) {
        const t = await call(TOKEN, form({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }));
        access = { token: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000, refreshToken };
      }
      const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null))}` : "";
      return call(`${API}${path}${qs}`, {
        method,
        headers: { authorization: `Bearer ${access.token}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    },
  };
}

export const newState = () => crypto.randomBytes(18).toString("base64url");
