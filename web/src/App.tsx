import { useEffect, useState } from "react";
import { api } from "./api";
import { t, plural } from "./i18n";
import { getRole, setRole as saveRole, Role } from "./role";
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
import { LinkButton } from "./components/ui";

function browserToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function WhoAreYou({ onPick, current }: { onPick: (r: Role) => void; current: Role | null }) {
  return (
    <main className="who">
      <h1>{t("app.title")}</h1>
      <h2>{t("who.question")}</h2>
      <button type="button" className="btn primary" onClick={() => onPick("housekeeper")}>{t("who.housekeeper")}</button>
      <button type="button" className="btn choice" onClick={() => onPick("family")}>{t("who.family")}</button>
      {current && <a className="btn secondary" href="#/">{t("action.cancel")}</a>}
      <p className="hint">{t("who.hint")}</p>
    </main>
  );
}

function More({ role }: { role: Role }) {
  return (
    <>
      <h2>{t("nav.more")}</h2>
      <div className="stack">
        {role === "family" && <LinkButton to="/tasks">{t("nav.tasks")}</LinkButton>}
        <LinkButton to="/schedule">{t("nav.schedule")}</LinkButton>
        <LinkButton to="/calendar">{t("home.calendar")}</LinkButton>
        {role === "family" && <LinkButton to="/history">{t("nav.history")}</LinkButton>}
      </div>
    </>
  );
}

export function App() {
  const [role, setRoleState] = useState<Role | null>(getRole);
  const [changing, setChanging] = useState(false);
  const [route, go] = useHashRoute();
  const [today, setToday] = useState("");
  const [waiting, setWaiting] = useState(0);

  // "Today" always comes from the house computer so every device agrees on the date.
  useEffect(() => {
    if (!role) return;
    const load = () => api<{ today: string; requests_waiting: unknown[] }>("/home").then((h) => { setToday(h.today); setWaiting(h.requests_waiting.length); }).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [role, route]);

  if (!role || changing) {
    return <WhoAreYou current={role} onPick={(r) => { saveRole(r); setRoleState(r); setChanging(false); go("/"); }} />;
  }

  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  const tab = path.startsWith("/groceries") ? "groceries" : path.startsWith("/requests") ? "requests"
    : ["/more", "/schedule", "/tasks", "/history"].some((p) => path.startsWith(p)) ? "more" : "home";

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
  else screen = <HomeScreen role={role} />;

  return (
    <>
      <header className="top">
        <span className="brand">{t("app.title")}</span>
        <button type="button" className="btn secondary who-btn" onClick={() => setChanging(true)} aria-label={t("who.change")}>
          {role === "family" ? t("who.family") : t("who.housekeeper")} <span aria-hidden="true">▾</span>
        </button>
      </header>
      <main>{screen}</main>
      <nav className="tabs" aria-label={t("nav.label")}>
        <a href="#/" className={tab === "home" ? "on" : ""} aria-current={tab === "home" ? "page" : undefined}>{t("nav.home")}</a>
        <a href="#/groceries" className={tab === "groceries" ? "on" : ""} aria-current={tab === "groceries" ? "page" : undefined}>{t("nav.groceries")}</a>
        <a href="#/requests" className={tab === "requests" ? "on" : ""} aria-current={tab === "requests" ? "page" : undefined}>
          {t("nav.requests")}
          {role === "family" && waiting > 0 && <span className="badge" aria-label={plural("home.requestsWaiting", waiting)}>{waiting}</span>}
        </a>
        <a href="#/more" className={tab === "more" ? "on" : ""} aria-current={tab === "more" ? "page" : undefined}>{t("nav.more")}</a>
      </nav>
    </>
  );
}
