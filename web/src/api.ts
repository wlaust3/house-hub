import { getRole } from "./role";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** One request per action, JSON in and out. The role header is advisory (no login in v1). */
export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const role = getRole();
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(role ? { "x-role": role } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? "";
    throw new ApiError(res.status, msg);
  }
  return json as T;
}
