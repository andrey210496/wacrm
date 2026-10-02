import { describe, it, expect } from 'vitest';
import { resolveInboundIdentity } from './identity';

describe('resolveInboundIdentity', () => {
  it('telefone presente (from) — caso clássico', () => {
    const r = resolveInboundIdentity(
      { profile: { name: 'Ana' }, wa_id: '5511999', user_id: 'BR.abc' },
      { from: '5511999', from_user_id: 'BR.abc' },
    );
    expect(r).toEqual({
      phone: '5511999',
      bsuid: 'BR.abc',
      username: null,
      name: 'Ana',
    });
  });

  it('só BSUID (telefone escondido via username)', () => {
    const r = resolveInboundIdentity(
      { profile: { name: 'Bea' }, user_id: 'BR.xyz', username: 'bea.pilates' },
      { from_user_id: 'BR.xyz' },
    );
    expect(r).toEqual({
      phone: null,
      bsuid: 'BR.xyz',
      username: 'bea.pilates',
      name: 'Bea',
    });
  });

  it('prefere message.from/from_user_id, cai no contact quando ausente', () => {
    const r = resolveInboundIdentity(
      { profile: { name: 'C' }, wa_id: '551188', user_id: 'BR.c' },
      {}, // message sem from/from_user_id
    );
    expect(r.phone).toBe('551188');
    expect(r.bsuid).toBe('BR.c');
  });

  it('nome vazio quando o perfil não traz nome', () => {
    const r = resolveInboundIdentity(
      { user_id: 'BR.d' },
      { from_user_id: 'BR.d' },
    );
    expect(r.name).toBe('');
    expect(r.bsuid).toBe('BR.d');
    expect(r.phone).toBeNull();
  });

  it('sem contact e sem identidade → tudo null/vazio', () => {
    const r = resolveInboundIdentity(undefined, {});
    expect(r).toEqual({ phone: null, bsuid: null, username: null, name: '' });
  });
});
