import { FormEvent, useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { Home, Item, LostItem, OutDay } from "../types";
import type { Role } from "../role";
import { dayHeading, dayLabel, dayLong, weekdayName } from "../format";
import { CheckRow, ErrorBanner, LinkButton, PageHeader, PrimaryButton, SecondaryButton, Section, carriedText, taskTags, whenDone } from "../components/ui";
import { Icon } from "../components/icons";
import { GroceryPanel } from "./Grocery";

/** Red banner for something the family is looking for. "Found it" can take a short note. */
function LostBanner({ item, onDone }: { item: LostItem; onDone: () => void }) {
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const found = async () => {
    try { await api(`/lost/${item.id}`, "PATCH", { found: true, note }); onDone(); } catch (e) { setProblem(errorText(e)); }
  };
  return (
    <div className="lost-banner" role="status">
      <div className="lost-line">
        <span className="lost-icon"><Icon name="search" /></span>
        <span className="grow">
          <span className="row-title">{t("lost.lookingFor", { title: item.title })}</span>
          {item.details && <span className="row-sub">{item.details}</span>}
        </span>
        {!finding && <button type="button" className="btn lost-btn" onClick={() => setFinding(true)}><Icon name="check" size={20} />{t("lost.found")}</button>}
      </div>
      {finding && (
        <div className="lost-found">
          <ErrorBanner message={problem} />
          <label className="field">
            <span>{t("lost.whereLabel")}</span>
            <input type="text" value={note} maxLength={200} autoComplete="off" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="btn-row">
            <button type="button" className="btn lost-btn" onClick={() => void found()}>{t("lost.confirmFound")}</button>
            <SecondaryButton onClick={() => setFinding(false)}>{t("action.cancel")}</SecondaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

function AddLost({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setProblem(t("lost.needTitle")); return; }
    try { await api("/lost", "POST", { title: title.trim(), details: details.trim() }); onDone(); } catch (err) { setProblem(errorText(err)); }
  };
  return (
    <form className="card add-form" onSubmit={save}>
      <p className="card-title">{t("lost.addTitle")}</p>
      <ErrorBanner message={problem} />
      <label className="field">
        <span>{t("lost.whatLabel")}</span>
        <input type="text" value={title} maxLength={120} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>{t("lost.detailsLabel")}</span>
        <input type="text" value={details} maxLength={300} autoComplete="off" onChange={(e) => setDetails(e.target.value)} />
      </label>
      <div className="btn-row">
        <PrimaryButton type="submit" onClick={() => undefined}>{t("lost.add")}</PrimaryButton>
        <SecondaryButton onClick={onDone}>{t("action.cancel")}</SecondaryButton>
      </div>
    </form>
  );
}

/** Housekeeper's note for a day, e.g. "Coming at 11". The family sees it on Home. */
function DayNoteEditor({ date, current, onDone }: { date: string; current: string; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(current);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    try { await api(`/day-notes/${date}`, "PUT", { note: text }); setEditing(false); onDone(); } catch (e) { setProblem(errorText(e)); }
  };
  if (!editing) {
    return (
      <SecondaryButton onClick={() => { setText(current); setEditing(true); }}>
        <Icon name="note" size={20} />{current ? t("dayNote.edit") : t("dayNote.add")}
      </SecondaryButton>
    );
  }
  return (
    <div className="card">
      <ErrorBanner message={problem} />
      <label className="field">
        <span>{t("dayNote.label")}</span>
        <textarea rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="btn-row">
        <button type="button" className="btn primary small" onClick={() => void save()}>{t("action.save")}</button>
        <SecondaryButton onClick={() => setEditing(false)}>{t("action.cancel")}</SecondaryButton>
      </div>
    </div>
  );
}

export function HomeScreen({ role }: { role: Role }) {
  const { data, setData, error, reload } = useLoad(() => api<Home>("/home"), [], 10000);
  const [problem, setProblem] = useState<string | null>(null);
  const [askOut, setAskOut] = useState(false);
  const [outNote, setOutNote] = useState("");
  const [addingLost, setAddingLost] = useState(false);

  if (!data) return <p className="hint">{error ?? t("common.loading")}</p>;
  const h = data;
  const name = h.housekeeper_name ?? t("who.housekeeper");
  const isFamily = role === "family";

  const toggle = async (item: Item) => {
    const done = item.status !== "done";
    const flip = (list: Item[]) => list.map((i) => (i.id === item.id ? { ...i, status: done ? "done" as const : "pending" as const } : i));
    setData({ ...h, today_items: flip(h.today_items), family_tasks: flip(h.family_tasks) });
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
  const markOut = async () => {
    try {
      await api("/days-out", "POST", { date: h.cant_come_date, note: outNote.trim() });
      setAskOut(false);
      setOutNote("");
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

  const rows = (items: Item[], editable: boolean, showOwner = false) =>
    items.map((i) => (
      <CheckRow
        key={i.id}
        checked={i.status === "done"}
        title={i.title}
        carried={carriedText(i)}
        sub={whenDone(i) ?? (showOwner && i.visit_date !== h.today && i.status !== "done" ? t("task.dueOn", { day: dayLabel(i.visit_date, h.today) }) : undefined)}
        note={i.note}
        priority={i.priority}
        tags={taskTags(i, showOwner)}
        onToggle={editable ? () => void toggle(i) : undefined}
        readOnly={!editable}
        onSaveNote={(n) => saveNote(i, n)}
      />
    ));

  const outBanner = (date: string, out: OutDay) => (
    <div className="card out" key={date}>
      <p className="card-title">{isFamily ? t("out.banner", { name, day: dayLabel(date, h.today) }) : t("out.youBanner", { day: dayLabel(date, h.today) })}</p>
      {out.note && <p>{out.note}</p>}
      <SecondaryButton onClick={() => void undoOut(date)}>{t("out.undo")}</SecondaryButton>
    </div>
  );
  const noteBanner = (note: string) => (
    <div className="day-note"><Icon name="note" size={20} /><span><strong>{t("dayNote.from", { name })}</strong> {note}</span></div>
  );

  const showList = h.visit.open || h.visit.closed;
  const total = h.today_items.length;
  const doneCount = h.today_items.filter((i) => i.status === "done").length;
  const high = h.today_items.filter((i) => i.priority === 1 && i.status !== "done").length;
  const famOpen = h.family_tasks.filter((i) => i.status !== "done");
  const famToday = famOpen.filter((i) => i.visit_date <= h.today).length;
  const comingCount = h.coming_up.reduce((n, c) => n + c.items.length, 0);
  const visits = h.coming_up.filter((c) => !c.out).length;
  const g = h.grocery;

  const todaySummary = showList && total > 0
    ? [t("home.progress", { done: doneCount, n: total }), high ? plural("home.highCount", high) : ""].filter(Boolean).join(" · ")
    : h.visit.out ? t("out.short") : !h.visit.regular ? t("home.noVisitShort") : undefined;

  return (
    <>
      <PageHeader
        title={dayLong(h.today)}
        sub={!isFamily ? t("home.greeting", { name }) : h.visit.regular ? undefined : t("home.nextVisit", { day: dayLabel(h.next_visit, h.today) })}
        actions={
          <>
            {!addingLost && <SecondaryButton onClick={() => setAddingLost(true)}><Icon name="search" size={20} />{t("lost.button")}</SecondaryButton>}
            {isFamily && <LinkButton to="/tasks/new" icon="plus" primary={h.requests_waiting.length === 0}>{t("home.addTask")}</LinkButton>}
          </>
        }
      />
      <ErrorBanner message={problem ?? error} />

      {h.lost.map((l) => <LostBanner key={l.id} item={l} onDone={() => void reload()} />)}
      {addingLost && <AddLost onDone={() => { setAddingLost(false); void reload(); }} />}

      {isFamily && h.requests_waiting.length > 0 && (
        <a className="callout" href="#/requests">
          <span className="callout-icon"><Icon name="inbox" /></span>
          <span className="grow">{plural("home.requestsWaiting", h.requests_waiting.length)}</span>
          <Icon name="right" />
        </a>
      )}

      <div className="cols home">
        <div className="side">
          {/* ---------- The adults' own tasks ---------- */}
          {isFamily && (
            <Section title={t("home.familyTasks")} icon="users" collapsible="family"
              summary={famOpen.length ? [plural("home.openCount", famOpen.length), famToday ? plural("home.dueTodayCount", famToday) : ""].filter(Boolean).join(" · ") : t("home.allClear")}>
              {h.family_tasks.length === 0 ? <p className="empty">{t("home.noFamilyTasks")}</p> : <ul className="check-list">{rows(h.family_tasks, true, true)}</ul>}
            </Section>
          )}

          {/* ---------- Today ---------- */}
          <Section title={isFamily ? t("home.todayFor", { name }) : t("home.today")} icon="sun" collapsible="today" summary={todaySummary}>
            {showList && total > 0 && (
              <div className="progress" aria-hidden="true"><div className="progress-bar"><span style={{ width: `${(doneCount / total) * 100}%` }} /></div></div>
            )}
            {h.visit.note && isFamily && noteBanner(h.visit.note.note)}
            {h.visit.out && outBanner(h.today, h.visit.out)}
            {!h.visit.regular && (
              <div className="card soft">
                <p className="card-title">{t("home.nextVisit", { day: dayLabel(h.next_visit, h.today) })}</p>
                <p className="hint">{t("home.notVisitDay", { name })}</p>
              </div>
            )}
            {h.visit.closed && (
              <div className="card ok">
                <p className="card-title">{t("home.finished")}</p>
                <p className="hint">{t("home.nextVisit", { day: dayLabel(h.next_visit, h.today) })}</p>
                {!isFamily && <SecondaryButton onClick={() => void reopen()}>{t("home.reopen")}</SecondaryButton>}
              </div>
            )}
            {showList && total === 0 && <p className="empty">{t("home.nothingToday")}</p>}
            {showList && total > 0 && <ul className="check-list">{rows(h.today_items, true)}</ul>}
            {/* One dominant action per screen */}
            {!isFamily && h.visit.open && <LinkButton to="/end-of-day" primary sticky icon="check">{t("home.beforeLeave")}</LinkButton>}
          </Section>

          {/* ---------- Groceries ---------- */}
          <Section title={t("grocery.title")} icon="cart" collapsible="groceries" defaultOpen={false}
            summary={g.to_buy ? [plural("grocery.toBuyCount", g.to_buy), g.urgent ? plural("grocery.outCount", g.urgent) : ""].filter(Boolean).join(" · ") : t("grocery.empty")}>
            <GroceryPanel onChange={() => void reload()} />
          </Section>
        </div>

        <div className="side">
          {!isFamily && !askOut && !h.visit.out && (
            <SecondaryButton onClick={() => setAskOut(true)}>{t("home.cantCome", { day: dayLabel(h.cant_come_date, h.today) })}</SecondaryButton>
          )}
          {!isFamily && askOut && (
            <div className="card">
              <p className="card-title">{t("home.cantCome", { day: dayLabel(h.cant_come_date, h.today) })}</p>
              <label className="field">
                <span>{t("out.noteLabel")}</span>
                <textarea rows={2} maxLength={200} value={outNote} onChange={(e) => setOutNote(e.target.value)} />
              </label>
              <div className="btn-row">
                <button type="button" className="btn primary small" onClick={() => void markOut()}>{t("out.confirm")}</button>
                <SecondaryButton onClick={() => setAskOut(false)}>{t("action.back")}</SecondaryButton>
              </div>
            </div>
          )}
          {!isFamily && (h.visit.regular || h.visit.out) && <DayNoteEditor date={h.today} current={h.visit.note?.note ?? ""} onDone={() => void reload()} />}

          {/* ---------- Coming up ---------- */}
          <Section title={t("home.comingUp")} icon="calendar" collapsible="coming"
            summary={[plural("home.visitCount", visits), plural("calendar.tasks", comingCount)].join(" · ")}>
            {h.coming_up.length === 0 && <p className="empty">{t("home.nothingComing")}</p>}
            {h.coming_up.map((c) => (
              <div key={c.date} className="day-block">
                <h3 className="day-heading">{dayHeading(c.date, h.today)}{c.extra && <span className="tag">{t("schedule.extra")}</span>}</h3>
                {c.note && noteBanner(c.note.note)}
                {c.out ? outBanner(c.date, c.out) : c.items.length === 0 ? <p className="empty">{t("home.nothingPlanned")}</p> : <ul className="check-list">{rows(c.items, false)}</ul>}
              </div>
            ))}
          </Section>

          {h.due_soon.length > 0 && (
            <Section title={t("home.dueSoon")} icon="clock" hint={t("home.dueSoonHint")} collapsible="dueSoon" defaultOpen={false}
              summary={plural("calendar.tasks", h.due_soon.length)}>
              <ul className="check-list">
                {h.due_soon.map((i) => (
                  <CheckRow key={i.id} checked={false} readOnly title={i.title} note={i.note} priority={i.priority} tags={taskTags(i, false)}
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
