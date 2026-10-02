import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncSmbAppData } from './meta-api';

const calls: Array<{ url: string; init?: RequestInit }> = [];

function res(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('syncSmbAppData (coex)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    calls.length = 0;
  });

  it('posta em /smb_app_data com messaging_product + sync_type', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return res({ success: true });
    }));
    await syncSmbAppData({ phoneNumberId: 'PN1', accessToken: 'tok', syncType: 'history' });
    expect(calls[0].url).toContain('/PN1/smb_app_data');
    const body = JSON.parse((calls[0].init?.body as string) ?? '{}');
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.sync_type).toBe('history');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('sync_type smb_app_state_sync (contatos)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return res({ success: true });
    }));
    await syncSmbAppData({ phoneNumberId: 'PN', accessToken: 't', syncType: 'smb_app_state_sync' });
    const body = JSON.parse((calls[0].init?.body as string) ?? '{}');
    expect(body.sync_type).toBe('smb_app_state_sync');
  });

  it('propaga o erro cru da Meta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ error: { message: 'Sync window expired' } }, false, 400)));
    await expect(
      syncSmbAppData({ phoneNumberId: 'PN', accessToken: 't', syncType: 'history' }),
    ).rejects.toThrow('Sync window expired');
  });
});
