import { FormEvent, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { GoogleCalendarChoice, GoogleStatus, Member, MemberRole, TestMode } from "../types";
import { inTestMode, setTestMode } from "../role";
import { dayLong, stamp } from "../format";
import { ErrorBanner, LinkButton, PageHeader, PrimaryButton, SecondaryButton, Section } from "../components/ui";
import { Icon } from "../components/icons";

const ROLE_KEY = {
  housekeeper: "member.role.housekeeper",
  adult: "member.role.adult",
  child: "member.role.child",
  baby: "member.role.baby",
} as const;
const ROLES = Object.keys(ROLE_KEY) as MemberRole[];

function RolePicker({ value, onChange }: { value: MemberRole; onChange: (r: MemberRole) => void }) {
  return (
    <div className="segmented wrap" role="group" aria-label={t("member.roleLabel")}>
      {ROLES.map((r) => (
        <button key={r} type="button" className={`btn${value === r ? " on" : ""}`} aria-pressed={value === r} onClick={() => onChange(r)}>{t(ROLE_KEY[r])}</button>
      ))}
    </div>
  );
}

function MemberRow({ m, onSaved, setProblem }: { m: Member; onSaved: (list: Member[]) => void; setProblem: (s: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);
  const [role, setRole] = useState<MemberRole>(m.role);
  const [email, setEmail] = useState(m.email ?? "");
  const canSignIn = role === "housekeeper" || role === "adult";
  const save = async () => {
    try { onSaved(await api<Member[]>(`/members/${m.id}`, "PATCH", { name, role, email: canSignIn ? email : "" })); setEditing(false); setProblem(null); } catch (e) { setProblem(errorText(e)); }
  };
  const remove = async () => {
    try { onSaved(await api<Member[]>(`/members/${m.id}`, "DELETE")); setProblem(null); } catch (e) { setProblem(errorText(e)); }
  };
  if (!editing) {
    return (
      <li>
        <button type="button" className="link-row" onClick={() => { setName(m.name); setRole(m.role); setEmail(m.email ?? ""); setEditing(true); }}>
          <span className="link-icon"><Icon name={m.role === "housekeeper" ? "user" : "users"} /></span>
          <span className="grow">
            <span className="row-title">{m.name}</span>
            {m.email && <span className="row-sub">{m.email}</span>}
          </span>
          <span className={`tag role-${m.role}`}>{t(ROLE_KEY[m.role])}</span>
          <Icon name="note" size={20} />
        </button>
      </li>
    );
  }
  return (
    <li className="member-edit">
      <label className="field">
        <span>{t("member.nameLabel")}</span>
        <input type="text" value={name} maxLength={60} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </label>
      <RolePicker value={role} onChange={setRole} />
      {canSignIn && (
        <label className="field">
          <span>{t("member.emailLabel")}</span>
          <input type="email" value={email} maxLength={200} autoComplete="off" inputMode="email" onChange={(e) => setEmail(e.target.value)} />
          <span className="hint">{t("member.emailHint")}</span>
        </label>
      )}
      <div className="btn-row">
        <button type="button" className="btn primary small" onClick={() => void save()}>{t("action.save")}</button>
        <SecondaryButton onClick={() => setEditing(false)}>{t("action.cancel")}</SecondaryButton>
        <SecondaryButton danger onClick={() => void remove()}>{t("member.remove")}</SecondaryButton>
      </div>
    </li>
  );
}

function TestModeCard({ onChange }: { onChange: (m: TestMode | null) => void }) {
  const { data, setData, error } = useLoad(() => api<TestMode>("/test-mode"), [], 0);
  const [date, setDate] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (!data) return <p className="hint">{error ?? t("common.loading")}</p>;
  const here = inTestMode() && data.active;
  const pick = date || data.date || data.real_today;

  const start = async () => {
    try {
      const m = await api<TestMode>("/test-mode", "POST", { date: pick });
      setTestMode(true); setData(m); onChange(m); setProblem(null);
      window.location.reload(); // every screen re-reads from the sandbox
    } catch (e) { setProblem(errorText(e)); }
  };
  const leave = async () => {
    try {
      const m = await api<TestMode>("/test-mode", "DELETE");
      setTestMode(false); setData(m); onChange(null); setDate("");
      window.location.reload(); // back to the real data
    } catch (e) { setProblem(errorText(e)); }
  };

  return (
    <Section title={t("test.title")} icon="flask" hint={t("test.hint")}>
      <ErrorBanner message={problem} />
      {here && <p className="banner info">{t("test.pretending", { date: dayLong(data.date!) })}</p>}
      <div className="field-row">
        <label className="field">
          <span>{t("test.dateLabel")}</span>
          <input type="date" value={pick} onChange={(e) => setDate(e.target.value)} />
        </label>
        <PrimaryButton onClick={() => void start()}>{here ? t("test.changeDate") : t("test.start")}</PrimaryButton>
      </div>
      {data.active && <SecondaryButton danger onClick={() => void leave()}><Icon name="trash" size={20} />{t("test.leave")}</SecondaryButton>}
    </Section>
  );
}

/** Connect the family's Google account, choose the calendars the hub shows, sync, disconnect. */
function GoogleCard() {
  const { data, setData, error } = useLoad(() => api<GoogleStatus>("/google"), [], 30000);
  const [choices, setChoices] = useState<GoogleCalendarChoice[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [problem, setProblem] = useState<string | null>(() => (window.location.hash.includes("google=failed") ? t("google.failed") : null));
  const connected = !!data?.connected;

  // The calendar list comes straight from Google, so only ask once connected.
  const { data: list } = useLoad(() => (connected ? api<GoogleCalendarChoice[]>("/google/calendars") : Promise.resolve(null)), [connected], 0);
  if (list && choices !== list) { setChoices(list); setPicked(new Set(list.filter((c) => c.selected).map((c) => c.calendar_id))); }

  const run = async (fn: () => Promise<GoogleStatus | void>) => {
    setBusy(true);
    try { const s = await fn(); if (s) setData(s); setProblem(null); } catch (e) { setProblem(errorText(e)); }
    setBusy(false);
  };
  const connect = () => run(async () => {
    const { url } = await api<{ url: string }>("/google/connect", "POST", { origin: window.location.origin });
    window.location.href = url;
  });
  const togglePick = (id: string) => { const next = new Set(picked); if (next.has(id)) next.delete(id); else next.add(id); setPicked(next); };

  let body;
  if (!data) body = <p className="hint">{error ?? t("common.loading")}</p>;
  else if (!data.available) body = <p className="hint">{t("google.testMode")}</p>;
  else if (!data.configured) body = <p className="hint">{t("google.notSetUp")}</p>;
  else if (!connected) {
    body = <PrimaryButton onClick={() => void connect()} disabled={busy}><Icon name="calendar" size={20} />{t("google.connect")}</PrimaryButton>;
  } else {
    body = (
      <>
        <p>{t("google.connectedAs", { name: data.email ?? "" })}</p>
        {data.last_error ? <p className="banner error">{data.last_error}</p>
          : data.last_sync_at && <p className="hint">{t("google.lastSync", { when: stamp(data.last_sync_at) })}</p>}
        <p className="mini-head">{t("google.showLabel")}</p>
        {!choices ? <p className="hint">{t("common.loading")}</p> : (
          <div className="cal-list">
            {choices.map((c) => (
              <label key={c.calendar_id} className="cal-choice">
                <input type="checkbox" checked={picked.has(c.calendar_id)} onChange={() => togglePick(c.calendar_id)} />
                <span className="event-dot" style={{ background: c.color ?? "var(--t-event)" }} aria-hidden="true" />
                <span className="grow"><span className="row-title">{c.name}</span>{!c.writable && <span className="row-sub">{t("google.readOnly")}</span>}</span>
              </label>
            ))}
          </div>
        )}
        <div className="btn-row">
          <button type="button" className="btn primary small" disabled={busy || !choices}
            onClick={() => void run(() => api<GoogleStatus>("/google/calendars", "PUT", { ids: [...picked] }))}>{t("google.saveChoice")}</button>
          <SecondaryButton disabled={busy} onClick={() => void run(() => api<GoogleStatus>("/google/sync", "POST", {}))}>{t("google.syncNow")}</SecondaryButton>
        </div>
        {confirmOff ? (
          <div className="card warn" role="alert">
            <p className="card-title">{t("google.disconnectConfirm")}</p>
            <div className="btn-row">
              <SecondaryButton danger onClick={() => { setConfirmOff(false); void run(() => api<GoogleStatus>("/google", "DELETE")); }}>{t("google.disconnect")}</SecondaryButton>
              <SecondaryButton onClick={() => setConfirmOff(false)}>{t("action.cancel")}</SecondaryButton>
            </div>
          </div>
        ) : <SecondaryButton danger onClick={() => setConfirmOff(true)}>{t("google.disconnect")}</SecondaryButton>}
      </>
    );
  }

  return (
    <Section title={t("google.title")} icon="calendar" tone="event" hint={t("google.hint")}>
      <ErrorBanner message={problem} />
      {body}
    </Section>
  );
}

export function SettingsScreen({ onTestModeChange }: { onTestModeChange: (m: TestMode | null) => void }) {
  const { data, setData, error } = useLoad(() => api<Member[]>("/members"), [], 0);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("adult");

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { setData(await api<Member[]>("/members", "POST", { name: name.trim(), role })); setName(""); setProblem(null); } catch (err) { setProblem(errorText(err)); }
  };

  return (
    <>
      <PageHeader back={<a className="back phone-only" href="#/more"><Icon name="left" size={22} /> {t("nav.more")}</a>} title={t("settings.title")} />
      <ErrorBanner message={problem ?? error} />
      <div className="cols even">
        <Section title={t("member.title")} icon="users" hint={t("member.hint")}>
          {data && (
            <ul className="check-list link-list">
              {data.map((m) => <MemberRow key={m.id} m={m} onSaved={setData} setProblem={setProblem} />)}
            </ul>
          )}
          <form className="add-form" onSubmit={add}>
            <label className="field">
              <span>{t("member.addLabel")}</span>
              <input type="text" value={name} maxLength={60} autoComplete="off" onChange={(e) => setName(e.target.value)} />
            </label>
            <RolePicker value={role} onChange={setRole} />
            <button type="submit" className="btn secondary"><Icon name="plus" size={20} />{t("member.add")}</button>
          </form>
        </Section>
        <div className="side">
          <GoogleCard />
          <TestModeCard onChange={onTestModeChange} />
          <LinkButton to="/history" icon="history">{t("settings.history")}</LinkButton>
        </div>
      </div>
    </>
  );
}
