import { ReactNode, useState } from "react";
import { t } from "../i18n";
import { stamp, dayLong } from "../format";
import type { Item } from "../types";
import { plural } from "../i18n";
import { weekdayName } from "../format";

/** One dominant action per screen. */
export function PrimaryButton(p: { children: ReactNode; onClick: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button type={p.type ?? "button"} className="btn primary" onClick={p.onClick} disabled={p.disabled}>
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
  return <p role="alert" className="banner error">{message}</p>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p role="status" className="banner info">{children}</p>;
}

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

export function BackButton({ to, label }: { to: string; label: string }) {
  return (
    <a className="btn secondary back" href={`#${to}`}>
      <span aria-hidden="true">←</span> {label}
    </a>
  );
}

export function LinkButton({ to, children, primary }: { to: string; children: ReactNode; primary?: boolean }) {
  return <a className={`btn ${primary ? "primary" : "secondary"}`} href={`#${to}`}>{children}</a>;
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

  const body = (
    <>
      <span className={`box${p.checked ? " on" : ""}`} aria-hidden="true">{p.checked ? "✓" : ""}</span>
      <span className="grow">
        <span className={`row-title${p.checked ? " struck" : ""}`}>{p.title}</span>
        {p.carried && <span className="tag carried">{p.carried}</span>}
        {p.sub && <span className="row-sub">{p.sub}</span>}
      </span>
    </>
  );

  return (
    <li className="check-item">
      <div className="check-line">
        {p.readOnly || !p.onToggle ? (
          <div className={`check-row static${p.checked ? " done" : ""}`}>{body}</div>
        ) : (
          <button type="button" role="checkbox" aria-checked={p.checked} className={`check-row${p.checked ? " done" : ""}`} onClick={p.onToggle}>
            {body}
          </button>
        )}
        {p.onSaveNote && (
          <button type="button" className="btn secondary note-btn" aria-expanded={editing} onClick={() => { setDraft(p.note ?? ""); setEditing(!editing); }}>
            {p.note ? t("note.edit") : t("note.add")}
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
