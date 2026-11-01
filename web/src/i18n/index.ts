import en from "./en.json";

// v1 is English only. To add a language later, add e.g. es.json with the SAME keys
// and extend `catalogs`. UI code must only ever call t("some.key") - never literal text.
export type Key = keyof typeof en;
type PluralBase = Extract<Key, `${string}.one`> extends `${infer B}.one` ? B : never;
export type PluralKey = PluralBase;

const catalogs: Record<string, Record<string, string>> = { en };
let locale = "en";

export function setLocale(l: string) {
  if (catalogs[l]) locale = l;
}

export function getLocale(): string {
  return locale;
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const s = catalogs[locale][key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

/** Picks "<base>.one" or "<base>.other" using the active locale's plural rules; {n} is filled in. */
export function plural(base: PluralKey, n: number, vars: Record<string, string | number> = {}): string {
  const form = new Intl.PluralRules(locale).select(n) === "one" ? "one" : "other";
  return t(`${base}.${form}` as Key, { n, ...vars });
}
