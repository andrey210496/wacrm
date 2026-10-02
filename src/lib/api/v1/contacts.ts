// ============================================================
// Shared contact logic for the public API (v1) contact endpoints.
//
// Kept out of the route files so `GET/POST /api/v1/contacts` and
// `GET/PATCH /api/v1/contacts/{id}` share one serializer, one
// find-or-create (built on the same `findExistingContact` dedupe the
// webhook and send path use), and one tag-sync routine.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  findExistingContact,
  isUniqueViolation,
  normalizeKey,
} from '@/lib/contacts/dedupe';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { getDefaultUnitId } from '@/lib/units/default-unit';

/** Row select that embeds the contact's tags for serialization. */
export const CONTACT_SELECT = '*, contact_tags(tags(*))';

export interface ApiContact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  avatar_url: string | null;
  tags: { id: string; name: string; color: string }[];
  created_at: string;
  updated_at: string;
}

/** Thrown by the helpers below; routes map `.status`/`.message`. */
export class ContactError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContactError';
    this.status = status;
  }
}

type RawTagJoin = { tags: { id: string; name: string; color: string } | null };

/** Flatten a `CONTACT_SELECT` row into the public contact shape. */
export function serializeContact(row: Record<string, unknown>): ApiContact {
  const joins = (row.contact_tags as RawTagJoin[] | undefined) ?? [];
  return {
    id: row.id as string,
    phone: row.phone as string,
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    tags: joins
      .map((j) => j.tags)
      .filter((t): t is NonNullable<RawTagJoin['tags']> => t != null)
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Resolve the audit `user_id` for API-created rows — the SINGLE source
 * of truth used by every public-API write (contacts, messages,
 * broadcasts, resolve-conversation), so the same key's writes are
 * always attributed to the same human. API callers have no logged-in
 * user, so — like the inbound webhook — we attribute writes to the
 * **WhatsApp config owner** (the webhook's own convention). Contacts
 * can be created before WhatsApp is connected, so we fall back to the
 * account owner when there's no config yet.
 */
export async function resolveAuditUserId(
  db: SupabaseClient,
  accountId: string
): Promise<string> {
  // An account can now hold MULTIPLE whatsapp_config rows (one per unit,
  // migration 042), so `.limit(1)` before `.maybeSingle()` — a bare
  // `.maybeSingle()` errors on ≥2 rows. Any config owner works: the audit
  // user is an account-level default, not a per-unit choice.
  const { data: config } = await db
    .from('whatsapp_config')
    .select('user_id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle();
  const configOwner = config?.user_id as string | undefined;
  if (configOwner) return configOwner;

  const { data: account } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  const owner = account?.owner_user_id as string | undefined;
  if (!owner) {
    throw new ContactError('Account owner could not be resolved', 500);
  }
  return owner;
}

export interface ContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

/**
 * Find (by fuzzy phone match) or create a contact in `accountId`.
 * Returns the contact id and whether it was created. Reuses the shared
 * `findExistingContact` dedupe + unique-violation race backstop so an
 * API-created contact is indistinguishable from a webhook-created one.
 */
export async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  input: ContactInput
): Promise<{ id: string; created: boolean }> {
  const sanitized = sanitizePhoneForMeta(input.phone);
  if (!isValidE164(sanitized)) {
    throw new ContactError(
      "'phone' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  // Unit for the created contact. The public API doesn't (yet) carry a
  // unit — per-unit API keys are a future SP2 enhancement — so it targets
  // the account's default unit (oldest active unidade). Dedup is scoped to
  // that unit (migration 044), so the lookup is unit-scoped too.
  const unitId = await getDefaultUnitId(db, accountId);

  const existing = await findExistingContact(db, accountId, sanitized, unitId);
  if (existing) return { id: existing.id, created: false };

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      unit_id: unitId,
      user_id: auditUserId,
      phone: sanitized,
      name: input.name ?? sanitized,
      email: input.email ?? null,
      company: input.company ?? null,
    })
    .select('id')
    .single();

  if (error || !created) {
    // Lost a race against a concurrent create — the unique index
    // rejected the duplicate. Re-resolve to the winner.
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, sanitized, unitId);
      if (raced) return { id: raced.id, created: false };
    }
    console.error('[api/v1/contacts] create error:', error);
    throw new ContactError('Failed to create contact', 500);
  }

  return { id: created.id, created: true };
}

/**
 * Resolve MANY phones to contact ids in bulk, creating the missing ones.
 * Returns a Map keyed by the normalized phone key (digits-only, the same
 * form `contacts.phone_normalized` stores) → contact id.
 *
 * Substitui o `findOrCreateContact` chamado num laço (que fazia 2–3 queries
 * POR destinatário — até ~3000 round-trips sequenciais antes do 202 de uma
 * campanha). Aqui: resolve a unidade 1×, busca os existentes por
 * `phone_normalized` em lote e insere só os que faltam, também em lote. Match
 * exato normalizado — mesma estratégia do upload de CSV (`upsertCsvContacts`);
 * os telefones já chegam sanitizados em E.164. Em erro de um bloco de insert
 * (ex.: corrida no índice único), cai para o caminho unitário robusto só
 * daquele bloco, preservando o backstop de 23505.
 *
 * Phones inválidos/vazios são simplesmente ausentes do Map (o chamador conta
 * como rejeitados). Não lança por telefone — só em falha dura de banco.
 */
export async function findOrCreateContactsBulk(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  phones: string[],
): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();

  // De-dup por chave normalizada; guarda um telefone representativo por chave.
  const phoneByKey = new Map<string, string>();
  for (const p of phones) {
    const sanitized = sanitizePhoneForMeta(p);
    if (!isValidE164(sanitized)) continue;
    const key = normalizeKey(sanitized);
    if (!key || phoneByKey.has(key)) continue;
    phoneByKey.set(key, sanitized);
  }
  if (phoneByKey.size === 0) return idByKey;

  const unitId = await getDefaultUnitId(db, accountId);
  const keys = [...phoneByKey.keys()];

  // Busca existentes por phone_normalized, em blocos (o IN do PostgREST tem
  // teto ~1000).
  const LOOKUP_CHUNK = 500;
  for (let i = 0; i < keys.length; i += LOOKUP_CHUNK) {
    const slice = keys.slice(i, i + LOOKUP_CHUNK);
    const { data } = await db
      .from('contacts')
      .select('id, phone_normalized')
      .eq('account_id', accountId)
      .eq('unit_id', unitId)
      .in('phone_normalized', slice);
    for (const row of (data ?? []) as { id: string; phone_normalized: string }[]) {
      if (row.phone_normalized) idByKey.set(row.phone_normalized, row.id);
    }
  }

  // Insere os que faltam, em blocos.
  const missingKeys = keys.filter((k) => !idByKey.has(k));
  const INSERT_CHUNK = 200;
  for (let i = 0; i < missingKeys.length; i += INSERT_CHUNK) {
    const chunkKeys = missingKeys.slice(i, i + INSERT_CHUNK);
    const rows = chunkKeys.map((k) => ({
      account_id: accountId,
      unit_id: unitId,
      user_id: auditUserId,
      phone: phoneByKey.get(k)!,
      name: phoneByKey.get(k)!,
    }));
    const { data: created, error } = await db
      .from('contacts')
      .insert(rows)
      .select('id, phone_normalized');

    if (error) {
      // Bloco falhou (provável corrida no índice único). Degrada para o
      // caminho unitário — que já reconcilia o 23505 — só neste bloco.
      for (const k of chunkKeys) {
        try {
          const { id } = await findOrCreateContact(db, accountId, auditUserId, {
            phone: phoneByKey.get(k)!,
          });
          idByKey.set(k, id);
        } catch {
          // Não resolveu — fica ausente do Map (contado como rejeitado).
        }
      }
      continue;
    }

    for (const row of (created ?? []) as { id: string; phone_normalized: string }[]) {
      if (row.phone_normalized) idByKey.set(row.phone_normalized, row.id);
    }
  }

  return idByKey;
}

/**
 * Replace a contact's tags to exactly match `tagNames` (case-
 * insensitive; missing tags are created). A no-op when `tagNames` is
 * undefined — pass `[]` to clear all tags. Reuses `resolveImportTagIds`
 * so API and CSV-import tag handling stay consistent.
 */
export async function setContactTags(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
  tagNames: string[]
): Promise<void> {
  const { tagIdByKey } = await resolveImportTagIds(db, {
    accountId,
    userId: auditUserId,
    tagNames,
    canCreateTags: true,
  });
  const desired = new Set(tagIdByKey.values());

  // Diff against the current joins rather than delete-all-then-insert:
  // a diff only touches tags that actually change, so a mid-operation
  // failure can never wipe tags that were meant to stay. Every write
  // is error-checked and surfaced as a ContactError (→ 500) instead of
  // being swallowed behind a misleading 200.
  const { data: current, error: readErr } = await db
    .from('contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId);
  if (readErr) {
    throw new ContactError('Failed to read contact tags', 500);
  }
  const existing = new Set(
    (current ?? []).map((r) => r.tag_id as string)
  );

  const toAdd = [...desired].filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !desired.has(id));

  if (toRemove.length > 0) {
    const { error } = await db
      .from('contact_tags')
      .delete()
      .eq('contact_id', contactId)
      .in('tag_id', toRemove);
    if (error) throw new ContactError('Failed to update contact tags', 500);
  }
  if (toAdd.length > 0) {
    for (const tagId of toAdd) {
      try {
        await addContactTagAndDispatch({
          db,
          accountId,
          contactId,
          tagId,
        });
      } catch (error) {
        console.error('[api/v1/contacts] tag add failed:', error);
        throw new ContactError('Failed to update contact tags', 500);
      }
    }
  }
}

/** Fetch + serialize a single contact scoped to the account, or null. */
export async function getContactById(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ApiContact | null> {
  const { data, error } = await db
    .from('contacts')
    .select(CONTACT_SELECT)
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return serializeContact(data as Record<string, unknown>);
}
