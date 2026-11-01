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
