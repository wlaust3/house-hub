// Request status rules. submitted -> approved -> done, and submitted -> done.
export const STATUSES = ["submitted", "approved", "done"];
export const KINDS = ["buy", "approve", "other"];

const ALLOWED = {
  submitted: ["approved", "done"],
  approved: ["done"],
  done: [],
};

export function allowedNext(status) {
  return ALLOWED[status] ?? [];
}

export function canTransition(from, to) {
  return allowedNext(from).includes(to);
}

/** Returns an error message or null. */
export function transitionError(from, to) {
  if (!STATUSES.includes(to)) return "Status must be submitted, approved or done.";
  if (from === to) return `This request is already ${to}.`;
  if (!canTransition(from, to)) return `A request cannot go from ${from} to ${to}.`;
  return null;
}
