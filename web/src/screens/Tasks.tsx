import { api } from "../api";
import { t } from "../i18n";
import { useLoad } from "../hooks";
import type { TaskDef, OneOff, Repeat } from "../types";
import { dayLong, weekdayName } from "../format";
import { BackButton, ErrorBanner, LinkButton, PageHeader, PriorityTag, Section } from "../components/ui";
import { Icon } from "../components/icons";

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
      <PageHeader back={<BackButton to="/more" label={t("nav.more")} phoneOnly />} title={t("tasks.title")}
        actions={<LinkButton to="/tasks/new" primary icon="plus">{t("home.addTask")}</LinkButton>} />
      <ErrorBanner message={error} />

      <div className="cols even">
        <Section title={t("tasks.repeating")} icon="history">
          {data.recurring.length === 0 && <p className="empty">{t("tasks.noneRepeating")}</p>}
          <ul className="check-list link-list">
            {data.recurring.map((r) => (
              <li key={r.id}>
                <a className={`link-row prio-bar p${r.priority}`} href={`#/tasks/${r.id}`}>
                  <span className="grow">
                    <span className="row-title">{r.title}</span>
                    <span className="row-meta">
                      <PriorityTag priority={r.priority} />
                      {r.owner_name && <span className="tag owner"><Icon name="user" size={14} />{r.owner_name}</span>}
                      <span className="row-sub">{repeatText(r.repeat)}</span>
                      {!r.active && <span className="tag">{t("tasks.paused")}</span>}
                      {r.next_due && r.active && <span className="row-sub">{t("tasks.next", { day: dayLong(r.next_due) })}</span>}
                    </span>
                  </span>
                  <Icon name="right" size={20} />
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("tasks.once")} icon="check">
          {data.one_offs.length === 0 && <p className="empty">{t("tasks.noneOnce")}</p>}
          <ul className="check-list link-list">
            {data.one_offs.map((o) => (
              <li key={o.id}>
                <a className={`link-row prio-bar p${o.priority}`} href={`#/tasks/${o.id}`}>
                  <span className="grow">
                    <span className="row-title">{o.title}</span>
                    <span className="row-meta">
                      <PriorityTag priority={o.priority} />
                      {o.owner_name && <span className="tag owner"><Icon name="user" size={14} />{o.owner_name}</span>}
                      <span className="row-sub">{t("tasks.willShow", { day: weekdayName(o.visit_date) })}</span>
                    </span>
                  </span>
                  <Icon name="right" size={20} />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
