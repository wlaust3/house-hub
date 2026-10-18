import { ReactNode, useState } from "react";
import { t } from "../i18n";
import { stamp, dayLong } from "../format";
import type { Item } from "../types";
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

/** A card with a heading. Lists inside run edge to edge with dividers. */
export function Section({ title, children, hint, action, icon, className }: { title: string; children: ReactNode; hint?: string; action?: ReactNode; icon?: IconName; className?: string }) {
  return (
    <section className={`card section${className ? ` ${className}` : ""}`}>
      <div className="card-head">
        <h2>{icon && <Icon name={icon} size={22} />}{title}</h2>
        {action}
      </div>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
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
        {(p.carried || p.sub) && (
          <span className="row-meta">
            {p.carried && <span className="tag carried">{p.carried}</span>}
            {p.sub && <span className="row-sub">{p.sub}</span>}
          </span>
        )}
      </span>
    </>
  );

  return (
    <li className={`check-item${p.checked ? " done" : ""}`}>
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
