import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { errorText } from "../hooks";
import type { TaskDef, OneOff } from "../types";
import { BackButton, ErrorBanner, PrimaryButton, SecondaryButton } from "../components/ui";

type Kind = "daily" | "weekly" | "monthly" | "every_six_months" | "custom";
const KINDS: [Kind, Parameters<typeof t>[0]][] = [
  ["daily", "repeat.daily"],
  ["weekly", "repeat.weekly"],
  ["monthly", "repeat.monthly"],
  ["every_six_months", "repeat.sixMonths"],
  ["custom", "repeat.custom"],
];
const UNITS: ["day" | "week" | "month", Parameters<typeof t>[0]][] = [
  ["day", "unit.days"], ["week", "unit.weeks"], ["month", "unit.months"],
];

export function TaskFormScreen({ id, presetDate, today, go }: { id: number | null; presetDate: string | null; today: string; go: (to: string) => void }) {
  const [loaded, setLoaded] = useState(id === null);
  const [mode, setMode] = useState<"once" | "repeat">("once");
  const [isRecurring, setIsRecurring] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [pick, setPick] = useState(presetDate != null);
  const [date, setDate] = useState(presetDate ?? today);
  const [kind, setKind] = useState<Kind>("weekly");
  const [n, setN] = useState(2);
  const [unit, setUnit] = useState<"day" | "week" | "month">("week");
  const [start, setStart] = useState(today);
  const [active, setActive] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (id === null) return;
    api<{ recurring: TaskDef[]; one_offs: OneOff[] }>("/tasks")
      .then((all) => {
        const r = all.recurring.find((x) => x.id === id);
        const o = all.one_offs.find((x) => x.id === id);
        if (r) {
          setMode("repeat"); setIsRecurring(true); setTitle(r.title); setNotes(r.notes); setKind(r.repeat.kind);
          setN(r.repeat.n); setUnit(r.repeat.unit); setStart(r.repeat.start); setActive(r.active);
        } else if (o) {
          setTitle(o.title); setNotes(o.notes); setPick(true); setDate(o.due_date < today ? today : o.due_date);
        } else {
          setProblem(t("tasks.notFound"));
        }
        setLoaded(true);
      })
      .catch((e) => { setProblem(errorText(e)); setLoaded(true); });
  }, [id, today]);

  if (!loaded) return <p className="hint">{t("common.loading")}</p>;

  const repeatBody = () => ({ kind, n, unit, start });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setProblem(t("tasks.needTitle")); return; }
    setBusy(true);
    try {
      if (id === null) {
        await api("/tasks", "POST", mode === "repeat"
          ? { title: title.trim(), notes: notes.trim(), repeat: repeatBody() }
          : { title: title.trim(), notes: notes.trim(), date: pick ? date : null });
      } else {
        await api(`/tasks/${id}`, "PATCH", isRecurring
          ? { title: title.trim(), notes: notes.trim(), repeat: repeatBody() }
          : { title: title.trim(), notes: notes.trim(), date: pick ? date : null });
      }
      go("/tasks");
    } catch (err) {
      setProblem(errorText(err));
      setBusy(false);
    }
  };

  const setPaused = async (next: boolean) => {
    try { await api(`/tasks/${id}`, "PATCH", { active: next }); setActive(next); go("/tasks"); } catch (err) { setProblem(errorText(err)); }
  };
  const remove = async () => {
    try { await api(`/tasks/${id}`, "DELETE"); go("/tasks"); } catch (err) { setProblem(errorText(err)); }
  };

  return (
    <>
      <BackButton to="/tasks" label={t("nav.tasks")} />
      <h2>{id === null ? t("tasks.newTitle") : t("tasks.editTitle")}</h2>
      <ErrorBanner message={problem} />
      <form className="add-form" onSubmit={save}>
        <label className="field">
          <span>{t("tasks.nameLabel")}</span>
          <input type="text" value={title} maxLength={200} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("tasks.noteLabel")}</span>
          <textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {id === null && (
          <div className="btn-row" role="group" aria-label={t("tasks.howOften")}>
            <button type="button" className={`btn toggle${mode === "once" ? " on" : ""}`} aria-pressed={mode === "once"} onClick={() => setMode("once")}>{t("tasks.justOnce")}</button>
            <button type="button" className={`btn toggle${mode === "repeat" ? " on" : ""}`} aria-pressed={mode === "repeat"} onClick={() => setMode("repeat")}>{t("tasks.repeats")}</button>
          </div>
        )}

        {mode === "once" && (
          <>
            <div className="btn-row" role="group" aria-label={t("tasks.when")}>
              <button type="button" className={`btn toggle${!pick ? " on" : ""}`} aria-pressed={!pick} onClick={() => setPick(false)}>{t("tasks.nextVisit")}</button>
              <button type="button" className={`btn toggle${pick ? " on" : ""}`} aria-pressed={pick} onClick={() => setPick(true)}>{t("tasks.pickDay")}</button>
            </div>
            {pick && (
              <label className="field">
                <span>{t("tasks.dayLabel")}</span>
                <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            )}
            <p className="hint">{t("tasks.onceHint")}</p>
          </>
        )}

        {mode === "repeat" && (
          <>
            <label className="field">
              <span>{t("tasks.repeatLabel")}</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                {KINDS.map(([k, key]) => <option key={k} value={k}>{t(key)}</option>)}
              </select>
            </label>
            {kind === "custom" && (
              <div className="custom-row">
                <label className="field">
                  <span>{t("tasks.every")}</span>
                  <input type="number" inputMode="numeric" min={1} max={366} value={n} onChange={(e) => setN(Number(e.target.value))} />
                </label>
                <label className="field">
                  <span>{t("tasks.unit")}</span>
                  <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
                    {UNITS.map(([u, key]) => <option key={u} value={u}>{t(key)}</option>)}
                  </select>
                </label>
              </div>
            )}
            <label className="field">
              <span>{t("tasks.startLabel")}</span>
              <input type="date" min={id === null ? today : undefined} value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            {id !== null && <p className="hint">{t("tasks.futureOnly")}</p>}
          </>
        )}

        <PrimaryButton type="submit" onClick={() => undefined} disabled={busy}>{t("action.save")}</PrimaryButton>
      </form>

      {id !== null && isRecurring && (
        <SecondaryButton onClick={() => void setPaused(!active)}>{active ? t("tasks.pause") : t("tasks.resume")}</SecondaryButton>
      )}
      {id !== null && !confirmDelete && <SecondaryButton danger onClick={() => setConfirmDelete(true)}>{t("tasks.delete")}</SecondaryButton>}
      {id !== null && confirmDelete && (
        <div className="card warn" role="alert">
          <p className="card-title">{t("tasks.deleteConfirm")}</p>
          <div className="stack">
            <SecondaryButton danger onClick={() => void remove()}>{t("tasks.deleteYes")}</SecondaryButton>
            <SecondaryButton onClick={() => setConfirmDelete(false)}>{t("tasks.deleteNo")}</SecondaryButton>
          </div>
        </div>
      )}
    </>
  );
}
