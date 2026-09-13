// GET/POST /api/scheduling/config — config de lembretes + funil por unidade.
// Sessão ADMIN+.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { getSchedulingConfig, saveSchedulingConfig, type SchedulingConfig } from "@/lib/scheduling/config";

function defaults(unitId: string, accountId: string): SchedulingConfig {
  return {
    unit_id: unitId,
    account_id: accountId,
    reminders_enabled: false,
    reminder_offsets_min: [1440, 180],
    reminder_channel: "auto",
    reminder_text: "Olá {cliente}! Lembrete do seu horário de {servico} em {data} às {hora}. Responda SIM para confirmar.",
    confirm_enabled: true,
    confirm_keywords: ["sim", "confirmar", "confirmado", "ok", "1"],
    funnel_pipeline_id: null,
    stage_scheduled: null,
    stage_confirmed: null,
    stage_completed: null,
    stage_no_show: null,
  };
}

export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }
  const unitId = new URL(request.url).searchParams.get("unitId")?.trim();
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });
  const cfg = (await getSchedulingConfig(unitId)) ?? defaults(unitId, ctx.accountId);
  return NextResponse.json({ ok: true, config: cfg });
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const unitId = String(body.unitId ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });

  const channel = body.reminder_channel;
  try {
    await saveSchedulingConfig({
      unit_id: unitId,
      account_id: ctx.accountId,
      reminders_enabled: body.reminders_enabled === true,
      reminder_offsets_min: Array.isArray(body.reminder_offsets_min)
        ? (body.reminder_offsets_min as unknown[]).map((n) => Math.max(1, Math.round(Number(n)))).filter((n) => Number.isFinite(n))
        : [1440, 180],
      reminder_channel: channel === "official" || channel === "uazapi" ? channel : "auto",
      reminder_text: typeof body.reminder_text === "string" && body.reminder_text.trim() ? body.reminder_text : undefined,
      confirm_enabled: body.confirm_enabled !== false,
      confirm_keywords: Array.isArray(body.confirm_keywords)
        ? (body.confirm_keywords as unknown[]).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
        : undefined,
      funnel_pipeline_id: (body.funnel_pipeline_id as string) || null,
      stage_scheduled: (body.stage_scheduled as string) || null,
      stage_confirmed: (body.stage_confirmed as string) || null,
      stage_completed: (body.stage_completed as string) || null,
      stage_no_show: (body.stage_no_show as string) || null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "erro" }, { status: 500 });
  }
}
