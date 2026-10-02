// ============================================================
// GET /api/whatsapp/billing/fleet-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Consumo de mensagens do SILO INTEIRO (todas as contas/unidades) no período,
// pra CENTRAL puxar e agregar a frota (Frente 4). Server-to-server: auth por
// `x-license-secret` = LICENSE_CONTROL_SECRET (o mesmo segredo que a central já
// custodia). Diferente da `billing/summary` (sessão-admin + 1 conta), que
// continua intacta. A Meta é a fonte do que é cobrável; aqui só contamos e
// multiplicamos pela tarifa configurável.
// ============================================================

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { buildFleetSummary, type UnitMeta } from '@/lib/whatsapp/fleet-summary';
import type { ConsumptionRow, Rate } from '@/lib/whatsapp/billing';

export const dynamic = 'force-dynamic';

/** Compara em tempo constante; false se algum lado vazio/tamanhos diferentes. */
function safeEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export async function GET(request: Request) {
  const licenseOk = safeEq(request.headers.get('x-license-secret'), process.env.LICENSE_CONTROL_SECRET);
  if (!licenseOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const from = url.searchParams.get('from') || defaultFrom;
  const to = url.searchParams.get('to') || now.toISOString();

  const db = supabaseAdmin();

  // Mensagens ENVIADAS (agent) de TODAS as contas no período, com a unidade da
  // conversa. Sem filtro de conta (é o silo inteiro).
  const { data: msgs, error: msgErr } = await db
    .from('messages')
    .select('pricing_category, pricing_billable, conversations!inner(unit_id, account_id)')
    .eq('sender_type', 'agent')
    .gte('created_at', from)
    .lte('created_at', to)
    .limit(100000);
  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  const rows: ConsumptionRow[] = (msgs ?? []).map((m) => {
    const conv = (m as { conversations?: { unit_id?: string | null } }).conversations;
    return {
      unitId: conv?.unit_id ?? null,
      category: (m as { pricing_category?: string | null }).pricing_category ?? null,
      billable: (m as { pricing_billable?: boolean | null }).pricing_billable ?? null,
    };
  });

  // Tarifas vigentes (a mais recente por categoria).
  const { data: rateRows } = await db
    .from('whatsapp_pricing_rates')
    .select('category, price, effective_from')
    .order('effective_from', { ascending: false });
  const seen = new Set<string>();
  const rates: Rate[] = [];
  for (const r of rateRows ?? []) {
    if (seen.has(r.category)) continue;
    seen.add(r.category);
    rates.push({ category: r.category, price: Number(r.price) });
  }

  // Metadados das unidades (todas as contas): unitId -> { accountId, name }.
  const { data: units } = await db.from('unidades').select('id, name, account_id');
  const unitMeta = new Map<string, UnitMeta>(
    (units ?? []).map((u) => [u.id as string, { accountId: (u.account_id as string) ?? null, name: (u.name as string) ?? null }]),
  );

  // Conversas vindas de anúncio (referral) no período, por unidade.
  const { data: refConvs } = await db
    .from('conversations')
    .select('unit_id')
    .not('referral', 'is', null)
    .gte('referral_at', from)
    .lte('referral_at', to)
    .limit(100000);
  const referralByUnit = new Map<string, number>();
  for (const c of refConvs ?? []) {
    const u = (c.unit_id as string) ?? 'sem-unidade';
    referralByUnit.set(u, (referralByUnit.get(u) ?? 0) + 1);
  }

  const summary = buildFleetSummary({ rows, rates, unitMeta, referralByUnit });

  return NextResponse.json({ from, to, currency: 'BRL', ...summary });
}
