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
};

export type OutDay = { date: string; reason: "appointment" | "sick" | "other"; mode: "hide" | "shift"; note: string; created_by?: string };

export type Home = {
  today: string;
  visit: { regular: boolean; open: boolean; out: OutDay | null; closed: boolean };
  today_items: Item[];
  next_visit: string;
  cant_come_date: string;
  coming_up: { date: string; out: OutDay | null; items: Item[] }[];
  due_soon: Item[];
  requests_waiting: { id: number; title: string; kind: string; created_at: string }[];
  requests_approved: number;
};

export type Grocery = { id: number; name: string; quantity: string; added_by: string; added_at: string; bought_at: string | null };

export type Request = {
  id: number; title: string; details: string; kind: "buy" | "approve" | "other";
  status: "submitted" | "approved" | "done"; created_at: string; approved_at: string | null; done_at: string | null; updated_at: string;
};

export type ScheduleInfo = {
  weekdays: number[];
  today: string;
  out_days: OutDay[];
  visits: { date: string; out: OutDay | null }[];
};

export type CalendarDay = {
  date: string; weekday: number; visit: boolean; out: OutDay | null; closed: boolean;
  open_count: number; done_count: number; items: Item[];
};

export type TaskDef = {
  id: number; title: string; notes: string; active: boolean;
  repeat: Repeat & { start: string; ends_on: string | null };
  next_due: string | null;
};
export type OneOff = { id: number; title: string; notes: string; due_date: string; visit_date: string; rolled_from: string | null };

export type LogRow = { id: number; at: string; actor: string; action: string; entity: string; entity_id: number | null; detail: Record<string, unknown> };
