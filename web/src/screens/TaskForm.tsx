import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { errorText } from "../hooks";
import type { TaskDef, OneOff, Member, Priority, Period, IfNotDone } from "../types";
import { BackButton, ErrorBanner, PageHeader, PrimaryButton, SecondaryButton } from "../components/ui";

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

const PRIORITIES: [Priority, Parameters<typeof t>[0]][] = [[1, "priority.high"], [2, "priority.normal"], [3, "priority.low"]];
const PERIODS: [Period, Parameters<typeof t>[0]][] = [["day", "period.onTheDay"], ["week", "period.thatWeek"], ["month", "period.thatMonth"]];
const IF_NOT_DONE: [IfNotDone, Parameters<typeof t>[0]][] = [["carry", "ifNotDone.carry"], ["drop", "ifNotDone.drop"], ["expire", "ifNotDone.expire"]];

export function TaskFormScreen({ id, presetDate, today, go }: { id: number | null; presetDate: string | null; today: string; go: (to: string) => void }) {
  const [loaded, setLoaded] = useState(id === null);
  const [mode, setMode] = useState<"once" | "repeat">("once");
  const [isRecurring, setIsRecurring] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  // One-time tasks: next visit, a picked day, or any time this week / this month.
  const [when, setWhen] = useState<"next" | "pick" | "week" | "month">(presetDate != null ? "pick" : "next");
  const [date, setDate] = useState(presetDate ?? today);
  const [kind, setKind] = useState<Kind>("weekly");
  const [n, setN] = useState(2);
  const [unit, setUnit] = useState<"day" | "week" | "month">("week");
  const [start, setStart] = useState(today);
  const [active, setActive] = useState(true);
  const [priority, setPriority] = useState<Priority>(2);
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>("day");
  const [ifNotDone, setIfNotDone] = useState<IfNotDone>("carry");
  const [expireDays, setExpireDays] = useState(7);
  const [members, setMembers] = useState<Member[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api<Member[]>("/members").then(setMembers).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (id === null) return;
    api<{ recurring: TaskDef[]; one_offs: OneOff[] }>("/tasks")
      .then((all) => {
        const r = all.recurring.find((x) => x.id === id);
        const o = all.one_offs.find((x) => x.id === id);
        const opts = r ?? o;
        if (opts) {
          setPriority(opts.priority); setOwnerId(opts.owner_id); setPeriod(opts.period);
          setIfNotDone(opts.if_not_done); setExpireDays(opts.expire_days ?? 7);
        }
        if (r) {
          setMode("repeat"); setIsRecurring(true); setTitle(r.title); setNotes(r.notes); setKind(r.repeat.kind);
          setN(r.repeat.n); setUnit(r.repeat.unit); setStart(r.repeat.start); setActive(r.active);
        } else if (o) {
          setTitle(o.title); setNotes(o.notes); setDate(o.due_date < today ? today : o.due_date);
          setWhen(o.period === "week" ? "week" : o.period === "month" ? "month" : "pick");
        } else {
          setProblem(t("tasks.notFound"));
        }
        setLoaded(true);
      })
      .catch((e) => { setProblem(errorText(e)); setLoaded(true); });
  }, [id, today]);

  if (!loaded) return <p className="hint">{t("common.loading")}</p>;

  const repeatBody = () => ({ kind, n, unit, start });
  const options = () => ({ priority, owner_id: ownerId, if_not_done: ifNotDone, expire_days: ifNotDone === "expire" ? expireDays : null });
  const onceBody = () => ({
    title: title.trim(), notes: notes.trim(), ...options(),
    date: when === "pick" ? date : null,
    period: when === "week" ? "week" : when === "month" ? "month" : "day",
  });
  const owners = members.filter((m) => m.role === "housekeeper" || m.role === "adult");
  const ownerIsAdult = owners.find((m) => m.id === ownerId)?.role === "adult";

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setProblem(t("tasks.needTitle")); return; }
    setBusy(true);
    try {
      if (id === null) {
        await api("/tasks", "POST", mode === "repeat"
          ? { title: title.trim(), notes: notes.trim(), repeat: repeatBody(), period, ...options() }
          : onceBody());
      } else {
        await api(`/tasks/${id}`, "PATCH", isRecurring
          ? { title: title.trim(), notes: notes.trim(), repeat: repeatBody(), period, ...options() }
          : onceBody());
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
    <div className="narrow stack">
      <PageHeader back={<BackButton to="/tasks" label={t("nav.tasks")} />} title={id === null ? t("tasks.newTitle") : t("tasks.editTitle")} />
      <ErrorBanner message={problem} />
      <form className="card add-form" onSubmit={save}>
        <label className="field">
          <span>{t("tasks.nameLabel")}</span>
          <input type="text" value={title} maxLength={200} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("tasks.noteLabel")}</span>
          <textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>{t("tasks.ownerLabel")}</span>
            <select value={ownerId ?? ""} onChange={(e) => setOwnerId(e.target.value ? Number(e.target.value) : null)}>
              {owners.map((m) => <option key={m.id} value={m.role === "housekeeper" ? "" : m.id}>{m.name}</option>)}
            </select>
          </label>
        </div>
        <div className="field">
          <span>{t("tasks.priorityLabel")}</span>
          <div className="segmented prio-pick" role="group" aria-label={t("tasks.priorityLabel")}>
            {PRIORITIES.map(([p, key]) => (
              <button key={p} type="button" className={`btn p${p}${priority === p ? " on" : ""}`} aria-pressed={priority === p} onClick={() => setPriority(p)}>
                <span className={`dot p${p}`} aria-hidden="true" />{t(key)}
              </button>
            ))}
          </div>
        </div>

        {id === null && (
          <div className="segmented" role="group" aria-label={t("tasks.howOften")}>
            <button type="button" className={`btn${mode === "once" ? " on" : ""}`} aria-pressed={mode === "once"} onClick={() => setMode("once")}>{t("tasks.justOnce")}</button>
            <button type="button" className={`btn${mode === "repeat" ? " on" : ""}`} aria-pressed={mode === "repeat"} onClick={() => setMode("repeat")}>{t("tasks.repeats")}</button>
          </div>
        )}

        {mode === "once" && (
          <>
            <div className="segmented wrap" role="group" aria-label={t("tasks.when")}>
              {([["next", ownerIsAdult ? "date.today" : "tasks.nextVisit"], ["pick", "tasks.pickDay"], ["week", "period.thisWeek"], ["month", "period.thisMonth"]] as const).map(([w, key]) => (
                <button key={w} type="button" className={`btn${when === w ? " on" : ""}`} aria-pressed={when === w} onClick={() => setWhen(w)}>{t(key)}</button>
              ))}
            </div>
            {when === "pick" && (
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
              <span>{t("tasks.periodLabel")}</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                {PERIODS.map(([p, key]) => <option key={p} value={p}>{t(key)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("tasks.startLabel")}</span>
              <input type="date" min={id === null ? today : undefined} value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            {id !== null && <p className="hint">{t("tasks.futureOnly")}</p>}
          </>
        )}

        <div className="field-row">
          <label className="field">
            <span>{t("tasks.ifNotDoneLabel")}</span>
            <select value={ifNotDone} onChange={(e) => setIfNotDone(e.target.value as IfNotDone)}>
              {IF_NOT_DONE.map(([v, key]) => <option key={v} value={v}>{t(key)}</option>)}
            </select>
          </label>
          {ifNotDone === "expire" && (
            <label className="field qty">
              <span>{t("tasks.expireDaysLabel")}</span>
              <input type="number" inputMode="numeric" min={1} max={365} value={expireDays} onChange={(e) => setExpireDays(Number(e.target.value))} />
            </label>
          )}
        </div>
        <p className="hint">{t(ifNotDone === "carry" ? "ifNotDone.carryHint" : ifNotDone === "drop" ? "ifNotDone.dropHint" : "ifNotDone.expireHint", { n: expireDays })}</p>

        <PrimaryButton type="submit" onClick={() => undefined} disabled={busy}>{t("action.save")}</PrimaryButton>
      </form>

      {id !== null && (
        <section className="card">
          {isRecurring && (
            <SecondaryButton onClick={() => void setPaused(!active)}>{active ? t("tasks.pause") : t("tasks.resume")}</SecondaryButton>
          )}
          {!confirmDelete && <SecondaryButton danger onClick={() => setConfirmDelete(true)}>{t("tasks.delete")}</SecondaryButton>}
          {confirmDelete && (
            <div className="card warn" role="alert">
              <p className="card-title">{t("tasks.deleteConfirm")}</p>
              <div className="btn-row">
                <SecondaryButton danger onClick={() => void remove()}>{t("tasks.deleteYes")}</SecondaryButton>
                <SecondaryButton onClick={() => setConfirmDelete(false)}>{t("tasks.deleteNo")}</SecondaryButton>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
