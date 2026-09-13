/** Tipos do módulo de agendamento (Fase A). Espelham as tabelas da migration 053. */

export type ResourceKind = "professional" | "room" | "equipment" | "other";
export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "canceled"
  | "no_show";

export type Service = {
  id: string;
  account_id: string;
  unit_id: string;
  name: string;
  duration_min: number;
  price: number | null;
  color: string | null;
  active: boolean;
  created_at?: string;
};

export type Resource = {
  id: string;
  account_id: string;
  unit_id: string;
  name: string;
  kind: ResourceKind;
  active: boolean;
  created_at?: string;
};

export type WorkingHour = {
  id: string;
  account_id: string;
  resource_id: string;
  weekday: number; // 0=domingo
  start_time: string; // "HH:MM:SS"
  end_time: string;
};

export type TimeOff = {
  id: string;
  account_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
};

export type Appointment = {
  id: string;
  account_id: string;
  unit_id: string;
  contact_id: string;
  service_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  notes: string | null;
  created_at?: string;
  // joins opcionais
  contact?: { id: string; name: string | null; phone: string | null } | null;
  service?: Pick<Service, "id" | "name" | "color" | "duration_min"> | null;
};

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  completed: "Concluído",
  canceled: "Cancelado",
  no_show: "Faltou",
};

export const KIND_LABEL: Record<ResourceKind, string> = {
  professional: "Profissional",
  room: "Sala",
  equipment: "Equipamento",
  other: "Outro",
};

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
