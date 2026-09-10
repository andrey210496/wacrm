// ============================================================
// GET /api/whatsapp/billing/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Consumo de mensagens por UNIDADE (decisão C2), com custo estimado em R$
// (decisão C1) usando a tabela de tarifas configurável. Só ADMIN+. A Meta é a
// fonte da verdade do que é cobrável (pricing no status); aqui só contamos e
// multiplicamos pela tarifa. Também conta conversas vindas de anúncio (referral)
// por unidade — as da janela grátis de 72h.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { aggregateConsumption, type ConsumptionRow, type Rate } from '@/lib/whatsapp/billing';

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const url = new URL(request.url);
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const from = url.searchParams.get('from') || defaultFrom;
  const to = url.searchParams.get('to') || now.toISOString();

  const db = admin();

  // Mensagens ENVIADAS (agent) da conta, no período, com a unidade da conversa.
  const { data: msgs, error: msgErr } = await db
    .from('messages')
    .select('pricing_category, pricing_billable, conversations!inner(unit_id, account_id)')
    .eq('sender_type', 'agent')
    .eq('conversations.account_id', ctx.accountId)
    .gte('created_at', from)
    .lte('created_at', to)
    .limit(50000);

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

  const perUnit = aggregateConsumption(rows, rates);

  // Nomes das unidades + conversas vindas de anúncio (referral) no período.
  const { data: units } = await db
    .from('unidades')
    .select('id, name')
    .eq('account_id', ctx.accountId);
  const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));

  const { data: refConvs } = await db
    .from('conversations')
    .select('unit_id')
    .eq('account_id', ctx.accountId)
    .not('referral', 'is', null)
    .gte('referral_at', from)
    .lte('referral_at', to)
    .limit(50000);
  const referralByUnit = new Map<string, number>();
  for (const c of refConvs ?? []) {
    const u = c.unit_id ?? 'sem-unidade';
    referralByUnit.set(u, (referralByUnit.get(u) ?? 0) + 1);
  }

  const ratesConfigured = rates.some((r) => r.price > 0);

  return NextResponse.json({
    from,
    to,
    currency: 'BRL',
    ratesConfigured,
    totalEstimatedCost: perUnit.reduce((s, u) => s + u.estimatedCost, 0),
    units: perUnit.map((u) => ({
      ...u,
      unitName: u.unitId === 'sem-unidade' ? 'Sem unidade' : unitName.get(u.unitId) ?? u.unitId,
      referralConversations: referralByUnit.get(u.unitId) ?? 0,
    })),
  });
}
