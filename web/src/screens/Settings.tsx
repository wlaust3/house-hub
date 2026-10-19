import { FormEvent, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { Member, MemberRole, TestMode } from "../types";
import { inTestMode, setTestMode } from "../role";
import { dayLong } from "../format";
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
  const save = async () => {
    try { onSaved(await api<Member[]>(`/members/${m.id}`, "PATCH", { name, role })); setEditing(false); setProblem(null); } catch (e) { setProblem(errorText(e)); }
  };
  const remove = async () => {
    try { onSaved(await api<Member[]>(`/members/${m.id}`, "DELETE")); setProblem(null); } catch (e) { setProblem(errorText(e)); }
  };
  if (!editing) {
    return (
      <li>
        <button type="button" className="link-row" onClick={() => { setName(m.name); setRole(m.role); setEditing(true); }}>
          <span className="link-icon"><Icon name={m.role === "housekeeper" ? "user" : "users"} /></span>
          <span className="grow row-title">{m.name}</span>
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
          <TestModeCard onChange={onTestModeChange} />
          <LinkButton to="/history" icon="history">{t("settings.history")}</LinkButton>
        </div>
      </div>
    </>
  );
}
