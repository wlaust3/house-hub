import { ReactNode, useState } from "react";
import { t } from "../i18n";
import { stamp, dayLong } from "../format";
import type { Item, Priority } from "../types";
import { plural } from "../i18n";
import { weekdayName } from "../format";
import { Icon, IconName } from "./icons";

/** One dominant action per screen. */
export function PrimaryButton(p: { children: ReactNode; onClick: () => void; disabled?: boolean; type?: "button" | "submit"; sticky?: boolean }) {
  return (
    <button type={p.type ?? "button"} className={`btn primary${p.sticky ? " sticky" : ""}`} onClick={p.onClick} disabled={p.disabled}>
      {p.children}
    </button>
  );
}

export function SecondaryButton(p: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; pressed?: boolean }) {
  return (
    <button type="button" className={`btn secondary${p.danger ? " danger" : ""}`} onClick={p.onClick} disabled={p.disabled} aria-pressed={p.pressed}>
      {p.children}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="banner error"><Icon name="alert" size={20} /> {message}</p>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p role="status" className="banner info">{children}</p>;
}

/** Screen title with an optional line under it and actions on the right (wraps under on phones). */
export function PageHeader({ title, sub, back, actions }: { title: string; sub?: ReactNode; back?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      {back}
      <div className="page-head-row">
        <div className="page-title">
          <h1>{title}</h1>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

/** Remembers which sections are open on this device. */
function useOpen(key: string | undefined, fallback: boolean): [boolean, (v: boolean) => void] {
  const read = () => {
    if (!key) return fallback;
    try { const v = localStorage.getItem(`open:${key}`); return v === null ? fallback : v === "1"; } catch { return fallback; }
  };
  const [open, setOpen] = useState(read);
  return [open, (v) => { setOpen(v); try { if (key) localStorage.setItem(`open:${key}`, v ? "1" : "0"); } catch { /* private mode */ } }];
}

/**
 * A card with a heading. Lists inside run edge to edge with dividers.
 * With `collapsible` (a storage key) the heading opens and closes it; `summary` is the
 * one-line stats shown next to the title so a closed section still says something useful.
 */
export function Section({ title, children, hint, action, icon, className, collapsible, summary, defaultOpen = true }: {
  title: string; children: ReactNode; hint?: string; action?: ReactNode; icon?: IconName; className?: string;
  collapsible?: string; summary?: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useOpen(collapsible, defaultOpen);
  const shown = !collapsible || open;
  const heading = (
    <>
      <h2>{icon && <Icon name={icon} size={22} />}{title}</h2>
      {summary && <span className="summary">{summary}</span>}
    </>
  );
  return (
    <section className={`card section${className ? ` ${className}` : ""}${shown ? "" : " closed"}`}>
      <div className="card-head">
        {collapsible ? (
          <button type="button" className="head-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
            {heading}
            <Icon name={open ? "up" : "down"} size={22} />
          </button>
        ) : <div className="head-text">{heading}</div>}
        {shown && action}
      </div>
      {shown && hint && <p className="hint">{hint}</p>}
      {shown && children}
    </section>
  );
}

const PRIORITY_KEY = { 1: "priority.high", 2: "priority.normal", 3: "priority.low" } as const;

/** Small coloured label; normal priority shows nothing extra (the row's bar is enough). */
export function PriorityTag({ priority }: { priority: Priority }) {
  if (priority === 2) return null;
  return <span className={`tag prio p${priority}`}>{t(PRIORITY_KEY[priority])}</span>;
}

/** Chips for a task row: priority, week/month, owner (when it is not the housekeeper). */
export function taskTags(item: Item, showOwner: boolean): ReactNode {
  return (
    <>
      <PriorityTag priority={item.priority} />
      {item.period !== "day" && !item.carried_from && (
        <span className="tag">{item.period === "week" ? t("period.thisWeek") : t("period.thisMonth")}</span>
      )}
      {showOwner && item.owner_role !== "housekeeper" && item.owner_name && <span className="tag owner"><Icon name="user" size={14} />{item.owner_name}</span>}
    </>
  );
}

/** Back link. `phoneOnly` hides it where the sidebar already gets you there. */
export function BackButton({ to, label, phoneOnly }: { to: string; label: string; phoneOnly?: boolean }) {
  return (
    <a className={`back${phoneOnly ? " phone-only" : ""}`} href={`#${to}`}>
      <Icon name="left" size={22} /> {label}
    </a>
  );
}

export function LinkButton({ to, children, primary, sticky, icon }: { to: string; children: ReactNode; primary?: boolean; sticky?: boolean; icon?: IconName }) {
  return (
    <a className={`btn ${primary ? "primary" : "secondary"}${sticky ? " sticky" : ""}`} href={`#${to}`}>
      {icon && <Icon name={icon} size={22} />}{children}
    </a>
  );
}

/** "Carried over from Monday" (+ how many visits). */
export function carriedText(item: Pick<Item, "carried_from" | "carried_visits">): string | null {
  if (!item.carried_from) return null;
  const base = t("task.carriedOver", { day: weekdayName(item.carried_from) });
  return item.carried_visits > 1 ? `${base} · ${plural("task.carriedVisits", item.carried_visits)}` : base;
}

/** A large tappable row that toggles done / not done. The whole row is the button. */
export function CheckRow(p: {
  checked: boolean;
  title: string;
  sub?: ReactNode;
  carried?: string | null;
  onToggle?: () => void;
  readOnly?: boolean;
  right?: ReactNode;
  note?: string;
  onSaveNote?: (note: string) => Promise<void>;
  priority?: Priority;
  tags?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.note ?? "");
  const [busy, setBusy] = useState(false);
  const still = p.readOnly || !p.onToggle;

  const body = (
    <>
      <span className={`box${p.checked ? " on" : ""}${still ? " still" : ""}`} aria-hidden="true">{p.checked && <Icon name="check" size={20} />}</span>
      <span className="grow">
        <span className={`row-title${p.checked ? " struck" : ""}`}>{p.title}</span>
        {(p.carried || p.sub || p.tags) && (
          <span className="row-meta">
            {p.tags}
            {p.carried && <span className="tag carried">{p.carried}</span>}
            {p.sub && <span className="row-sub">{p.sub}</span>}
          </span>
        )}
      </span>
    </>
  );

  return (
    <li className={`check-item${p.checked ? " done" : ""}${p.priority ? ` p${p.priority}` : ""}`}>
      <div className="check-line">
        {still ? (
          <div className="check-row static">{body}</div>
        ) : (
          <button type="button" role="checkbox" aria-checked={p.checked} className="check-row" onClick={p.onToggle}>
            {body}
          </button>
        )}
        {p.onSaveNote && (
          <button type="button" className={`icon-btn note-btn${p.note ? " has" : ""}`} aria-expanded={editing}
            aria-label={p.note ? t("note.edit") : t("note.add")} title={p.note ? t("note.edit") : t("note.add")}
            onClick={() => { setDraft(p.note ?? ""); setEditing(!editing); }}>
            <Icon name="note" size={22} />
          </button>
        )}
        {p.right}
      </div>
      {p.note && !editing && <p className="note-text"><strong>{t("note.label")}:</strong> {p.note}</p>}
      {editing && p.onSaveNote && (
        <div className="note-edit">
          <label className="field">
            <span>{t("note.label")}</span>
            <textarea value={draft} maxLength={500} rows={3} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <div className="btn-row">
            <button type="button" className="btn primary small" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await p.onSaveNote!(draft); setEditing(false); } finally { setBusy(false); }
            }}>{t("action.save")}</button>
            <button type="button" className="btn secondary" onClick={() => setEditing(false)}>{t("action.cancel")}</button>
          </div>
        </div>
      )}
    </li>
  );
}

export function whenDone(item: Item): string | null {
  if (item.status !== "done" || !item.done_at) return null;
  return t("task.doneAt", { when: stamp(item.done_at) });
}

export function DayHeading({ date }: { date: string }) {
  return <h3 className="day-heading">{dayLong(date)}</h3>;
}
