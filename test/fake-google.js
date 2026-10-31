// An in-memory stand-in for Google's OAuth and Calendar APIs, used as `fetch` by the Google client.
// Only what the hub uses: tokens, calendar list, calendars.insert, events list/insert/patch/delete,
// sync tokens (events changed since a version) and deleted events showing as "cancelled".
export function fakeGoogle({ email = "bill@example.com" } = {}) {
  let seq = 1;
  const calendars = new Map(); // id -> { summary, accessRole, backgroundColor, primary, events: Map }
  const calls = [];
  let revoked = false;

  const addCalendar = (id, props = {}) => {
    calendars.set(id, { summary: id, accessRole: "owner", backgroundColor: "#4986e7", events: new Map(), ...props });
    return id;
  };
  addCalendar(email, { summary: email, primary: true });

  const put = (cal, ev) => {
    const v = ++seq;
    const stored = { ...ev, _v: v, etag: `"${v}"` };
    calendars.get(cal).events.set(ev.id, stored);
    return stored;
  };
  const insert = (cal, body) => put(cal, { ...body, id: `ev${++seq}`, status: "confirmed" });
  const patch = (cal, id, body) => {
    const cur = calendars.get(cal)?.events.get(id);
    if (!cur || cur.status === "cancelled") return null;
    return put(cal, { ...cur, ...body });
  };
  const remove = (cal, id) => {
    const cur = calendars.get(cal)?.events.get(id);
    if (!cur || cur.status === "cancelled") return false;
    put(cal, { ...cur, status: "cancelled" });
    return true;
  };
  const clean = ({ _v, ...ev }) => ev;
  const startOf = (ev) => ev.start?.date ?? ev.start?.dateTime?.slice(0, 10) ?? "";

  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = init.method ?? "GET";
    calls.push(`${method} ${u.pathname}`);
    if (u.host === "oauth2.googleapis.com") {
      const f = new URLSearchParams(init.body);
      if (u.pathname === "/revoke") { revoked = true; return reply(200, {}); }
      if (f.get("grant_type") === "authorization_code") {
        if (f.get("code") !== "good-code") return reply(400, { error: "invalid_grant" });
        const idToken = ["x", Buffer.from(JSON.stringify({ email })).toString("base64url"), "y"].join(".");
        return reply(200, { access_token: "at", refresh_token: "rt", expires_in: 3600, id_token: idToken });
      }
      if (revoked) return reply(400, { error: "invalid_grant" });
      return reply(200, { access_token: "at", expires_in: 3600 });
    }
    if (init.headers?.authorization !== "Bearer at") return reply(401, { error: { message: "no token" } });
    const body = init.body ? JSON.parse(init.body) : null;
    const path = u.pathname.replace("/calendar/v3", "").split("/").map(decodeURIComponent);
    // ["", "users", "me", "calendarList"]
    if (path[1] === "users") {
      return reply(200, { items: [...calendars].map(([id, c]) => ({ id, summary: c.summary, accessRole: c.accessRole, backgroundColor: c.backgroundColor, primary: !!c.primary })) });
    }
    // ["", "calendars"] (insert) or ["", "calendars", id, "events", eventId?]
    if (path.length === 2 && method === "POST") {
      const id = addCalendar(`hub${++seq}@group.calendar.google.com`, { summary: body.summary });
      return reply(200, { id, summary: body.summary });
    }
    const cal = calendars.get(path[2]);
    if (!cal) return reply(404, { error: { message: "Not Found" } });
    const eventId = path[4];
    if (method === "GET") {
      const q = u.searchParams;
      let items = [...cal.events.values()];
      if (q.get("syncToken")) items = items.filter((e) => e._v > Number(q.get("syncToken")));
      else {
        if (q.get("showDeleted") !== "true") items = items.filter((e) => e.status !== "cancelled");
        if (q.get("timeMin")) items = items.filter((e) => startOf(e) >= q.get("timeMin").slice(0, 10) || (e.end?.date ?? e.end?.dateTime ?? "").slice(0, 10) > q.get("timeMin").slice(0, 10));
        if (q.get("timeMax")) items = items.filter((e) => startOf(e) < q.get("timeMax").slice(0, 10));
      }
      return reply(200, { items: items.map(clean), nextSyncToken: String(seq) });
    }
    if (method === "POST") return reply(200, clean(insert(path[2], body)));
    if (method === "PATCH") {
      const ev = patch(path[2], eventId, body);
      return ev ? reply(200, clean(ev)) : reply(404, { error: { message: "Not Found" } });
    }
    if (method === "DELETE") return remove(path[2], eventId) ? reply(204) : reply(410, { error: { message: "Deleted" } });
    return reply(400, { error: { message: "unsupported" } });
  }

  return {
    fetch: fetchImpl,
    calls,
    calendars,
    addCalendar,
    get revoked() { return revoked; },
    /** Events (not deleted) on a calendar. */
    events: (cal) => [...(calendars.get(cal)?.events.values() ?? [])].filter((e) => e.status !== "cancelled").map(clean),
    // Edits "made in Google" by a person:
    userInsert: (cal, body) => clean(insert(cal, body)),
    userPatch: (cal, id, body) => clean(patch(cal, id, body)),
    userDelete: (cal, id) => remove(cal, id),
    get version() { return seq; },
  };
}
