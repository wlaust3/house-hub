import { HttpError } from "../services/context.js";

export const ROLES = ["housekeeper", "family"];

/** The role comes from the X-Role header. It is a convenience for logging and hiding screens, NOT security. */
export function roleMiddleware(req, _res, next) {
  const r = String(req.get("x-role") ?? "").toLowerCase();
  req.role = ROLES.includes(r) ? r : null;
  next();
}

export function actor(req) {
  if (!req.role) throw new HttpError(400, "Say who you are first (X-Role: housekeeper or family).");
  return req.role;
}

export function requireFamily(req) {
  const a = actor(req);
  if (a !== "family") throw new HttpError(403, "Only the family can do that.");
  return a;
}

/** Wrap a handler so thrown HttpErrors become JSON responses. */
export const h = (fn) => (req, res, next) => {
  try {
    fn(req, res, next);
  } catch (e) {
    next(e);
  }
};
