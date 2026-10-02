// ============================================================
// Resolução de audiência + variáveis de broadcast, server-side.
// Porta das funções que viviam no hook client (use-broadcast-sending.ts),
// recebendo o supabase de sessão + accountId + userId como parâmetros.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeKey } from '@/lib/contacts/dedupe';
import type { Contact } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';
export interface CustomFieldFilter { fieldId: string; operator: CustomFieldOperator; value: string }
export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
}
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

type CustomValueIndex = Map<string, Map<string, string>>;

export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a), bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });
  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;
    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name, phone: contact.phone, email: contact.email, company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }
    return customValues?.get(v.value) ?? '';
  });
}

export async function fetchCustomValueIndex(
  supabase: SupabaseClient,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice);
    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export async function upsertCsvContacts(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  csvRows: { phone: string; name?: string }[],
): Promise<Contact[]> {
  if (csvRows.length === 0) return [];
  const uniqueByKey = new Map<string, { phone: string; name?: string }>();
  for (const row of csvRows) {
    const key = normalizeKey(row.phone);
    if (key && !uniqueByKey.has(key)) uniqueByKey.set(key, row);
  }
  const keys = [...uniqueByKey.keys()];
  const { data: existing, error: lookupErr } = await supabase
    .from('contacts').select('*').eq('account_id', accountId).in('phone_normalized', keys);
  if (lookupErr) throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
  const byKey = new Map<string, Contact>();
  for (const c of (existing ?? []) as Contact[]) {
    const key = normalizeKey(c.phone ?? '');
    if (key) byKey.set(key, c);
  }
  const missing = keys.filter((k) => !byKey.has(k)).map((k) => uniqueByKey.get(k)!)
    .map((row) => ({ user_id: userId, account_id: accountId, phone: row.phone, name: row.name ?? null }));
  const INSERT_CHUNK = 200;
  for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
    const chunk = missing.slice(i, i + INSERT_CHUNK);
    const { data: inserted, error: insertErr } = await supabase.from('contacts').insert(chunk).select();
    if (insertErr) throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
    for (const c of (inserted ?? []) as Contact[]) {
      const key = normalizeKey(c.phone ?? '');
      if (key) byKey.set(key, c);
    }
  }
  return keys.map((k) => byKey.get(k)).filter((c): c is Contact => Boolean(c));
}

async function resolveCustomFieldAudience(
  supabase: SupabaseClient, filter: CustomFieldFilter,
): Promise<Contact[]> {
  const { fieldId, operator, value } = filter;
  let query = supabase.from('contact_custom_values').select('contact_id').eq('custom_field_id', fieldId);
  if (operator === 'is') query = query.eq('value', value);
  else if (operator === 'is_not') query = query.neq('value', value);
  else if (operator === 'contains') query = query.ilike('value', `%${value}%`);
  const { data: matches, error: matchErr } = await query;
  if (matchErr) throw new Error(`Custom-field filter failed: ${matchErr.message}`);
  const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
  if (contactIds.length === 0) return [];
  const { data, error } = await supabase.from('contacts').select('*').in('id', contactIds);
  if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
  return (data ?? []) as Contact[];
}

export async function resolveAudienceServer(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  audience: AudienceConfig,
): Promise<Contact[]> {
  let contacts: Contact[] = [];
  if (audience.type === 'all') {
    const { data, error } = await supabase.from('contacts').select('*');
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    contacts = (data ?? []) as Contact[];
  } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
    const { data: contactTags, error: tagError } = await supabase
      .from('contact_tags').select('contact_id').in('tag_id', audience.tagIds);
    if (tagError) throw new Error(`Failed to fetch contact tags: ${tagError.message}`);
    if (contactTags && contactTags.length > 0) {
      const ids = [...new Set(contactTags.map((ct) => ct.contact_id))];
      const { data, error } = await supabase.from('contacts').select('*').in('id', ids);
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = (data ?? []) as Contact[];
    }
  } else if (audience.type === 'custom_field' && audience.customField) {
    contacts = await resolveCustomFieldAudience(supabase, audience.customField);
  } else if (audience.type === 'csv' && audience.csvContacts) {
    contacts = await upsertCsvContacts(supabase, accountId, userId, audience.csvContacts);
  }
  if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
    const { data: excludeRows } = await supabase
      .from('contact_tags').select('contact_id').in('tag_id', audience.excludeTagIds);
    const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
    contacts = contacts.filter((c) => !excludedIds.has(c.id));
  }
  return contacts;
}
