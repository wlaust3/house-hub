import { useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { CalendarDay } from "../types";
import type { Role } from "../role";
import { addMonth, dayLong, monthTitle, weekdayFromIso } from "../format";
import { BackButton, CheckRow, ErrorBanner, LinkButton, PageHeader, SecondaryButton, carriedText, taskTags, whenDone } from "../components/ui";
import { Icon } from "../components/icons";
import { EventEditor, EventRow } from "../components/events";
import type { GoogleStatus } from "../types";

/** Optional month view. Never the default; reached only from the Calendar button on Home. */
export function CalendarScreen({ role }: { role: Role }) {
  const [month, setMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, setData, error, reload } = useLoad(
    () => api<{ month: string; today: string; days: CalendarDay[] }>(`/calendar${month ? `?month=${month}` : ""}`),
    [month], 15000);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // event key, or "new"
  const { data: google } = useLoad(() => (role === "family" ? api<GoogleStatus>("/google") : Promise.resolve(null)), [role], 0);

  if (!data) return <><BackButton to="/more" label={t("nav.more")} phoneOnly /><p className="hint">{error ?? t("common.loading")}</p></>;
  const cur = data.month;
  const firstWeekday = data.days[0].weekday; // 1 = Monday
  const pad = Array.from({ length: firstWeekday - 1 });
  const sel = data.days.find((d) => d.date === (selected ?? data.today)) ?? null;
  const isToday = sel?.date === data.today;
  const isPast = sel ? sel.date < data.today : false;

  const toggle = async (id: number, done: boolean) => {
    setData({ ...data, days: data.days.map((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, status: done ? "done" : "pending" } : i)) })) });
    try { await api(`/instances/${id}`, "PATCH", { done }); setProblem(null); } catch (e) { setProblem(errorText(e)); }
    void reload();
  };

  const thisMonth = !month;

  return (
    <>
      <PageHeader back={<BackButton to="/more" label={t("nav.more")} phoneOnly />} title={t("calendar.title")}
        actions={thisMonth && !selected ? undefined : <button type="button" className="btn secondary" onClick={() => { setMonth(null); setSelected(null); }}>{t("calendar.backToToday")}</button>} />
      <ErrorBanner message={problem ?? error} />
      <div className="cols cal">
        <section className="card">
          <div className="month-bar">
            <button type="button" className="icon-btn" aria-label={t("calendar.prev")} onClick={() => { setMonth(addMonth(cur, -1)); setSelected(null); }}><Icon name="left" /></button>
            <h2 className="month-title">{monthTitle(cur)}</h2>
            <button type="button" className="icon-btn" aria-label={t("calendar.next")} onClick={() => { setMonth(addMonth(cur, 1)); setSelected(null); }}><Icon name="right" /></button>
          </div>
          <div className="cal-grid" role="grid" aria-label={monthTitle(cur)}>
            {[1, 2, 3, 4, 5, 6, 7].map((w) => <div key={w} className="cal-head" role="columnheader">{weekdayFromIso(w, "short")}</div>)}
            {pad.map((_, i) => <div key={`p${i}`} />)}
            {data.days.map((d) => {
              const total = d.open_count + d.done_count;
              const label = [dayLong(d.date), d.visit ? t("calendar.visitDay") : "", d.out ? t("calendar.outDay") : "", total ? plural("calendar.tasks", total) : ""].filter(Boolean).join(", ");
              return (
                <button key={d.date} type="button" role="gridcell" aria-label={label} aria-pressed={sel?.date === d.date}
                  className={`cal-cell${d.date === data.today ? " today" : ""}${d.visit ? " visit" : ""}${d.out ? " out" : ""}${sel?.date === d.date ? " sel" : ""}`}
                  onClick={() => { setSelected(d.date); setEditing(null); }}>
                  <span className="cal-num">{Number(d.date.slice(8))}</span>
                  <span className="cal-marks" aria-hidden="true">
                    {d.out ? "✕" : d.visit ? "●" : ""}
                    {total > 0 && <span className="cal-count">{total}</span>}
                    {d.events.length > 0 && <span className="cal-ev" title={plural("event.count", d.events.length)} />}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="hint legend">{t("calendar.legend")}</p>
        </section>

        {sel && (
          <section className="card section sticky-col">
            <div className="card-head"><h2>{dayLong(sel.date)}</h2></div>
            {sel.out && <p className="banner info">{t("calendar.outDay")}</p>}
            {sel.items.length === 0 && !sel.out && <p className="empty">{sel.visit ? t("home.nothingPlanned") : t("calendar.noVisit")}</p>}
            {sel.items.length > 0 && (
              <ul className="check-list">
                {sel.items.map((i) => (
                  <CheckRow key={i.id} checked={i.status === "done"} title={i.title} carried={carriedText(i)} priority={i.priority} tags={taskTags(i, true)} sub={whenDone(i)} note={i.note}
                    readOnly={!isToday || isPast} onToggle={isToday ? () => void toggle(i.id, i.status !== "done") : undefined} />
                ))}
              </ul>
            )}
            {sel.events.length > 0 && (
              <>
                <h3 className="event-day">{t("event.cardTitle")}</h3>
                <ul className="event-list">
                  {sel.events.map((e) => {
                    const k = `${e.calendar_id}/${e.event_id}`;
                    return editing === k
                      ? <li key={k}><EventEditor event={e} date={sel.date} calendars={google?.calendars ?? []} onDone={() => { setEditing(null); void reload(); }} onCancel={() => setEditing(null)} /></li>
                      : <EventRow key={k} e={e} today={data.today} onEdit={role === "family" && e.writable ? () => setEditing(k) : undefined} />;
                  })}
                </ul>
              </>
            )}
            {editing === "new" && <EventEditor key={sel.date} date={sel.date} calendars={google?.calendars ?? []} onDone={() => { setEditing(null); void reload(); }} onCancel={() => setEditing(null)} />}
            {role === "family" && google?.calendars.some((c) => c.writable) && editing !== "new" && (
              <SecondaryButton onClick={() => setEditing("new")}><Icon name="plus" size={20} />{t("event.add")}</SecondaryButton>
            )}
            {!isPast && role === "family" && <LinkButton to={`/tasks/new?date=${sel.date}`} icon="plus">{t("calendar.addForDay")}</LinkButton>}
            {isPast && <p className="hint">{t("calendar.pastReadOnly")}</p>}
          </section>
        )}
      </div>
    </>
  );
}
