export type Repeat = { kind: "daily" | "weekly" | "monthly" | "every_six_months" | "custom"; n: number; unit: "day" | "week" | "month" };

export type Item = {
  id: number;
  task_id: number;
  title: string;
  task_notes: string;
  note: string;
  status: "pending" | "done" | "skipped";
  due_date: string;
  visit_date: string;
  done_at: string | null;
  done_by: string | null;
  recurring: boolean;
  repeat: Repeat | null;
  source: string;
  carried_from: string | null;
  carried_visits: number;
  priority: Priority;
  period: Period;
  period_end: string;
  owner_id: number | null;
  owner_name: string | null;
  owner_role: MemberRole;
  created_by: "housekeeper" | "family" | "system";
};

export type Priority = 1 | 2 | 3;
export type Period = "day" | "week" | "month";
export type IfNotDone = "carry" | "drop" | "expire";
export type MemberRole = "housekeeper" | "adult" | "child" | "baby";
export type Member = { id: number; name: string; role: MemberRole };
export type DayNote = { date: string; note: string; updated_by: string };
export type LostItem = { id: number; title: string; details: string; created_by: string; created_at: string; found_at?: string | null; found_by?: string | null; found_note?: string };
export type Staple = { id: number; name: string; quantity: string; every_days: number; next_on: string };
export type Suggestion = { name: string; quantity: string; times: number };
export type TestMode = { active: boolean; date: string | null; real_today: string };

export type OutDay = { date: string; reason: "appointment" | "sick" | "other"; mode: "hide" | "shift"; note: string; created_by?: string };

export type Home = {
  today: string;
  visit: { regular: boolean; open: boolean; out: OutDay | null; closed: boolean; extra: boolean; note: DayNote | null };
  today_items: Item[];
  next_visit: string;
  cant_come_date: string;
  coming_up: { date: string; out: OutDay | null; extra: boolean; note: DayNote | null; items: Item[] }[];
  due_soon: Item[];
  requests_waiting: { id: number; title: string; kind: string; created_at: string }[];
  requests_approved: number;
  family_tasks: Item[];
  requests_open: { id: number; title: string; details: string; kind: string; status: "submitted" | "approved"; priority: Priority; created_at: string }[];
  lost: LostItem[];
  grocery: { to_buy: number; urgent: number; bought: number };
  housekeeper_name: string | null;
};

export type Grocery = { id: number; name: string; quantity: string; added_by: string; added_at: string; bought_at: string | null; urgent: boolean };

export type Request = {
  id: number; title: string; details: string; kind: "buy" | "approve" | "other";
  status: "submitted" | "approved" | "done"; priority: Priority; created_at: string; approved_at: string | null; done_at: string | null; updated_at: string;
};

export type ScheduleInfo = {
  weekdays: number[];
  today: string;
  out_days: OutDay[];
  visits: { date: string; out: OutDay | null; extra: boolean; note: string }[];
};

export type CalendarDay = {
  date: string; weekday: number; visit: boolean; out: OutDay | null; closed: boolean;
  open_count: number; done_count: number; items: Item[];
};

export type TaskOptions = {
  priority: Priority; period: Period; if_not_done: IfNotDone; expire_days: number | null;
  owner_id: number | null; owner_name: string | null; created_by: string;
};

export type TaskDef = TaskOptions & {
  id: number; title: string; notes: string; active: boolean;
  repeat: Repeat & { start: string; ends_on: string | null };
  next_due: string | null;
};
export type OneOff = TaskOptions & { id: number; title: string; notes: string; due_date: string; visit_date: string; rolled_from: string | null };

export type LogRow = { id: number; at: string; actor: string; action: string; entity: string; entity_id: number | null; detail: Record<string, unknown>; test: boolean };
