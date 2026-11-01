import { useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { ScheduleInfo, OutDay } from "../types";
import type { Role } from "../role";
import { dayHeading, dayLabel, weekdayFromIso } from "../format";
import { BackButton, ErrorBanner, PageHeader, SecondaryButton, Section } from "../components/ui";
import { Icon } from "../components/icons";

const REASONS = [
  ["appointment", "out.reason.appointment"],
  ["sick", "out.reason.sick"],
  ["other", "out.reason.other"],
] as const;

export function ScheduleScreen({ role }: { role: Role }) {
  const { data, error, reload } = useLoad(() => api<ScheduleInfo>("/schedule"), [], 15000);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

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

  const markOut = (date: string, reason: string) => run(async () => {
    await api("/days-out", "POST", { date, reason });
    setAsking(null);
  });

  const outRow = (date: string, out: OutDay) => (
    <div className="card out">
      <p className="card-title">{t("schedule.isOut", { reason: t(REASONS.find((r) => r[0] === out.reason)![1]) })}</p>
      {role === "family" && (
        <>
          <p className="hint">{t("schedule.modeQuestion")}</p>
          <div className="btn-row">
            <SecondaryButton pressed={out.mode === "shift"} onClick={() => void run(() => api(`/days-out/${date}`, "PATCH", { mode: "shift" }))}>{t("schedule.mode.shift")}</SecondaryButton>
            <SecondaryButton pressed={out.mode === "hide"} onClick={() => void run(() => api(`/days-out/${date}`, "PATCH", { mode: "hide" }))}>{t("schedule.mode.hide")}</SecondaryButton>
          </div>
          <p className="hint">{out.mode === "shift" ? t("schedule.mode.shiftHint") : t("schedule.mode.hideHint")}</p>
          <label className="field">
            <span>{t("schedule.noteLabel")}</span>
            <input type="text" maxLength={200} value={note[date] ?? out.note} onChange={(e) => setNote({ ...note, [date]: e.target.value })}
              onBlur={() => note[date] !== undefined && note[date] !== out.note && void run(() => api(`/days-out/${date}`, "PATCH", { note: note[date] }))} />
          </label>
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
        <Section title={t("schedule.regular")} icon="clock" className="sticky-col" hint={role === "family" ? t("schedule.regularHint") : t("schedule.regularReadOnly")}>
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

        <Section title={t("schedule.upcoming")} icon="calendar">
          <div>
            {s.visits.map((v) => (
              <div key={v.date} className="visit-row">
                <div className="grow"><span className="row-title">{dayHeading(v.date, s.today)}</span></div>
                {v.out ? outRow(v.date, v.out) : asking === v.date ? (
                  <div className="card soft">
                    <p className="card-title">{t("out.why", { day: dayLabel(v.date, s.today) })}</p>
                    <div className="stack">
                      {REASONS.map(([r, key]) => <button key={r} type="button" className="btn choice" onClick={() => void markOut(v.date, r)}>{t(key)}</button>)}
                      <SecondaryButton onClick={() => setAsking(null)}>{t("action.back")}</SecondaryButton>
                    </div>
                  </div>
                ) : (
                  <SecondaryButton onClick={() => setAsking(v.date)}>{t("home.cantCome", { day: dayLabel(v.date, s.today) })}</SecondaryButton>
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
