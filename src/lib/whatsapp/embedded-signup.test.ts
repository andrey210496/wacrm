import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exchangeCodeForToken } from './embedded-signup';

const calls: string[] = [];

function res(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('exchangeCodeForToken', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    calls.length = 0;
    process.env.META_APP_ID = 'app-123';
    process.env.META_APP_SECRET = 'secret-xyz';
    delete process.env.META_GRAPH_VERSION;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...OLD };
  });

  it('monta a query com client_id/secret/code e devolve o token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return res({ access_token: 'TOK' });
    }));
    const tok = await exchangeCodeForToken({ code: 'CODE1' });
    expect(tok).toBe('TOK');
    expect(calls[0]).toContain('/oauth/access_token?');
    expect(calls[0]).toContain('client_id=app-123');
    expect(calls[0]).toContain('client_secret=secret-xyz');
    expect(calls[0]).toContain('code=CODE1');
  });

  it('erro claro quando faltam credenciais do app', async () => {
    delete process.env.META_APP_SECRET;
    await expect(exchangeCodeForToken({ code: 'x' })).rejects.toThrow(/não configurada/i);
  });

  it('propaga o erro cru da Meta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ error: { message: 'Invalid code' } }, false, 400)));
    await expect(exchangeCodeForToken({ code: 'x' })).rejects.toThrow('Invalid code');
  });

  it('erro quando a Meta não devolve token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({})));
    await expect(exchangeCodeForToken({ code: 'x' })).rejects.toThrow(/não retornou um access token/i);
  });
});
