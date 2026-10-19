export type Role = "housekeeper" | "family";

const KEY = "role";

export function getRole(): Role | null {
  const v = localStorage.getItem(KEY);
  return v === "housekeeper" || v === "family" ? v : null;
}

export function setRole(r: Role | null) {
  if (r) localStorage.setItem(KEY, r);
  else localStorage.removeItem(KEY);
}

// Test mode is per device: only this device talks to the sandbox copy on the server.
const TEST_KEY = "testMode";

export function inTestMode(): boolean {
  try { return localStorage.getItem(TEST_KEY) === "1"; } catch { return false; }
}

export function setTestMode(on: boolean) {
  if (on) localStorage.setItem(TEST_KEY, "1");
  else localStorage.removeItem(TEST_KEY);
}
