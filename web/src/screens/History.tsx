import { api } from "../api";
import { t, Key } from "../i18n";
import { useLoad } from "../hooks";
import type { LogRow } from "../types";
import { stamp, dayLong } from "../format";
import { BackButton, ErrorBanner } from "../components/ui";

const ACTION_KEY: Record<string, Key> = {
  "task.done": "history.task.done",
  "task.undone": "history.task.undone",
  "task.added": "history.task.added",
  "task.edited": "history.task.edited",
  "task.deleted": "history.task.deleted",
  "task.paused": "history.task.paused",
  "task.resumed": "history.task.resumed",
  "task.noted": "history.task.noted",
  "visit.closed": "history.visit.closed",
  "visit.reopened": "history.visit.reopened",
  "grocery.added": "history.grocery.added",
  "grocery.bought": "history.grocery.bought",
  "grocery.unbought": "history.grocery.unbought",
  "grocery.cleared": "history.grocery.cleared",
  "request.created": "history.request.created",
  "request.approved": "history.request.approved",
  "request.done": "history.request.done",
  "day.out": "history.day.out",
  "day.out_undone": "history.day.outUndone",
  "day.out_changed": "history.day.outChanged",
  "schedule.changed": "history.schedule.changed",
};

function line(r: LogRow): string {
  const d = r.detail as Record<string, string | number | undefined>;
  const who = r.actor === "family" ? t("who.family") : r.actor === "housekeeper" ? t("who.housekeeper") : t("history.system");
  const key = ACTION_KEY[r.action];
  if (!key) return `${who}: ${r.action}`;
  return t(key, {
    who,
    title: String(d.title ?? d.name ?? ""),
    date: typeof d.date === "string" ? dayLong(d.date) : "",
    count: Number(d.count ?? d.carried ?? 0),
    done: Number(d.done ?? 0),
  });
}

export function HistoryScreen() {
  const { data, error } = useLoad(() => api<LogRow[]>("/log?limit=150"), [], 15000);
  return (
    <>
      <BackButton to="/more" label={t("nav.more")} />
      <h2>{t("history.title")}</h2>
      <ErrorBanner message={error} />
      {!data ? <p className="hint">{t("common.loading")}</p> : data.length === 0 ? <p className="empty">{t("history.empty")}</p> : (
        <ul className="plain-list history">
          {data.map((r) => (
            <li key={r.id} className="card">
              <span className="card-title">{line(r)}</span>
              <span className="row-sub">{stamp(r.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
