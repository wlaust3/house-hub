import { useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { CalendarDay } from "../types";
import type { Role } from "../role";
import { addMonth, dayLong, monthTitle, weekdayFromIso } from "../format";
import { BackButton, CheckRow, ErrorBanner, LinkButton, SecondaryButton, carriedText, whenDone } from "../components/ui";

/** Optional month view. Never the default; reached only from the Calendar button on Home. */
export function CalendarScreen({ role }: { role: Role }) {
  const [month, setMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, setData, error, reload } = useLoad(
    () => api<{ month: string; today: string; days: CalendarDay[] }>(`/calendar${month ? `?month=${month}` : ""}`),
    [month], 15000);
  const [problem, setProblem] = useState<string | null>(null);

  if (!data) return <><BackButton to="/" label={t("nav.home")} /><p className="hint">{error ?? t("common.loading")}</p></>;
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

  return (
    <>
      <BackButton to="/" label={t("nav.home")} />
      <h2>{t("calendar.title")}</h2>
      <ErrorBanner message={problem ?? error} />
      <div className="month-bar">
        <button type="button" className="btn secondary" aria-label={t("calendar.prev")} onClick={() => { setMonth(addMonth(cur, -1)); setSelected(null); }}>←</button>
        <strong className="month-title">{monthTitle(cur)}</strong>
        <button type="button" className="btn secondary" aria-label={t("calendar.next")} onClick={() => { setMonth(addMonth(cur, 1)); setSelected(null); }}>→</button>
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
              onClick={() => setSelected(d.date)}>
              <span className="cal-num">{Number(d.date.slice(8))}</span>
              <span className="cal-marks" aria-hidden="true">
                {d.out ? "✕" : d.visit ? "●" : ""}
                {total > 0 && <span className="cal-count">{total}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="hint legend">{t("calendar.legend")}</p>

      {sel && (
        <section className="section">
          <h3 className="day-heading">{dayLong(sel.date)}</h3>
          {sel.out && <p className="banner info">{t("calendar.outDay")}</p>}
          {sel.items.length === 0 && !sel.out && <p className="empty">{sel.visit ? t("home.nothingPlanned") : t("calendar.noVisit")}</p>}
          {sel.items.length > 0 && (
            <ul className="check-list">
              {sel.items.map((i) => (
                <CheckRow key={i.id} checked={i.status === "done"} title={i.title} carried={carriedText(i)} sub={whenDone(i)} note={i.note}
                  readOnly={!isToday || isPast} onToggle={isToday ? () => void toggle(i.id, i.status !== "done") : undefined} />
              ))}
            </ul>
          )}
          {!isPast && role === "family" && <LinkButton to={`/tasks/new?date=${sel.date}`}>{t("calendar.addForDay")}</LinkButton>}
          {isPast && <p className="hint">{t("calendar.pastReadOnly")}</p>}
        </section>
      )}
      <SecondaryButton onClick={() => { setMonth(null); setSelected(null); }}>{t("calendar.backToToday")}</SecondaryButton>
    </>
  );
}
