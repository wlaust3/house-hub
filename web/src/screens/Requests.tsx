import { FormEvent, useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { Request } from "../types";
import type { Role } from "../role";
import { stamp } from "../format";
import { ErrorBanner, PageHeader, PrimaryButton, PriorityTag, SecondaryButton } from "../components/ui";
import type { Priority } from "../types";
import { Icon } from "../components/icons";

const KIND_KEY = { buy: "request.kind.buy", approve: "request.kind.approve", other: "request.kind.other" } as const;
const PRIORITIES: [Priority, "priority.high" | "priority.normal" | "priority.low"][] = [[1, "priority.high"], [2, "priority.normal"], [3, "priority.low"]];
const STATUS_KEY = { submitted: "request.status.submitted", approved: "request.status.approved", done: "request.status.done" } as const;

export function RequestsScreen({ role }: { role: Role }) {
  const { data, error, reload } = useLoad(() => api<Request[]>("/requests"), [], 10000);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [kind, setKind] = useState<Request["kind"]>("buy");
  const [priority, setPriority] = useState<Priority>(2);
  const [problem, setProblem] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);

  if (!data) return <p className="hint">{error ?? t("common.loading")}</p>;
  const open = data.filter((r) => r.status !== "done");
  const finished = data.filter((r) => r.status === "done");

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setProblem(t("request.needTitle")); return; }
    try {
      await api("/requests", "POST", { title: title.trim(), details: details.trim(), kind, priority });
      setTitle(""); setDetails(""); setPriority(2); setProblem(null);
    } catch (err) {
      setProblem(errorText(err));
    }
    await reload();
  };

  const move = async (r: Request, status: "approved" | "done") => {
    try {
      await api(`/requests/${r.id}`, "PATCH", { status });
      setProblem(null);
    } catch (err) {
      setProblem(errorText(err));
    }
    await reload();
  };

  const card = (r: Request) => (
    <li key={r.id} className={`card request ${r.status} prio-card p${r.priority}`}>
      <div className="card-head">
        <p className="card-title">{r.title}</p>
        <span className="row-meta">
          {r.status !== "done" && <PriorityTag priority={r.priority} />}
          <span className={`tag status ${r.status}`}>{t(STATUS_KEY[r.status])}</span>
        </span>
      </div>
      <p className="row-sub">{t(KIND_KEY[r.kind])} · {t("request.updated", { when: stamp(r.updated_at) })}</p>
      {r.details && <p>{r.details}</p>}
      {role === "family" && r.status === "submitted" && (
        <div className="btn-row">
          <button type="button" className="btn primary small" onClick={() => void move(r, "approved")}>{t("request.approve")}</button>
          <SecondaryButton onClick={() => void move(r, "done")}>{t("request.markDone")}</SecondaryButton>
        </div>
      )}
      {role === "family" && r.status === "approved" && (
        <SecondaryButton onClick={() => void move(r, "done")}>{t("request.markDone")}</SecondaryButton>
      )}
    </li>
  );

  const lists = (
    <div className="stack">
      <h2>{plural("request.openTitle", open.length)}</h2>
      {open.length === 0 ? <p className="card soft empty">{t("request.none")}</p> : <ul className="request-grid">{open.map(card)}</ul>}
      {finished.length > 0 && (
        <>
          <SecondaryButton onClick={() => setShowFinished(!showFinished)} pressed={showFinished}>
            {plural("request.finished", finished.length)} <Icon name={showFinished ? "up" : "down"} size={20} />
          </SecondaryButton>
          {showFinished && <ul className="request-grid">{finished.map(card)}</ul>}
        </>
      )}
    </div>
  );

  return (
    <>
      <PageHeader title={t("request.title")} />
      <ErrorBanner message={problem ?? error} />

      {role === "housekeeper" ? (
        <div className="cols split">
          <form className="card add-form sticky-col" onSubmit={create}>
            <label className="field">
              <span>{t("request.whatLabel")}</span>
              <input type="text" value={title} maxLength={120} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="segmented" role="group" aria-label={t("request.kindLabel")}>
              {(Object.keys(KIND_KEY) as Request["kind"][]).map((k) => (
                <button key={k} type="button" className={`btn${kind === k ? " on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{t(KIND_KEY[k])}</button>
              ))}
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
            <label className="field">
              <span>{t("request.detailsLabel")}</span>
              <textarea rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
            </label>
            <PrimaryButton type="submit" onClick={() => undefined}>{t("request.send")}</PrimaryButton>
          </form>
          {lists}
        </div>
      ) : lists}
    </>
  );
}
