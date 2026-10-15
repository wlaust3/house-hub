import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { t } from "./i18n";

/** Message for the user: the server's plain-language text, or a generic one when offline. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.message) return e.message;
  return t("error.network");
}

/** Loads data now, again on a timer (shared lists update within `ms`), and when the tab is shown again. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], ms = 10000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = ms > 0 ? window.setInterval(() => void reload(), ms) : 0;
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, setData, error, reload };
}

export function useHashRoute(): [string, (to: string) => void] {
  const read = () => window.location.hash.replace(/^#/, "") || "/";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (to) => { window.location.hash = to; }];
}
