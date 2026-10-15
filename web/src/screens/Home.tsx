import { useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { Home, Item } from "../types";
import type { Role } from "../role";
import { dayLabel, dayLong, weekdayName } from "../format";
import { CheckRow, ErrorBanner, LinkButton, SecondaryButton, Section, carriedText, whenDone } from "../components/ui";

const REASON_KEY = {
  appointment: "out.reason.appointment",
  sick: "out.reason.sick",
  other: "out.reason.other",
} as const;

export function HomeScreen({ role }: { role: Role }) {
  const { data, setData, error, reload } = useLoad(() => api<Home>("/home"), [], 10000);
  const [problem, setProblem] = useState<string | null>(null);
  const [askReason, setAskReason] = useState(false);

  if (!data) return <p className="hint">{error ?? t("common.loading")}</p>;
  const h = data;

  const toggle = async (item: Item) => {
    const done = item.status !== "done";
    setData({ ...h, today_items: h.today_items.map((i) => (i.id === item.id ? { ...i, status: done ? "done" : "pending" } : i)) });
    try {
      await api(`/instances/${item.id}`, "PATCH", { done });
      setProblem(null);
    } catch (e) {
      setProblem(errorText(e));
    }
    void reload();
  };
  const saveNote = async (item: Item, note: string) => {
    try {
      await api(`/instances/${item.id}`, "PATCH", { note });
      await reload();
    } catch (e) {
      setProblem(errorText(e));
      throw e;
    }
  };
  const markOut = async (reason: keyof typeof REASON_KEY) => {
    try {
      await api("/days-out", "POST", { date: h.cant_come_date, reason });
      setAskReason(false);
      setProblem(null);
    } catch (e) {
      setProblem(errorText(e));
    }
    void reload();
  };
  const undoOut = async (date: string) => {
    try {
      await api(`/days-out/${date}`, "DELETE");
    } catch (e) {
      setProblem(errorText(e));
    }
    void reload();
  };
  const reopen = async () => {
    try {
      await api(`/visits/${h.today}`, "DELETE");
    } catch (e) {
      setProblem(errorText(e));
    }
    void reload();
  };

  const rows = (items: Item[], editable: boolean) =>
    items.map((i) => (
      <CheckRow
        key={i.id}
        checked={i.status === "done"}
        title={i.title}
        carried={carriedText(i)}
        sub={whenDone(i)}
        note={i.note}
        onToggle={editable ? () => void toggle(i) : undefined}
        readOnly={!editable}
        onSaveNote={(n) => saveNote(i, n)}
      />
    ));

  const outBanner = (date: string, reason: keyof typeof REASON_KEY, note: string) => (
    <div className="card out" key={date}>
      <p className="card-title">
        {role === "family"
          ? t("out.familyBanner", { day: dayLabel(date, h.today), reason: t(REASON_KEY[reason]) })
          : t("out.youBanner", { day: dayLabel(date, h.today), reason: t(REASON_KEY[reason]) })}
      </p>
      {note && <p className="hint">{note}</p>}
      <SecondaryButton onClick={() => void undoOut(date)}>{t("out.undo")}</SecondaryButton>
    </div>
  );

  const familyOuts = role === "family" ? h.coming_up.filter((c) => c.out) : [];

  return (
    <>
      <ErrorBanner message={problem ?? error} />

      {role === "family" && h.requests_waiting.length > 0 && (
        <LinkButton to="/requests" primary>
          {plural("home.requestsWaiting", h.requests_waiting.length)}
        </LinkButton>
      )}

      {/* ---------- Today ---------- */}
      <Section title={h.visit.regular ? `${t("home.today")} · ${dayLong(h.today)}` : t("home.today")}>
        {h.visit.out && outBanner(h.today, h.visit.out.reason, h.visit.out.note)}
        {!h.visit.regular && (
          <div className="card">
            <p className="card-title">{t("home.nextVisit", { day: dayLabel(h.next_visit, h.today) })}</p>
            <p className="hint">{t("home.notVisitDay")}</p>
          </div>
        )}
        {h.visit.closed && (
          <div className="card ok">
            <p className="card-title">{t("home.finished")}</p>
            <p className="hint">{t("home.nextVisit", { day: dayLabel(h.next_visit, h.today) })}</p>
            {role === "housekeeper" && <SecondaryButton onClick={() => void reopen()}>{t("home.reopen")}</SecondaryButton>}
          </div>
        )}
        {(h.visit.open || h.visit.closed) && h.today_items.length === 0 && <p className="empty">{t("home.nothingToday")}</p>}
        {(h.visit.open || h.visit.closed) && h.today_items.length > 0 && (
          <ul className="check-list">{rows(h.today_items, h.visit.open || h.visit.closed)}</ul>
        )}
      </Section>

      {/* One dominant action per screen */}
      {role === "housekeeper" ? (
        h.visit.open ? <LinkButton to="/end-of-day" primary>{t("home.beforeLeave")}</LinkButton> : <LinkButton to="/groceries" primary>{t("nav.groceries")}</LinkButton>
      ) : (
        <LinkButton to="/tasks/new" primary={h.requests_waiting.length === 0}>{t("home.addTask")}</LinkButton>
      )}

      {role === "housekeeper" && !askReason && (
        <SecondaryButton onClick={() => setAskReason(true)}>{t("home.cantCome", { day: dayLabel(h.cant_come_date, h.today) })}</SecondaryButton>
      )}
      {role === "housekeeper" && askReason && (
        <div className="card">
          <p className="card-title">{t("out.why", { day: dayLabel(h.cant_come_date, h.today) })}</p>
          <div className="stack">
            {(Object.keys(REASON_KEY) as (keyof typeof REASON_KEY)[]).map((r) => (
              <button key={r} type="button" className="btn choice" onClick={() => void markOut(r)}>{t(REASON_KEY[r])}</button>
            ))}
            <SecondaryButton onClick={() => setAskReason(false)}>{t("action.back")}</SecondaryButton>
          </div>
        </div>
      )}
      <LinkButton to="/calendar">{t("home.calendar")}</LinkButton>

      {/* ---------- Coming up ---------- */}
      <Section title={t("home.comingUp")}>
        {role === "family" && familyOuts.length > 0 && (
          <p className="hint">{t("home.outHint")}</p>
        )}
        {h.coming_up.length === 0 && <p className="empty">{t("home.nothingComing")}</p>}
        {h.coming_up.map((c) => (
          <div key={c.date} className="day-block">
            <h3 className="day-heading">{dayLong(c.date)}</h3>
            {c.out ? outBanner(c.date, c.out.reason, c.out.note) : c.items.length === 0 ? <p className="empty">{t("home.nothingPlanned")}</p> : <ul className="check-list">{rows(c.items, false)}</ul>}
          </div>
        ))}
      </Section>

      {h.due_soon.length > 0 && (
        <Section title={t("home.dueSoon")} hint={t("home.dueSoonHint")}>
          <ul className="check-list">
            {h.due_soon.map((i) => (
              <CheckRow key={i.id} checked={false} readOnly title={i.title} note={i.note}
                sub={t("task.dueOn", { day: weekdayName(i.due_date) }) + " · " + t("task.seenOn", { day: weekdayName(i.visit_date) })}
                carried={carriedText(i)} />
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
