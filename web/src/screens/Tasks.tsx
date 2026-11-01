import { api } from "../api";
import { t } from "../i18n";
import { useLoad } from "../hooks";
import type { TaskDef, OneOff, Repeat } from "../types";
import { dayLong, weekdayName } from "../format";
import { BackButton, ErrorBanner, LinkButton, Section } from "../components/ui";

export function repeatText(r: Repeat): string {
  switch (r.kind) {
    case "daily": return t("repeat.daily");
    case "weekly": return t("repeat.weekly");
    case "monthly": return t("repeat.monthly");
    case "every_six_months": return t("repeat.sixMonths");
    default: return t(r.unit === "day" ? "repeat.customDays" : r.unit === "week" ? "repeat.customWeeks" : "repeat.customMonths", { n: r.n });
  }
}

export function TasksScreen() {
  const { data, error } = useLoad(() => api<{ recurring: TaskDef[]; one_offs: OneOff[] }>("/tasks"), [], 15000);
  if (!data) return <p className="hint">{error ?? t("common.loading")}</p>;
  return (
    <>
      <BackButton to="/more" label={t("nav.more")} />
      <h2>{t("tasks.title")}</h2>
      <ErrorBanner message={error} />
      <LinkButton to="/tasks/new" primary>{t("home.addTask")}</LinkButton>

      <Section title={t("tasks.repeating")}>
        {data.recurring.length === 0 && <p className="empty">{t("tasks.noneRepeating")}</p>}
        <ul className="plain-list">
          {data.recurring.map((r) => (
            <li key={r.id}>
              <a className="card link" href={`#/tasks/${r.id}`}>
                <span className="card-title">{r.title}</span>
                <span className="row-sub">{repeatText(r.repeat)}{!r.active && <> · <span className="tag">{t("tasks.paused")}</span></>}</span>
                {r.next_due && <span className="row-sub">{t("tasks.next", { day: dayLong(r.next_due) })}</span>}
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("tasks.once")}>
        {data.one_offs.length === 0 && <p className="empty">{t("tasks.noneOnce")}</p>}
        <ul className="plain-list">
          {data.one_offs.map((o) => (
            <li key={o.id}>
              <a className="card link" href={`#/tasks/${o.id}`}>
                <span className="card-title">{o.title}</span>
                <span className="row-sub">{t("tasks.willShow", { day: weekdayName(o.visit_date) })}</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
