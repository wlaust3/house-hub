import { FormEvent, useRef, useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { Grocery, Staple, Suggestion } from "../types";
import { dayLong } from "../format";
import { CheckRow, ErrorBanner, PageHeader, PrimaryButton, SecondaryButton } from "../components/ui";
import { Icon } from "../components/icons";

const REPEAT_CHOICES = [
  [0, "grocery.repeat.no"],
  [7, "grocery.repeat.week"],
  [14, "grocery.repeat.twoWeeks"],
  [30, "grocery.repeat.month"],
] as const;

/** The whole grocery list. Used on Home (inside a section) and on its own page. */
export function GroceryPanel({ onChange }: { onChange?: () => void }) {
  // Shared list: re-read every 10 seconds so other devices' changes show up.
  const { data, setData, error, reload } = useLoad(() => api<Grocery[]>("/grocery"), [], 10000);
  const { data: sugg, reload: reloadSugg } = useLoad(() => api<Suggestion[]>("/grocery/suggestions"), [], 0);
  const { data: staples, setData: setStaples, reload: reloadStaples } = useLoad(() => api<Staple[]>("/grocery/staples"), [], 0);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [every, setEvery] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (!data) return <p className="hint">{error ?? t("common.loading")}</p>;
  const bought = data.filter((g) => g.bought_at);
  const onList = new Set(data.filter((g) => !g.bought_at).map((g) => g.name.toLowerCase()));
  const typed = name.trim().toLowerCase();
  // While typing: matching things bought before. Otherwise: the usual items not on the list yet.
  const matches = (sugg ?? []).filter((s) => !onList.has(s.name.toLowerCase()) && (typed ? s.name.toLowerCase().startsWith(typed) && s.name.toLowerCase() !== typed : s.times > 1)).slice(0, typed ? 5 : 8);

  const changed = () => { onChange?.(); };

  const addItem = async (n: string, q: string, u: boolean, e: number) => {
    try {
      const item = await api<Grocery>("/grocery", "POST", { name: n, quantity: q, urgent: u, every_days: e || null });
      setData([...data.filter((g) => !g.bought_at), item, ...bought]); // the reload puts "Out" items first
      setProblem(null);
      void reload(); void reloadSugg();
      if (e) void reloadStaples();
      changed();
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const add = async (ev: FormEvent) => {
    ev.preventDefault();
    const n = name.trim();
    if (!n) { input.current?.focus(); return; }
    await addItem(n, qty.trim(), urgent, every);
    setName(""); setQty(""); setUrgent(false); setEvery(0);
    input.current?.focus(); // stay ready for the next item
  };

  const toggle = async (g: Grocery) => {
    const isBought = !g.bought_at;
    const stamp = new Date().toISOString();
    const next = data.map((x) => (x.id === g.id ? { ...x, bought_at: isBought ? stamp : null } : x));
    setData([...next.filter((x) => !x.bought_at), ...next.filter((x) => x.bought_at)]);
    try {
      await api(`/grocery/${g.id}`, "PATCH", { bought: isBought });
      setProblem(null);
      changed();
    } catch (err) {
      setProblem(errorText(err));
      void reload();
    }
  };

  const flagOut = async (g: Grocery) => {
    setData(data.map((x) => (x.id === g.id ? { ...x, urgent: !g.urgent } : x)));
    try { await api(`/grocery/${g.id}`, "PATCH", { urgent: !g.urgent }); changed(); } catch (err) { setProblem(errorText(err)); }
    void reload();
  };

  const clear = async () => {
    setConfirmClear(false);
    setData(data.filter((g) => !g.bought_at));
    try {
      await api("/grocery/clear-bought", "POST", {});
      changed();
    } catch (err) {
      setProblem(errorText(err));
      void reload();
    }
  };

  const stopRepeat = async (s: Staple) => {
    try { setStaples(await api<Staple[]>(`/grocery/staples/${s.id}`, "DELETE")); } catch (err) { setProblem(errorText(err)); }
  };

  return (
    <div className="stack">
      <ErrorBanner message={problem ?? error} />
      <form className="add-form" onSubmit={add}>
        <div className="field-row">
          <label className="field">
            <span>{t("grocery.nameLabel")}</span>
            <input ref={input} type="text" enterKeyHint="done" autoComplete="off" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field qty">
            <span>{t("grocery.qtyLabel")}</span>
            <input type="text" autoComplete="off" value={qty} maxLength={40} onChange={(e) => setQty(e.target.value)} />
          </label>
        </div>
        {typed && matches.length > 0 && (
          <div className="chips" aria-label={t("grocery.suggestions")}>
            {matches.map((s) => (
              <button key={s.name} type="button" className="chip" onClick={() => { setName(s.name); setQty(s.quantity ?? ""); input.current?.focus(); }}>{s.name}{s.quantity ? ` · ${s.quantity}` : ""}</button>
            ))}
          </div>
        )}
        <div className="field-row">
          <button type="button" className={`btn toggle out-toggle${urgent ? " on" : ""}`} aria-pressed={urgent} onClick={() => setUrgent(!urgent)}>
            <Icon name="alert" size={20} />{t("grocery.outNow")}
          </button>
          <label className="field">
            <span className="sr-only">{t("grocery.repeatLabel")}</span>
            <select value={every} onChange={(e) => setEvery(Number(e.target.value))} aria-label={t("grocery.repeatLabel")}>
              {REPEAT_CHOICES.map(([d, key]) => <option key={d} value={d}>{t(key)}</option>)}
            </select>
          </label>
          <PrimaryButton type="submit" onClick={() => undefined}><Icon name="plus" size={22} />{t("grocery.add")}</PrimaryButton>
        </div>
      </form>

      {!typed && matches.length > 0 && (
        <div className="stack tight">
          <p className="mini-head">{t("grocery.usual")}</p>
          <div className="chips">
            {matches.map((s) => (
              <button key={s.name} type="button" className="chip" onClick={() => void addItem(s.name, s.quantity ?? "", false, 0)}>
                <Icon name="plus" size={16} />{s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {data.length === 0 ? <p className="empty">{t("grocery.empty")}</p> : (
        <ul className="check-list flush">
          {data.map((g) => (
            <CheckRow key={g.id} checked={!!g.bought_at} title={g.name} sub={g.quantity || undefined} onToggle={() => void toggle(g)}
              tags={g.urgent && !g.bought_at ? <span className="tag prio p1">{t("grocery.out")}</span> : undefined}
              right={!g.bought_at ? (
                <button type="button" className={`icon-btn${g.urgent ? " danger-on" : ""}`} aria-pressed={g.urgent}
                  aria-label={g.urgent ? t("grocery.notUrgent") : t("grocery.markOut")} title={g.urgent ? t("grocery.notUrgent") : t("grocery.markOut")}
                  onClick={() => void flagOut(g)}><Icon name="alert" size={22} /></button>
              ) : undefined} />
          ))}
        </ul>
      )}

      {bought.length > 0 && !confirmClear && (
        <SecondaryButton onClick={() => setConfirmClear(true)}>{t("grocery.clear")}</SecondaryButton>
      )}
      {confirmClear && (
        <div className="card warn" role="alert">
          <p className="card-title">{plural("grocery.clearConfirm", bought.length)}</p>
          <div className="btn-row">
            <SecondaryButton danger onClick={() => void clear()}>{t("grocery.clearYes")}</SecondaryButton>
            <SecondaryButton onClick={() => setConfirmClear(false)}>{t("grocery.clearNo")}</SecondaryButton>
          </div>
        </div>
      )}

      {staples && staples.length > 0 && (
        <div className="stack tight">
          <p className="mini-head">{t("grocery.repeating")}</p>
          <ul className="plain-list mini-list">
            {staples.map((s) => (
              <li key={s.id} className="mini-row">
                <span className="grow">
                  <span className="row-title">{s.name}{s.quantity ? ` · ${s.quantity}` : ""}</span>
                  <span className="row-sub">{plural("grocery.everyDays", s.every_days)} · {t("grocery.nextOn", { day: dayLong(s.next_on) })}</span>
                </span>
                <button type="button" className="icon-btn" aria-label={t("grocery.stopRepeat")} title={t("grocery.stopRepeat")} onClick={() => void stopRepeat(s)}>
                  <Icon name="out" size={20} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function GroceryScreen() {
  return (
    <div className="narrow stack">
      <PageHeader title={t("grocery.title")} />
      <section className="card"><GroceryPanel /></section>
    </div>
  );
}
