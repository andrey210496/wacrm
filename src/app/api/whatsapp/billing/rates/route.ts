// ============================================================
// GET/PUT /api/whatsapp/billing/rates — tarifas por categoria (Feature C, C1).
//
// O operador mantém as tarifas do rate card da Meta (BR) aqui; o custo do painel
// é ESTIMADO = mensagens cobráveis × tarifa. Versionado: um PUT insere uma nova
// linha com effective_from = hoje (histórico preservado, cobre os reajustes da
// Meta). Só ADMIN+.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const CATEGORIES = ['marketing', 'utility', 'authentication'] as const;

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Tarifa vigente (mais recente) por categoria. */
export async function GET() {
  try {
    await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }
  const { data, error } = await admin()
    .from('whatsapp_pricing_rates')
    .select('category, price, currency, effective_from')
    .order('effective_from', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const seen = new Set<string>();
  const current: Record<string, number> = {};
  let currency = 'BRL';
  for (const r of data ?? []) {
    if (seen.has(r.category)) continue;
    seen.add(r.category);
    current[r.category] = Number(r.price);
    currency = r.currency ?? 'BRL';
  }
  return NextResponse.json({ currency, rates: current });
}

/** Body: { marketing?: number, utility?: number, authentication?: number } */
export async function PUT(request: Request) {
  try {
    await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const inserts: { category: string; price: number; currency: string; effective_from: string }[] = [];
  for (const cat of CATEGORIES) {
    const raw = body[cat];
    if (raw === undefined || raw === null) continue;
    const price = Number(raw);
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: `Tarifa inválida para ${cat}.` }, { status: 400 });
    }
    inserts.push({ category: cat, price, currency: 'BRL', effective_from: today });
  }

  if (inserts.length === 0) {
    return NextResponse.json({ error: 'Nenhuma tarifa informada.' }, { status: 400 });
  }

  const { error } = await admin().from('whatsapp_pricing_rates').insert(inserts);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: inserts.map((i) => i.category) });
}
