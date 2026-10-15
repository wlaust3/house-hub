import { useEffect, useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import { errorText } from "../hooks";
import type { Home } from "../types";
import { dayLabel, dayLong } from "../format";
import { BackButton, CheckRow, ErrorBanner, PrimaryButton, SecondaryButton, carriedText } from "../components/ui";

export function EndOfDayScreen({ go }: { go: (to: string) => void }) {
  const [home, setHome] = useState<Home | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api<Home>("/home")
      .then((h) => {
        setHome(h);
        setChecked(new Set(h.today_items.filter((i) => i.status === "done").map((i) => i.id)));
      })
      .catch((e) => setProblem(errorText(e)));
  }, []);

  if (!home) return <><BackButton to="/" label={t("nav.home")} /><ErrorBanner message={problem} />{!problem && <p className="hint">{t("common.loading")}</p>}</>;

  const items = home.today_items;
  const left = items.filter((i) => !checked.has(i.id));
  const toggle = (id: number) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
    setConfirming(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api(`/visits/${home.today}/close`, "POST", { done_ids: [...checked] });
      go("/");
    } catch (e) {
      setProblem(errorText(e));
      setBusy(false);
    }
  };

  const press = () => {
    if (left.length === 0) void save();
    else setConfirming(true);
  };

  return (
    <>
      <BackButton to="/" label={t("nav.home")} />
      <h2>{t("end.title")}</h2>
      <p className="hint">{t("end.hint", { day: dayLong(home.today) })}</p>
      <ErrorBanner message={problem} />
      {items.length === 0 ? <p className="empty">{t("home.nothingToday")}</p> : (
        <ul className="check-list">
          {items.map((i) => (
            <CheckRow key={i.id} checked={checked.has(i.id)} title={i.title} carried={carriedText(i)} onToggle={() => toggle(i.id)} />
          ))}
        </ul>
      )}
      {confirming ? (
        <div className="card warn" role="alert">
          <p className="card-title">{plural("end.carry", left.length, { day: dayLabel(home.next_visit, home.today) })}</p>
          <div className="stack">
            <PrimaryButton onClick={() => void save()} disabled={busy}>{t("end.confirm")}</PrimaryButton>
            <SecondaryButton onClick={() => setConfirming(false)}>{t("end.goBack")}</SecondaryButton>
          </div>
        </div>
      ) : (
        <PrimaryButton onClick={press} disabled={busy}>{t("end.allDone")}</PrimaryButton>
      )}
    </>
  );
}
