import { FormEvent, useRef, useState } from "react";
import { api } from "../api";
import { t, plural } from "../i18n";
import { useLoad, errorText } from "../hooks";
import type { Grocery } from "../types";
import { CheckRow, ErrorBanner, PrimaryButton, SecondaryButton } from "../components/ui";

export function GroceryScreen() {
  // Shared list: re-read every 10 seconds so other devices' changes show up.
  const { data, setData, error, reload } = useLoad(() => api<Grocery[]>("/grocery"), [], 10000);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (!data) return <p className="hint">{error ?? t("common.loading")}</p>;
  const bought = data.filter((g) => g.bought_at);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) { input.current?.focus(); return; }
    try {
      const item = await api<Grocery>("/grocery", "POST", { name: n, quantity: qty.trim() });
      setData([...data.filter((g) => !g.bought_at), item, ...bought]);
      setName(""); setQty(""); setProblem(null);
    } catch (err) {
      setProblem(errorText(err));
    }
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
    } catch (err) {
      setProblem(errorText(err));
      void reload();
    }
  };

  const clear = async () => {
    setConfirmClear(false);
    setData(data.filter((g) => !g.bought_at));
    try {
      await api("/grocery/clear-bought", "POST", {});
    } catch (err) {
      setProblem(errorText(err));
      void reload();
    }
  };

  return (
    <>
      <h2>{t("grocery.title")}</h2>
      <ErrorBanner message={problem ?? error} />
      <form className="add-form" onSubmit={add}>
        <label className="field">
          <span>{t("grocery.nameLabel")}</span>
          <input ref={input} type="text" enterKeyHint="done" autoComplete="off" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("grocery.qtyLabel")}</span>
          <input type="text" autoComplete="off" value={qty} maxLength={40} onChange={(e) => setQty(e.target.value)} />
        </label>
        <PrimaryButton type="submit" onClick={() => undefined}>{t("grocery.add")}</PrimaryButton>
      </form>

      {data.length === 0 ? <p className="empty">{t("grocery.empty")}</p> : (
        <ul className="check-list">
          {data.map((g) => (
            <CheckRow key={g.id} checked={!!g.bought_at} title={g.name} sub={g.quantity || undefined} onToggle={() => void toggle(g)} />
          ))}
        </ul>
      )}

      {bought.length > 0 && !confirmClear && (
        <SecondaryButton onClick={() => setConfirmClear(true)}>{t("grocery.clear")}</SecondaryButton>
      )}
      {confirmClear && (
        <div className="card warn" role="alert">
          <p className="card-title">{plural("grocery.clearConfirm", bought.length)}</p>
          <div className="stack">
            <SecondaryButton danger onClick={() => void clear()}>{t("grocery.clearYes")}</SecondaryButton>
            <SecondaryButton onClick={() => setConfirmClear(false)}>{t("grocery.clearNo")}</SecondaryButton>
          </div>
        </div>
      )}
    </>
  );
}
