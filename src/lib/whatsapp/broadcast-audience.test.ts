import { describe, it, expect, vi } from 'vitest';
import {
  resolveVariables,
  resolveAudienceServer,
  type AudienceConfig,
} from './broadcast-audience';
import type { Contact } from '@/types';

const contact = { id: 'c1', name: 'Jane', phone: '+15550001', email: 'j@x.com', company: 'Acme' } as Contact;

describe('resolveVariables', () => {
  it('static/field/custom_field na ordem numérica', () => {
    const out = resolveVariables(
      { '1': { type: 'field', value: 'name' }, '2': { type: 'static', value: 'X' }, '3': { type: 'custom_field', value: 'cf1' } },
      contact,
      new Map([['cf1', 'V']]),
    );
    expect(out).toEqual(['Jane', 'X', 'V']);
  });
  it('custom_field ausente vira string vazia', () => {
    expect(resolveVariables({ '1': { type: 'custom_field', value: 'z' } }, contact)).toEqual(['']);
  });
});

// supabase chain mock: .from('contacts').select('*') resolve `all`
function db(rows: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const result = rows[table] ?? [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ data: result, error: null }),
        // termina em await direto (audience 'all' faz select().then)
        then: (r: (v: { data: unknown[]; error: null }) => unknown) => r({ data: result, error: null }),
      };
      return chain;
    },
  } as never;
}

describe('resolveAudienceServer', () => {
  it('type all retorna todos os contatos', async () => {
    const contacts = await resolveAudienceServer(
      db({ contacts: [{ id: 'a' }, { id: 'b' }] }),
      'acc',
      'user',
      { type: 'all' } as AudienceConfig,
    );
    expect(contacts.map((c) => c.id)).toEqual(['a', 'b']);
  });
});
