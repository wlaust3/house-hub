import en from "./en.json";

// v1 is English only. To add a language later, add e.g. es.json with the SAME keys
// and extend `catalogs`. UI code must only ever call t("some.key") - never literal text.
export type Key = keyof typeof en;
const catalogs: Record<string, Record<string, string>> = { en };
let locale = "en";

export function setLocale(l: string) {
  if (catalogs[l]) locale = l;
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const s = catalogs[locale][key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
