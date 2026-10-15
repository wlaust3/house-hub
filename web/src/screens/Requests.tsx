import { FormEvent, useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { Request } from "../types";
import type { Role } from "../role";
import { stamp } from "../format";
import { ErrorBanner, PrimaryButton, SecondaryButton, Section } from "../components/ui";

const KIND_KEY = { buy: "request.kind.buy", approve: "request.kind.approve", other: "request.kind.other" } as const;
const STATUS_KEY = { submitted: "request.status.submitted", approved: "request.status.approved", done: "request.status.done" } as const;

export function RequestsScreen({ role }: { role: Role }) {
  const { data, error, reload } = useLoad(() => api<Request[]>("/requests"), [], 10000);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [kind, setKind] = useState<Request["kind"]>("buy");
  const [problem, setProblem] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);

  if (!data) return <p className="hint">{error ?? t("common.loading")}</p>;
  const open = data.filter((r) => r.status !== "done");
  const finished = data.filter((r) => r.status === "done");

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setProblem(t("request.needTitle")); return; }
    try {
      await api("/requests", "POST", { title: title.trim(), details: details.trim(), kind });
      setTitle(""); setDetails(""); setProblem(null);
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
    <li key={r.id} className={`card request ${r.status}`}>
      <p className="card-title">{r.title}</p>
      <p className="row-sub">
        <span className={`tag status ${r.status}`}>{t(STATUS_KEY[r.status])}</span> {t(KIND_KEY[r.kind])}
      </p>
      {r.details && <p>{r.details}</p>}
      <p className="hint">{t("request.updated", { when: stamp(r.updated_at) })}</p>
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

  return (
    <>
      <h2>{t("request.title")}</h2>
      <ErrorBanner message={problem ?? error} />

      {role === "housekeeper" && (
        <form className="add-form" onSubmit={create}>
          <label className="field">
            <span>{t("request.whatLabel")}</span>
            <input type="text" value={title} maxLength={120} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="btn-row" role="group" aria-label={t("request.kindLabel")}>
            {(Object.keys(KIND_KEY) as Request["kind"][]).map((k) => (
              <button key={k} type="button" className={`btn toggle${kind === k ? " on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{t(KIND_KEY[k])}</button>
            ))}
          </div>
          <label className="field">
            <span>{t("request.detailsLabel")}</span>
            <textarea rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <PrimaryButton type="submit" onClick={() => undefined}>{t("request.send")}</PrimaryButton>
        </form>
      )}

      <Section title={plural("request.openTitle", open.length)}>
        {open.length === 0 ? <p className="empty">{t("request.none")}</p> : <ul className="plain-list">{open.map(card)}</ul>}
      </Section>

      {finished.length > 0 && (
        <section className="section">
          <SecondaryButton onClick={() => setShowFinished(!showFinished)} pressed={showFinished}>
            {plural("request.finished", finished.length)} {showFinished ? "▲" : "▼"}
          </SecondaryButton>
          {showFinished && <ul className="plain-list">{finished.map(card)}</ul>}
        </section>
      )}
    </>
  );
}
