// ============================================================
// POST /api/whatsapp/broadcasts/dispatch
// Disparo server-side de campanha: resolve audiência + variáveis + CSV,
// cria o broadcast + destinatários (pending) e chuta a 1ª leva em after().
// Responde 202; o cron de drenagem entrega o restante. Substitui o laço de
// envio que rodava no navegador.
// ============================================================

import { NextResponse, after } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { resolveOperatorUnitId } from '@/lib/units/operator-unit';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  resolveAudienceServer,
  resolveVariables,
  fetchCustomValueIndex,
  type AudienceConfig,
  type VariableMapping,
} from '@/lib/whatsapp/broadcast-audience';
import { createBroadcastQueued, runDrainPass } from '@/lib/whatsapp/broadcast-queue';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const limit = checkRateLimit(
      `broadcast-dispatch:${userId}`,
      RATE_LIMITS.broadcast
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 });
    }

    const name: string = typeof body.name === 'string' ? body.name : '';
    const template = body.template ?? {};
    const templateName: string = typeof template.name === 'string' ? template.name : '';
    const templateLanguage: string = typeof template.language === 'string' ? template.language : 'en_US';
    const variables: Record<string, VariableMapping> = body.variables ?? {};
    const audience: AudienceConfig = body.audience ?? { type: 'all' };
    // Media header (IMAGE/VIDEO/DOCUMENT). Only a string is honored; a
    // malformed value is dropped rather than persisted as garbage.
    const headerMediaUrl: string | undefined =
      typeof body.headerMediaUrl === 'string' && body.headerMediaUrl.trim()
        ? body.headerMediaUrl
        : undefined;
    if (!templateName) return NextResponse.json({ error: 'template_name é obrigatório' }, { status: 400 });

    const unitId = await resolveOperatorUnitId(
      supabase, accountId, userId,
      typeof body.selectedUnitId === 'string' ? body.selectedUnitId : null,
    );

    const contacts = await resolveAudienceServer(supabase, accountId, userId, audience);
    if (contacts.length === 0) {
      return NextResponse.json({ error: 'Nenhum contato encontrado para essa audiência.' }, { status: 400 });
    }

    const customValueIndex = await fetchCustomValueIndex(supabase, contacts.map((c) => c.id));
    const recipients = contacts
      .filter((c) => c.phone)
      .map((c) => ({
        contactId: c.id,
        phone: c.phone as string,
        params: resolveVariables(variables, c, customValueIndex.get(c.id)),
      }));
    const rejected = contacts.length - recipients.length;
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'Nenhum contato com telefone válido.' }, { status: 400 });
    }

    // Grava só um resumo enxuto da audiência em `broadcasts.audience_filter`
    // (sem `csvContacts` — a lista bruta do CSV pode ter milhares de linhas
    // e viraria um JSON gigante gravado na campanha à toa). A resolução
    // acima usa o `audience` completo; só o que é PERSISTIDO fica enxuto,
    // igual ao hook original.
    const audienceFilter = {
      type: audience.type,
      tagIds: audience.tagIds,
      customField: audience.customField,
      excludeTagIds: audience.excludeTagIds,
    };

    const { broadcastId, total } = await createBroadcastQueued(supabase, accountId, userId, {
      name: name || `Campanha (${templateName})`,
      unitId, templateName, templateLanguage, variables, audience: audienceFilter, recipients,
      headerMediaUrl,
    });

    // Chuta a 1ª leva com service-role (outlives o request), como o resume.
    const admin = supabaseAdmin();
    after(() => runDrainPass(admin, accountId, broadcastId));

    return NextResponse.json({ broadcast_id: broadcastId, total_recipients: total, rejected }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
