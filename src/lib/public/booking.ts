/**
 * Núcleo do autoagendamento público (Fase C). Roda via service-role, SEMPRE
 * escopado pela unidade do slug (nunca confia em account/unit do cliente).
 * Revalida o slot no servidor antes de gravar; a trava de overbooking do banco
 * é a rede final.
 */

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { findExistingContact } from "@/lib/contacts/dedupe";
import { resolveAuditUserId } from "@/lib/api/v1/contacts";
import { sanitizePhoneForMeta, isValidE164 } from "@/lib/whatsapp/phone-utils";
import { freeSlotsForDay, type WeekdayHours } from "@/lib/scheduling/day-availability";
import { combineResourceSlots, type ResourceSlots } from "@/lib/scheduling/combine-slots";
import type { TimeRange } from "@/lib/scheduling/availability";

/** Fuso fixo do BR no v1 (America/Sao_Paulo, sem DST). */
const BR_OFFSET_MIN = -180;

export type PublicUnit = {
  accountId: string;
  unitId: string;
  unitName: string;
  leadTimeMin: number;
  windowDays: number;
};

export type PublicService = { id: string; name: string; duration_min: number };
export type PublicResource = { id: string; name: string };

/** Resolve o slug → unidade pública (só se o autoagendamento está ligado). */
export async function resolveBySlug(slug: string): Promise<PublicUnit | null> {
  if (!slug) return null;
  const admin = supabaseAdmin();
  const { data: cfg } = await admin
    .from("scheduling_config")
    .select("account_id, unit_id, public_booking_enabled, public_lead_time_min, public_window_days")
    .eq("public_slug", slug)
    .maybeSingle();
  if (!cfg || !cfg.public_booking_enabled) return null;
  const { data: unit } = await admin.from("unidades").select("name, active").eq("id", cfg.unit_id).maybeSingle();
  if (!unit || unit.active === false) return null;
  return {
    accountId: cfg.account_id,
    unitId: cfg.unit_id,
    unitName: unit.name,
    leadTimeMin: cfg.public_lead_time_min ?? 120,
    windowDays: cfg.public_window_days ?? 30,
  };
}

export async function publicCatalog(unitId: string): Promise<{ services: PublicService[]; resources: PublicResource[] }> {
  const admin = supabaseAdmin();
  const [{ data: s }, { data: r }] = await Promise.all([
    admin.from("services").select("id, name, duration_min").eq("unit_id", unitId).eq("active", true).order("name"),
    admin.from("resources").select("id, name").eq("unit_id", unitId).eq("active", true).order("name"),
  ]);
  return { services: (s ?? []) as PublicService[], resources: (r ?? []) as PublicResource[] };
}

/** Slots livres de um recurso num dia (horário de trabalho − folgas − agendamentos). */
async function slotsForResource(resourceId: string, dateStr: string, durationMin: number): Promise<TimeRange[]> {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  // Margem de ±1 dia por causa do fuso (o dia local cruza a fronteira UTC).
  const dayStart = new Date(Date.UTC(y, m - 1, d - 1, 0, 0));
  const dayEnd = new Date(Date.UTC(y, m - 1, d + 1, 23, 59));
  const admin = supabaseAdmin();
  const [{ data: hours }, { data: appts }, { data: offs }] = await Promise.all([
    admin.from("resource_working_hours").select("weekday, start_time, end_time").eq("resource_id", resourceId),
    admin
      .from("appointments")
      .select("starts_at, ends_at, status")
      .eq("resource_id", resourceId)
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString()),
    admin
      .from("resource_time_off")
      .select("starts_at, ends_at")
      .eq("resource_id", resourceId)
      .lt("starts_at", dayEnd.toISOString())
      .gt("ends_at", dayStart.toISOString()),
  ]);
  const weekdayHours: WeekdayHours[] = ((hours ?? []) as { weekday: number; start_time: string; end_time: string }[]).map((h) => ({
    weekday: h.weekday,
    startTime: h.start_time,
    endTime: h.end_time,
  }));
  const busy: TimeRange[] = [
    ...((appts ?? []) as { starts_at: string; ends_at: string; status: string }[])
      .filter((a) => a.status !== "canceled" && a.status !== "no_show")
      .map((a) => ({ start: new Date(a.starts_at), end: new Date(a.ends_at) })),
    ...((offs ?? []) as { starts_at: string; ends_at: string }[]).map((o) => ({ start: new Date(o.starts_at), end: new Date(o.ends_at) })),
  ];
  return freeSlotsForDay({
    dateStr,
    tzOffsetMinutes: BR_OFFSET_MIN,
    weekdayHours,
    timeOff: busy,
    appointments: [],
    durationMin,
  });
}

/** Filtra slots por lead-time (agora+lead) — nunca no passado/curto prazo. */
function applyLead(slots: TimeRange[], leadTimeMin: number, now: Date): TimeRange[] {
  const min = now.getTime() + leadTimeMin * 60_000;
  return slots.filter((s) => s.start.getTime() >= min);
}

export async function publicSlots(params: {
  unit: PublicUnit;
  serviceId: string;
  resourceId: string | null; // null = qualquer
  dateStr: string;
  now?: Date;
}): Promise<{ start: string; end: string; resourceId: string }[]> {
  const now = params.now ?? new Date();
  const admin = supabaseAdmin();
  const { data: service } = await admin
    .from("services")
    .select("id, duration_min, active")
    .eq("id", params.serviceId)
    .eq("unit_id", params.unit.unitId)
    .maybeSingle();
  if (!service || service.active === false) return [];

  // Janela: a data não pode passar de agora+windowDays.
  const [y, m, d] = params.dateStr.split("-").map((x) => parseInt(x, 10));
  const dayLocalNoon = new Date(Date.UTC(y, m - 1, d, 12, 0));
  const maxDay = new Date(now.getTime() + params.unit.windowDays * 86_400_000);
  if (dayLocalNoon.getTime() > maxDay.getTime() + 86_400_000) return [];

  let resourceIds: string[];
  if (params.resourceId) {
    const { data: r } = await admin
      .from("resources")
      .select("id, active")
      .eq("id", params.resourceId)
      .eq("unit_id", params.unit.unitId)
      .maybeSingle();
    if (!r || r.active === false) return [];
    resourceIds = [params.resourceId];
  } else {
    const { data: rs } = await admin.from("resources").select("id").eq("unit_id", params.unit.unitId).eq("active", true).order("name");
    resourceIds = ((rs ?? []) as { id: string }[]).map((x) => x.id);
  }

  const perResource: ResourceSlots[] = [];
  for (const rid of resourceIds) {
    const slots = applyLead(await slotsForResource(rid, params.dateStr, service.duration_min), params.unit.leadTimeMin, now);
    perResource.push({ resourceId: rid, slots });
  }
  const combined = combineResourceSlots(perResource);
  return combined.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), resourceId: s.resourceId }));
}

export type BookingResult =
  | { ok: true; appointmentId: string; startsAt: string; resourceId: string }
  | { ok: false; reason: "invalid" | "conflict" | "unavailable" };

export async function createPublicBooking(params: {
  unit: PublicUnit;
  serviceId: string;
  resourceId: string | null;
  startsAtISO: string;
  name: string;
  phone: string;
  now?: Date;
}): Promise<BookingResult> {
  const now = params.now ?? new Date();
  const name = params.name.trim();
  const phone = sanitizePhoneForMeta(params.phone);
  if (name.length < 2 || name.length > 80 || !isValidE164(phone)) return { ok: false, reason: "invalid" };

  const start = new Date(params.startsAtISO);
  if (Number.isNaN(start.getTime())) return { ok: false, reason: "invalid" };
  if (start.getTime() < now.getTime() + params.unit.leadTimeMin * 60_000) return { ok: false, reason: "unavailable" };
  if (start.getTime() > now.getTime() + params.unit.windowDays * 86_400_000) return { ok: false, reason: "unavailable" };

  const admin = supabaseAdmin();
  const { data: service } = await admin
    .from("services")
    .select("id, duration_min, active")
    .eq("id", params.serviceId)
    .eq("unit_id", params.unit.unitId)
    .maybeSingle();
  if (!service || service.active === false) return { ok: false, reason: "invalid" };

  // Data local (BR) do start, para recomputar os slots do dia.
  const dateStr = new Date(start.getTime() + BR_OFFSET_MIN * 60_000).toISOString().slice(0, 10);

  // Revalida no servidor: o startsAt precisa ser um slot livre.
  const slots = await publicSlots({ unit: params.unit, serviceId: params.serviceId, resourceId: params.resourceId, dateStr, now });
  const match = slots.find((s) => new Date(s.start).getTime() === start.getTime() && (!params.resourceId || s.resourceId === params.resourceId));
  if (!match) return { ok: false, reason: "conflict" };
  const resourceId = match.resourceId;
  const end = new Date(start.getTime() + service.duration_min * 60_000);

  // Contato: acha por telefone ou cria (owner padrão da conta).
  let contactId: string;
  const existing = await findExistingContact(admin, params.unit.accountId, phone, params.unit.unitId);
  if (existing) {
    contactId = existing.id;
  } else {
    const ownerUserId = await resolveAuditUserId(admin, params.unit.accountId);
    const { data: created, error } = await admin
      .from("contacts")
      .insert({ account_id: params.unit.accountId, unit_id: params.unit.unitId, user_id: ownerUserId, phone, name })
      .select("id")
      .single();
    if (error || !created) {
      // corrida no índice único → re-resolve
      const raced = await findExistingContact(admin, params.unit.accountId, phone, params.unit.unitId);
      if (!raced) return { ok: false, reason: "invalid" };
      contactId = raced.id;
    } else {
      contactId = created.id;
    }
  }

  const { data: appt, error: apptErr } = await admin
    .from("appointments")
    .insert({
      account_id: params.unit.accountId,
      unit_id: params.unit.unitId,
      contact_id: contactId,
      service_id: params.serviceId,
      resource_id: resourceId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: "scheduled",
      notes: "Autoagendamento (link público)",
    })
    .select("id")
    .single();

  if (apptErr || !appt) {
    if (apptErr?.code === "23P01") return { ok: false, reason: "conflict" };
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, appointmentId: appt.id, startsAt: start.toISOString(), resourceId };
}
