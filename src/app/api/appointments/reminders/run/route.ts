// ============================================================
// POST /api/appointments/reminders/run — worker de lembretes (Fase B).
//
// Autenticação (fail-closed, timing-safe), aceita QUALQUER um:
//   - header `x-cron-secret`   = REMINDERS_CRON_SECRET   (cron direto por instância)
//   - header `x-license-secret` = LICENSE_CONTROL_SECRET (a CENTRAL orquestrando —
//     ela já detém o segredo de licença de cada instância; assim 1 cron na central
//     cobre a frota inteira).
// Para cada unidade com lembretes ligados, envia os vencidos (canal da Frente 2),
// com dedupe por (appointment, offset). Best-effort no envio.
// ============================================================

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { sendMessageToConversation } from "@/lib/whatsapp/send-message";
import { resolveConversationByPhone } from "@/lib/whatsapp/resolve-conversation";
import { dueOffsets, renderReminder } from "@/lib/scheduling/reminders";
import type { SchedulingConfig } from "@/lib/scheduling/config";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}
function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

type ApptRow = {
  id: string;
  contact_id: string;
  starts_at: string;
  contact?: { name: string | null; phone: string | null } | null;
  service?: { name: string | null } | null;
  resource?: { name: string | null } | null;
};

/** Compara em tempo constante; false se algum lado for vazio/tamanhos diferentes. */
function safeEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export async function POST(request: Request) {
  const cronOk = safeEq(request.headers.get("x-cron-secret"), process.env.REMINDERS_CRON_SECRET);
  const licenseOk = safeEq(request.headers.get("x-license-secret"), process.env.LICENSE_CONTROL_SECRET);
  if (!cronOk && !licenseOk) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const now = new Date();
  let sent = 0;
  let errors = 0;

  const { data: configs } = await admin
    .from("scheduling_config")
    .select("*")
    .eq("reminders_enabled", true);

  for (const cfg of ((configs ?? []) as SchedulingConfig[])) {
    const offsets = (cfg.reminder_offsets_min ?? []).filter((o) => o > 0);
    if (offsets.length === 0) continue;
    const horizon = new Date(now.getTime() + Math.max(...offsets) * 60_000);

    const { data: appts } = await admin
      .from("appointments")
      .select("id, contact_id, starts_at, contact:contacts(name, phone), service:services(name), resource:resources(name)")
      .eq("unit_id", cfg.unit_id)
      .in("status", ["scheduled", "confirmed"])
      .gte("starts_at", now.toISOString())
      .lte("starts_at", horizon.toISOString());

    const rows = (appts ?? []) as unknown as ApptRow[];
    if (rows.length === 0) continue;

    const { data: logRows } = await admin
      .from("appointment_reminders_sent")
      .select("id, appointment_id, offset_min, status")
      .in("appointment_id", rows.map((r) => r.id));
    // sentMap = offsets JÁ ENVIADOS (status='sent') → não reenvia. rowMap = linha
    // existente por (appt,offset) para reivindicar retry de falhas.
    const sentMap = new Map<string, number[]>();
    const rowMap = new Map<string, Map<number, { id: string; status: string }>>();
    for (const s of (logRows ?? []) as { id: string; appointment_id: string; offset_min: number; status: string }[]) {
      if (s.status === "sent") {
        const arr = sentMap.get(s.appointment_id) ?? [];
        arr.push(s.offset_min);
        sentMap.set(s.appointment_id, arr);
      }
      const m = rowMap.get(s.appointment_id) ?? new Map();
      m.set(s.offset_min, { id: s.id, status: s.status });
      rowMap.set(s.appointment_id, m);
    }

    for (const appt of rows) {
      const start = new Date(appt.starts_at);
      const due = dueOffsets({ now, apptStart: start, offsets, sentOffsets: sentMap.get(appt.id) ?? [] });
      const phone = appt.contact?.phone;
      if (due.length === 0) continue;
      if (!phone) {
        console.warn(`[reminders] appt ${appt.id} sem telefone — pulando`);
        continue;
      }
      const text = renderReminder(cfg.reminder_text, {
        cliente: firstName(appt.contact?.name),
        servico: appt.service?.name ?? "",
        recurso: appt.resource?.name ?? "",
        data: fmtDate(start),
        hora: fmtTime(start),
      });

      for (const off of due) {
        // 1) REIVINDICA (status 'pending') ANTES de enviar. Novo offset → INSERT
        //    (a UNIQUE trava corrida entre crons). Offset que falhou antes →
        //    reivindica com UPDATE otimístico (só pega se o status ainda é o que
        //    a gente leu). Assim ninguém envia em dobro, e falha registrada é
        //    RE-TENTADA (não fica invisível). status='sent' nunca chega aqui.
        const existing = rowMap.get(appt.id)?.get(off);
        let rowId: string;
        if (!existing) {
          const { data, error: claimErr } = await admin
            .from("appointment_reminders_sent")
            .insert({ appointment_id: appt.id, offset_min: off, channel: cfg.reminder_channel, status: "pending" })
            .select("id")
            .single();
          if (claimErr || !data) {
            if (claimErr && claimErr.code !== "23505") {
              errors++;
              console.warn(`[reminders] claim falhou appt=${appt.id} off=${off}: ${claimErr.message}`);
            }
            continue; // 23505 = outro run pegou
          }
          rowId = data.id;
        } else {
          const { data } = await admin
            .from("appointment_reminders_sent")
            .update({ status: "pending", updated_at: new Date().toISOString() })
            .eq("id", existing.id)
            .eq("status", existing.status) // trava otimística
            .select("id");
          if (!data || data.length === 0) continue; // outro run reivindicou
          rowId = existing.id;
        }

        // 2) Envia. Marca 'sent' no sucesso; 'failed' + motivo na falha (visível
        //    ao atendente na agenda). Falha continua sendo re-tentada no próximo
        //    cron (o offset segue "due" enquanto não for 'sent').
        try {
          const { conversationId } = await resolveConversationByPhone(admin, cfg.account_id, phone, appt.contact?.name ?? null);
          await sendMessageToConversation(admin, cfg.account_id, {
            conversationId,
            messageType: "text",
            contentText: text,
            channelOverride: cfg.reminder_channel,
          });
          await admin
            .from("appointment_reminders_sent")
            .update({ status: "sent", error: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", rowId);
          sent++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors++;
          console.warn(`[reminders] envio falhou appt=${appt.id} off=${off}: ${msg}`);
          await admin
            .from("appointment_reminders_sent")
            .update({ status: "failed", error: msg.slice(0, 300), updated_at: new Date().toISOString() })
            .eq("id", rowId);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, sent, errors });
}
