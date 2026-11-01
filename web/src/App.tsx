import { useEffect, useState } from "react";
import { api } from "./api";
import { t, plural, Key } from "./i18n";
import { getRole, setRole as saveRole, Role, inTestMode, setTestMode } from "./role";
import { useHashRoute } from "./hooks";
import { HomeScreen } from "./screens/Home";
import { EndOfDayScreen } from "./screens/EndOfDay";
import { GroceryScreen } from "./screens/Grocery";
import { RequestsScreen } from "./screens/Requests";
import { ScheduleScreen } from "./screens/Schedule";
import { TasksScreen } from "./screens/Tasks";
import { TaskFormScreen } from "./screens/TaskForm";
import { CalendarScreen } from "./screens/Calendar";
import { HistoryScreen } from "./screens/History";
import { SettingsScreen } from "./screens/Settings";
import type { TestMode } from "./types";
import { dayLong } from "./format";
import { PageHeader, Tone } from "./components/ui";
import { Icon, IconName } from "./components/icons";

function browserToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function WhoAreYou({ onPick, current }: { onPick: (r: Role) => void; current: Role | null }) {
  return (
    <main className="who">
      <div className="who-card">
        <span className="brand-mark big" aria-hidden="true"><Icon name="home" size={32} /></span>
        <p className="who-app">{t("app.title")}</p>
        <h1>{t("who.question")}</h1>
        <div className="who-tiles">
          <button type="button" className={`who-tile${current === "housekeeper" ? " on" : ""}`} onClick={() => onPick("housekeeper")}>
            <Icon name="user" size={36} />{t("who.housekeeper")}
          </button>
          <button type="button" className={`who-tile${current === "family" ? " on" : ""}`} onClick={() => onPick("family")}>
            <Icon name="users" size={36} />{t("who.family")}
          </button>
        </div>
        {current && <a className="btn secondary" href="#/">{t("action.cancel")}</a>}
        <p className="hint">{t("who.hint")}</p>
      </div>
    </main>
  );
}

type NavItem = { to: string; key: Key; icon: IconName; id: string; familyOnly?: boolean; tone: Tone };
// Sidebar (tablet) shows everything; the phone tab bar shows the first three plus "More".
const NAV: NavItem[] = [
  { id: "home", to: "/", key: "nav.home", icon: "home", tone: "tasks" },
  { id: "requests", to: "/requests", key: "nav.requests", icon: "inbox", tone: "request" },
  { id: "schedule", to: "/schedule", key: "nav.schedule", icon: "clock", tone: "schedule" },
  { id: "calendar", to: "/calendar", key: "home.calendar", icon: "calendar", tone: "schedule" },
  { id: "tasks", to: "/tasks", key: "nav.tasks", icon: "list", familyOnly: true, tone: "tasks" },
  { id: "history", to: "/history", key: "nav.history", icon: "history", familyOnly: true, tone: "neutral" },
  { id: "settings", to: "/settings", key: "nav.settings", icon: "sliders", familyOnly: true, tone: "neutral" },
];

function More({ role }: { role: Role }) {
  return (
    <>
      <PageHeader title={t("nav.more")} />
      <ul className="card list-card">
        {NAV.slice(3).filter((n) => role === "family" || !n.familyOnly).map((n) => (
          <li key={n.id}>
            <a className="link-row" href={`#${n.to}`}>
              <span className="link-icon" data-tone={n.tone}><Icon name={n.icon} /></span>
              <span className="grow row-title">{t(n.key)}</span>
              <Icon name="right" size={20} />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export function App() {
  const [role, setRoleState] = useState<Role | null>(getRole);
  const [route, go] = useHashRoute();
  const [today, setToday] = useState("");
  const [waiting, setWaiting] = useState(0);
  const [hkName, setHkName] = useState<string | null>(null);
  const [testing, setTesting] = useState<TestMode | null>(null);

  // "Today" always comes from the house computer so every device agrees on the date.
  useEffect(() => {
    if (!role) return;
    const load = () => {
      api<{ today: string; requests_waiting: unknown[]; housekeeper_name: string | null }>("/home")
        .then((h) => { setToday(h.today); setWaiting(h.requests_waiting.length); setHkName(h.housekeeper_name); }).catch(() => undefined);
      // This device may think it is in test mode after the server dropped the sandbox (e.g. a restart).
      api<TestMode>("/test-mode").then((m) => {
        if (inTestMode() && !m.active) setTestMode(false);
        setTesting(inTestMode() && m.active ? m : null);
      }).catch(() => undefined);
    };
    void load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [role, route]);

  if (!role) {
    return <WhoAreYou current={role} onPick={(r) => { saveRole(r); setRoleState(r); go("/"); }} />;
  }

  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  const active = NAV.slice(1).find((n) => path.startsWith(n.to))?.id ?? (path === "/end-of-day" ? "home" : path === "/more" ? "more" : "home");
  const tab = ["home", "requests", "schedule"].includes(active) ? active : "more";
  const badge = role === "family" && waiting > 0
    ? <span className="badge" aria-label={plural("home.requestsWaiting", waiting)}>{waiting}</span> : null;
  const roleName = role === "family" ? t("who.family") : hkName ?? t("who.housekeeper");
  // One tap flips the view; anyone (including the housekeeper) may use the family view.
  const flipRole = () => { const next: Role = role === "family" ? "housekeeper" : "family"; saveRole(next); setRoleState(next); };

  let screen;
  if (path === "/groceries") screen = <GroceryScreen />;
  else if (path === "/requests") screen = <RequestsScreen role={role} />;
  else if (path === "/more") screen = <More role={role} />;
  else if (path === "/schedule") screen = <ScheduleScreen role={role} />;
  else if (path === "/calendar") screen = <CalendarScreen role={role} />;
  else if (path === "/end-of-day" && role === "housekeeper") screen = <EndOfDayScreen go={go} />;
  else if (role === "family" && path === "/tasks") screen = <TasksScreen />;
  else if (role === "family" && path === "/tasks/new") screen = <TaskFormScreen key="new" id={null} presetDate={params.get("date")} today={today || browserToday()} go={go} />;
  else if (role === "family" && /^\/tasks\/\d+$/.test(path)) screen = <TaskFormScreen key={path} id={Number(path.split("/")[2])} presetDate={null} today={today || browserToday()} go={go} />;
  else if (role === "family" && path === "/history") screen = <HistoryScreen />;
  else if (role === "family" && path === "/settings") screen = <SettingsScreen onTestModeChange={setTesting} />;
  else screen = <HomeScreen role={role} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden="true"><Icon name="home" size={22} /></span><span className="brand-name">{t("app.title")}</span></div>
        <nav className="side-nav" aria-label={t("nav.label")}>
          {NAV.filter((n) => role === "family" || !n.familyOnly).map((n) => (
            <a key={n.id} href={`#${n.to}`} className={active === n.id ? "on" : ""} aria-current={active === n.id ? "page" : undefined} data-tone={n.tone}>
              <Icon name={n.icon} /><span className="nav-text">{t(n.key)}</span>{n.id === "requests" && badge}
            </a>
          ))}
        </nav>
        <button type="button" className="role-btn" onClick={flipRole} aria-label={t("who.switchTo", { who: role === "family" ? hkName ?? t("who.housekeeper") : t("who.family") })}>
          <span className="avatar"><Icon name={role === "family" ? "users" : "user"} size={20} /></span>
          <span className="nav-text">{roleName}</span>
          <Icon name="swap" size={18} />
        </button>
      </aside>

      <header className="top">
        <span className="brand"><span className="brand-mark" aria-hidden="true"><Icon name="home" size={20} /></span><span className="brand-name">{t("app.title")}</span></span>
        <button type="button" className="role-chip" onClick={flipRole} aria-label={t("who.switchTo", { who: role === "family" ? hkName ?? t("who.housekeeper") : t("who.family") })}>
          <Icon name={role === "family" ? "users" : "user"} size={18} />{roleName}<Icon name="swap" size={16} />
        </button>
      </header>

      <main className="content">
        {testing && (
          <div className="test-banner" role="status">
            <Icon name="flask" size={22} />
            <span className="grow"><strong>{t("test.banner")}</strong> {t("test.pretending", { date: dayLong(testing.date ?? today) })}</span>
            {role === "family" && <a className="btn secondary small" href="#/settings">{t("test.change")}</a>}
          </div>
        )}
        {screen}
      </main>

      <nav className="tabs" aria-label={t("nav.label")}>
        {NAV.slice(0, 3).map((n) => (
          <a key={n.id} href={`#${n.to}`} className={tab === n.id ? "on" : ""} aria-current={tab === n.id ? "page" : undefined} data-tone={n.tone}>
            <span className="tab-icon"><Icon name={n.icon} />{n.id === "requests" && badge}</span>{t(n.key)}
          </a>
        ))}
        <a href="#/more" className={tab === "more" ? "on" : ""} aria-current={tab === "more" ? "page" : undefined}>
          <span className="tab-icon"><Icon name="more" /></span>{t("nav.more")}
        </a>
      </nav>
    </div>
  );
}
