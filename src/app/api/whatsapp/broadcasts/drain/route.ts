// ============================================================
// GET/POST /api/whatsapp/broadcasts/drain — cron de drenagem.
// Entrega o restante das campanhas em passes de <=1000 e auto-recupera
// campanhas travadas (status 'sending' com pending sem lock). Auth timing-safe:
// x-cron-secret = BROADCAST_DRAIN_SECRET OU x-license-secret = LICENSE_CONTROL_SECRET.
// ============================================================

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { runDrainPass } from '@/lib/whatsapp/broadcast-queue';
import { DELIVERY_LOCK_STALE_MS } from '@/lib/whatsapp/broadcast-resume';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const RUN_BUDGET_MS = 250_000;
const MAX_BROADCASTS_PER_RUN = 50;

/** Compara em tempo constante; false se algum lado for vazio/tamanhos diferentes. */
function safeEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function handle(request: Request): Promise<Response> {
  const cronOk = safeEq(request.headers.get('x-cron-secret'), process.env.BROADCAST_DRAIN_SECRET);
  const licenseOk = safeEq(request.headers.get('x-license-secret'), process.env.LICENSE_CONTROL_SECRET);
  if (!cronOk && !licenseOk) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const deadline = Date.now() + RUN_BUDGET_MS;
  const staleCutoff = new Date(Date.now() - DELIVERY_LOCK_STALE_MS).toISOString();

  // Campanhas ainda enviando, sem lock ativo (ou lock stale).
  const { data: broadcasts } = await admin
    .from('broadcasts')
    .select('id, account_id')
    .eq('status', 'sending')
    .or(`delivery_locked_at.is.null,delivery_locked_at.lt.${staleCutoff}`)
    .limit(MAX_BROADCASTS_PER_RUN);

  let processed = 0;
  let partial = false;
  for (const b of broadcasts ?? []) {
    if (Date.now() >= deadline) { partial = true; break; }
    await runDrainPass(admin, b.account_id as string, b.id as string);
    processed += 1;
  }
  return NextResponse.json({ ok: true, processed, partial });
}

export async function POST(request: Request) { return handle(request); }
export async function GET(request: Request) { return handle(request); }
