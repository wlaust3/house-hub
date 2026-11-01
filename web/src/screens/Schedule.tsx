import { useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { ScheduleInfo, OutDay } from "../types";
import type { Role } from "../role";
import { dayHeading, dayLabel, weekdayFromIso } from "../format";
import { BackButton, ErrorBanner, PageHeader, SecondaryButton, Section } from "../components/ui";
import { Icon } from "../components/icons";

export function ScheduleScreen({ role }: { role: Role }) {
  const { data, error, reload } = useLoad(() => api<ScheduleInfo>("/schedule"), [], 15000);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);   // "I can't come" open for this date
  const [noting, setNoting] = useState<string | null>(null);   // day note open for this date
  const [text, setText] = useState("");
  const [extra, setExtra] = useState("");

  if (!data) return <p className="hint">{error ?? t("common.loading")}</p>;
  const s = data;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setProblem(null);
    } catch (e) {
      setProblem(errorText(e));
    }
    await reload();
  };

  const toggleDay = (d: number) =>
    run(() => {
      const next = s.weekdays.includes(d) ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d];
      return api("/schedule", "PUT", { weekdays: next });
    });

  const markOut = (date: string) => run(async () => {
    await api("/days-out", "POST", { date, note: text.trim() });
    setAsking(null);
  });
  const saveNote = (date: string) => run(async () => {
    await api(`/day-notes/${date}`, "PUT", { note: text });
    setNoting(null);
  });
  const addExtra = () => run(async () => {
    await api("/extra-days", "POST", { date: extra });
    setExtra("");
  });

  const outCard = (date: string, out: OutDay) => (
    <div className="card out">
      <p className="card-title">{t("schedule.isOut")}</p>
      {out.note && <p>{out.note}</p>}
      {role === "family" && (
        <>
          <p className="hint">{t("schedule.modeQuestion")}</p>
          <div className="btn-row">
            <SecondaryButton pressed={out.mode === "shift"} onClick={() => void run(() => api(`/days-out/${date}`, "PATCH", { mode: "shift" }))}>{t("schedule.mode.shift")}</SecondaryButton>
            <SecondaryButton pressed={out.mode === "hide"} onClick={() => void run(() => api(`/days-out/${date}`, "PATCH", { mode: "hide" }))}>{t("schedule.mode.hide")}</SecondaryButton>
          </div>
          <p className="hint">{out.mode === "shift" ? t("schedule.mode.shiftHint") : t("schedule.mode.hideHint")}</p>
        </>
      )}
      <SecondaryButton onClick={() => void run(() => api(`/days-out/${date}`, "DELETE"))}>{t("out.undo")}</SecondaryButton>
    </div>
  );

  return (
    <>
      <PageHeader back={<BackButton to="/more" label={t("nav.more")} phoneOnly />} title={t("schedule.title")} />
      <ErrorBanner message={problem ?? error} />

      <div className="cols split">
        <div className="side sticky-col">
          <Section title={t("schedule.regular")} icon="clock" hint={role === "family" ? t("schedule.regularHint") : t("schedule.regularReadOnly")}>
            <div className="day-grid" role="group" aria-label={t("schedule.regular")}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                const on = s.weekdays.includes(d);
                const inner = <>{on ? <Icon name="check" size={18} /> : <span className="icon" style={{ width: 18, height: 18 }} />}{weekdayFromIso(d, "short")}</>;
                return role === "family" ? (
                  <button key={d} type="button" className={`btn toggle${on ? " on" : ""}`} aria-pressed={on} aria-label={weekdayFromIso(d)} onClick={() => void toggleDay(d)}>{inner}</button>
                ) : (
                  <div key={d} className={`btn toggle static${on ? " on" : ""}`} aria-label={weekdayFromIso(d)}>{inner}</div>
                );
              })}
            </div>
          </Section>

          <Section title={t("schedule.extraTitle")} icon="plus" hint={t("schedule.extraHint")}>
            <div className="field-row">
              <label className="field">
                <span>{t("tasks.dayLabel")}</span>
                <input type="date" min={s.today} value={extra} onChange={(e) => setExtra(e.target.value)} />
              </label>
              <button type="button" className="btn primary small" disabled={!extra} onClick={() => void addExtra()}>{t("schedule.extraAdd")}</button>
            </div>
          </Section>
        </div>

        <Section title={t("schedule.upcoming")} icon="calendar">
          <div>
            {s.visits.map((v) => (
              <div key={v.date} className="visit-row">
                <div className="grow">
                  <span className="row-title">{dayHeading(v.date, s.today)}</span>
                  <span className="row-meta">
                    {v.extra && <span className="tag">{t("schedule.extra")}</span>}
                    {v.note && noting !== v.date && <span className="row-sub"><Icon name="note" size={14} /> {v.note}</span>}
                  </span>
                </div>
                {v.out ? outCard(v.date, v.out) : asking === v.date ? (
                  <div className="card soft">
                    <p className="card-title">{t("home.cantCome", { day: dayLabel(v.date, s.today) })}</p>
                    <label className="field">
                      <span>{t("out.noteLabel")}</span>
                      <textarea rows={2} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
                    </label>
                    <div className="btn-row">
                      <button type="button" className="btn primary small" onClick={() => void markOut(v.date)}>{t("out.confirm")}</button>
                      <SecondaryButton onClick={() => setAsking(null)}>{t("action.back")}</SecondaryButton>
                    </div>
                  </div>
                ) : noting === v.date ? (
                  <div className="card soft">
                    <label className="field">
                      <span>{t("dayNote.label")}</span>
                      <textarea rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
                    </label>
                    <div className="btn-row">
                      <button type="button" className="btn primary small" onClick={() => void saveNote(v.date)}>{t("action.save")}</button>
                      <SecondaryButton onClick={() => setNoting(null)}>{t("action.cancel")}</SecondaryButton>
                    </div>
                  </div>
                ) : (
                  <div className="btn-row visit-actions">
                    <button type="button" className="icon-btn" aria-label={v.note ? t("dayNote.edit") : t("dayNote.add")} title={v.note ? t("dayNote.edit") : t("dayNote.add")}
                      onClick={() => { setText(v.note); setNoting(v.date); setAsking(null); }}><Icon name="note" /></button>
                    {v.extra ? (
                      <SecondaryButton onClick={() => void run(() => api(`/extra-days/${v.date}`, "DELETE"))}>{t("schedule.extraRemove")}</SecondaryButton>
                    ) : (
                      <SecondaryButton onClick={() => { setText(""); setAsking(v.date); setNoting(null); }}>{t("home.cantCome", { day: dayLabel(v.date, s.today) })}</SecondaryButton>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
