import { useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { Home, Item } from "../types";
import type { Role } from "../role";
import { dayHeading, dayLabel, dayLong, weekdayName } from "../format";
import { CheckRow, ErrorBanner, LinkButton, PageHeader, SecondaryButton, Section, carriedText, whenDone } from "../components/ui";
import { Icon } from "../components/icons";

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
  const total = h.today_items.length;
  const doneCount = h.today_items.filter((i) => i.status === "done").length;
  const showList = h.visit.open || h.visit.closed;

  return (
    <>
      <PageHeader
        title={dayLong(h.today)}
        sub={h.visit.regular ? undefined : t("home.nextVisit", { day: dayLabel(h.next_visit, h.today) })}
        actions={role === "family" ? <LinkButton to="/tasks/new" icon="plus" primary={h.requests_waiting.length === 0}>{t("home.addTask")}</LinkButton> : undefined}
      />
      <ErrorBanner message={problem ?? error} />

      {role === "family" && h.requests_waiting.length > 0 && (
        <a className="callout" href="#/requests">
          <span className="callout-icon"><Icon name="inbox" /></span>
          <span className="grow">{plural("home.requestsWaiting", h.requests_waiting.length)}</span>
          <Icon name="right" />
        </a>
      )}

      <div className="cols home">
        {/* ---------- Today ---------- */}
        <Section title={t("home.today")} icon="sun"
          action={showList && total > 0 ? <span className="progress-text">{t("home.progress", { done: doneCount, n: total })}</span> : undefined}>
          {showList && total > 0 && (
            <div className="progress" aria-hidden="true"><div className="progress-bar"><span style={{ width: `${(doneCount / total) * 100}%` }} /></div></div>
          )}
          {h.visit.out && outBanner(h.today, h.visit.out.reason, h.visit.out.note)}
          {!h.visit.regular && (
            <div className="card soft">
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
          {showList && total === 0 && <p className="empty">{t("home.nothingToday")}</p>}
          {showList && total > 0 && <ul className="check-list">{rows(h.today_items, true)}</ul>}
          {/* One dominant action per screen */}
          {role === "housekeeper" && h.visit.open && <LinkButton to="/end-of-day" primary sticky icon="check">{t("home.beforeLeave")}</LinkButton>}
        </Section>

        <div className="side">
          {role === "housekeeper" && !h.visit.open && <LinkButton to="/groceries" primary icon="cart">{t("nav.groceries")}</LinkButton>}

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

          {/* ---------- Coming up ---------- */}
          <Section title={t("home.comingUp")} icon="calendar"
            action={<a className="btn secondary small" href="#/calendar">{t("home.calendar")}</a>}>
            {role === "family" && familyOuts.length > 0 && <p className="hint">{t("home.outHint")}</p>}
            {h.coming_up.length === 0 && <p className="empty">{t("home.nothingComing")}</p>}
            {h.coming_up.map((c) => (
              <div key={c.date} className="day-block">
                <h3 className="day-heading">{dayHeading(c.date, h.today)}</h3>
                {c.out ? outBanner(c.date, c.out.reason, c.out.note) : c.items.length === 0 ? <p className="empty">{t("home.nothingPlanned")}</p> : <ul className="check-list">{rows(c.items, false)}</ul>}
              </div>
            ))}
          </Section>

          {h.due_soon.length > 0 && (
            <Section title={t("home.dueSoon")} icon="clock" hint={t("home.dueSoonHint")}>
              <ul className="check-list">
                {h.due_soon.map((i) => (
                  <CheckRow key={i.id} checked={false} readOnly title={i.title} note={i.note}
                    sub={t("task.dueOn", { day: weekdayName(i.due_date) }) + " · " + t("task.seenOn", { day: weekdayName(i.visit_date) })}
                    carried={carriedText(i)} />
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
