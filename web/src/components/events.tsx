import { FormEvent, useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import type { CalEvent, GoogleCalendarInfo, GoogleStatus } from "../types";
import { dayHeading, dayLabel, timeOfDay, weekdayName } from "../format";
import { errorText, useLoad } from "../hooks";
import { ErrorBanner, SecondaryButton, Section } from "./ui";
import { Icon } from "./icons";

/** "All day", "4:00 PM – 5:30 PM", or "Fri – Sun" for an event spanning days. */
export function eventWhen(e: CalEvent): string {
  if (e.start_time === null) {
    return e.end_date > e.start_date ? `${weekdayName(e.start_date, "short")} – ${weekdayName(e.end_date, "short")}` : t("event.allDay");
  }
  return `${timeOfDay(e.start_time)} – ${timeOfDay(e.end_time!)}`;
}

/** One family-calendar event: its calendar's colour, title, time and place. Tap to edit when allowed. */
export function EventRow({ e, today, showDay, onEdit }: { e: CalEvent; today: string; showDay?: boolean; onEdit?: () => void }) {
  const inner = (
    <>
      <span className="event-dot" style={{ background: e.color ?? "var(--t-event)" }} aria-hidden="true" />
      <span className="grow">
        <span className="row-title">{e.title}</span>
        <span className="row-sub">
          {[showDay && dayLabel(e.start_date < today ? today : e.start_date, today), eventWhen(e), e.location, e.calendar_name].filter(Boolean).join(" · ")}
        </span>
      </span>
      {onEdit && <Icon name="note" size={20} />}
    </>
  );
  return (
    <li className="event-row">
      {onEdit ? <button type="button" className="event-btn" onClick={onEdit} aria-label={t("event.editNamed", { title: e.title })}>{inner}</button> : <div className="event-btn">{inner}</div>}
    </li>
  );
}

type Draft = { calendar_id: string; title: string; date: string; end_date: string; all_day: boolean; start: string; end: string; location: string; notes: string };

/** Add or change an event on one of the family's Google calendars. */
export function EventEditor({ event, date, calendars, onDone, onCancel }: {
  event?: CalEvent; date: string; calendars: GoogleCalendarInfo[]; onDone: () => void; onCancel: () => void;
}) {
  const writable = calendars.filter((c) => c.writable);
  const [d, setD] = useState<Draft>(() => event ? {
    calendar_id: event.calendar_id, title: event.title, date: event.start_date, end_date: event.end_date,
    all_day: event.start_time === null, start: event.start_time ?? "09:00", end: event.end_time ?? "10:00", location: event.location, notes: event.notes,
  } : { calendar_id: writable[0]?.calendar_id ?? "", title: "", date, end_date: date, all_day: true, start: "09:00", end: "10:00", location: "", notes: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const path = event ? `/google/events/${encodeURIComponent(event.calendar_id)}/${encodeURIComponent(event.event_id)}` : "/google/events";

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!d.title.trim()) { setProblem(t("event.needTitle")); return; }
    try {
      await api(path, event ? "PATCH" : "POST", { ...d, title: d.title.trim(), end_date: d.end_date < d.date ? d.date : d.end_date });
      onDone();
    } catch (e) { setProblem(errorText(e)); }
  };
  const remove = async () => {
    try { await api(path, "DELETE"); onDone(); } catch (e) { setProblem(errorText(e)); }
  };

  if (writable.length === 0) return <p className="hint">{t("event.noWritable")}</p>;
  return (
    <form className="card event-edit add-form" onSubmit={save}>
      <p className="card-title">{event ? t("event.editTitle") : t("event.addTitle")}</p>
      <ErrorBanner message={problem} />
      <label className="field">
        <span>{t("event.titleLabel")}</span>
        <input type="text" value={d.title} maxLength={200} autoComplete="off" onChange={(e) => set({ title: e.target.value })} />
      </label>
      {!event && writable.length > 1 && (
        <label className="field">
          <span>{t("event.calendarLabel")}</span>
          <select value={d.calendar_id} onChange={(e) => set({ calendar_id: e.target.value })}>
            {writable.map((c) => <option key={c.calendar_id} value={c.calendar_id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {event?.recurring && <p className="hint">{t("event.recurringHint")}</p>}
      <div className="segmented" role="group" aria-label={t("event.whenLabel")}>
        <button type="button" className={`btn${d.all_day ? " on" : ""}`} aria-pressed={d.all_day} onClick={() => set({ all_day: true })}>{t("event.allDay")}</button>
        <button type="button" className={`btn${!d.all_day ? " on" : ""}`} aria-pressed={!d.all_day} onClick={() => set({ all_day: false })}>{t("event.atTime")}</button>
      </div>
      <div className="field-row pair">
        <label className="field">
          <span>{t("event.dateLabel")}</span>
          <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value, end_date: d.end_date < e.target.value ? e.target.value : d.end_date })} />
        </label>
        {d.all_day && (
          <label className="field">
            <span>{t("event.endDateLabel")}</span>
            <input type="date" value={d.end_date} min={d.date} onChange={(e) => set({ end_date: e.target.value })} />
          </label>
        )}
      </div>
      {!d.all_day && (
        <div className="field-row pair">
          <label className="field">
            <span>{t("event.startLabel")}</span>
            <input type="time" value={d.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("event.endLabel")}</span>
            <input type="time" value={d.end} onChange={(e) => set({ end: e.target.value })} />
          </label>
        </div>
      )}
      <label className="field">
        <span>{t("event.locationLabel")}</span>
        <input type="text" value={d.location} maxLength={200} autoComplete="off" onChange={(e) => set({ location: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("event.notesLabel")}</span>
        <textarea rows={2} maxLength={2000} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      {confirmDelete ? (
        <div className="btn-row">
          <SecondaryButton danger onClick={() => void remove()}>{t("event.deleteYes")}</SecondaryButton>
          <SecondaryButton onClick={() => setConfirmDelete(false)}>{t("action.cancel")}</SecondaryButton>
        </div>
      ) : (
        <div className="btn-row">
          <button type="submit" className="btn primary small">{t("action.save")}</button>
          <SecondaryButton onClick={onCancel}>{t("action.cancel")}</SecondaryButton>
          {event && <SecondaryButton danger onClick={() => setConfirmDelete(true)}>{t("event.delete")}</SecondaryButton>}
        </div>
      )}
    </form>
  );
}

/** The week's family-calendar events on Home, by day. The family can add and change them here. */
export function EventsCard({ events, today, isFamily, onChange }: { events: CalEvent[]; today: string; isFamily: boolean; onChange: () => void }) {
  const { data: google } = useLoad(() => (isFamily ? api<GoogleStatus>("/google") : Promise.resolve(null)), [isFamily], 0);
  const [editing, setEditing] = useState<string | null>(null); // event key, or "new"
  const calendars = google?.calendars ?? [];
  const canAdd = isFamily && calendars.some((c) => c.writable);
  const key = (e: CalEvent) => `${e.calendar_id}/${e.event_id}`;
  // Each event is listed once, on its first day this week.
  const days = new Map<string, CalEvent[]>();
  for (const e of events) {
    const d = e.start_date < today ? today : e.start_date;
    days.set(d, [...(days.get(d) ?? []), e]);
  }
  const done = () => { setEditing(null); onChange(); };

  return (
    <Section title={t("event.cardTitle")} icon="calendar" tone="event" collapsible="events"
      summary={events.length ? plural("event.count", events.length) : t("event.none")}>
      {editing === "new" && <EventEditor date={today} calendars={calendars} onDone={done} onCancel={() => setEditing(null)} />}
      {events.length === 0 && editing !== "new" && <p className="empty">{t("event.none")}</p>}
      {[...days].sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, list]) => (
        <div key={d}>
          <h3 className="event-day">{dayHeading(d, today)}</h3>
          <ul className="event-list">
            {list.map((e) => editing === key(e)
              ? <li key={key(e)}><EventEditor event={e} date={d} calendars={calendars} onDone={done} onCancel={() => setEditing(null)} /></li>
              : <EventRow key={key(e)} e={e} today={today} onEdit={isFamily && e.writable ? () => setEditing(key(e)) : undefined} />)}
          </ul>
        </div>
      ))}
      {canAdd && editing !== "new" && (
        <button type="button" className="more-link as-button" onClick={() => setEditing("new")}><Icon name="plus" size={18} />{t("event.add")}</button>
      )}
    </Section>
  );
}
