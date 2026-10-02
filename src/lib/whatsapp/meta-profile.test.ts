import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBusinessProfile,
  updateBusinessProfile,
  setUsername,
  getUsername,
} from './meta-profile';

const calls: Array<{ url: string; init?: RequestInit }> = [];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('meta-profile', () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getBusinessProfile', () => {
    it('desembrulha { data: [perfil] } e pede os campos certos', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push({ url, init });
          return jsonResponse({ data: [{ about: 'Oi', websites: ['https://x.com'] }] });
        }),
      );
      const p = await getBusinessProfile({ phoneNumberId: 'PN1', accessToken: 'tok' });
      expect(p.about).toBe('Oi');
      expect(p.websites).toEqual(['https://x.com']);
      expect(calls[0].url).toContain('/PN1/whatsapp_business_profile?fields=');
      expect(calls[0].url).toContain('profile_picture_url');
      const headers = calls[0].init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok');
    });

    it('perfil vazio quando a Meta não devolve data', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
      expect(await getBusinessProfile({ phoneNumberId: 'PN', accessToken: 't' })).toEqual({});
    });

    it('propaga o erro cru da Meta', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'Bad token' } }, false, 401)));
      await expect(getBusinessProfile({ phoneNumberId: 'PN', accessToken: 't' })).rejects.toThrow('Bad token');
    });
  });

  describe('updateBusinessProfile', () => {
    it('manda messaging_product + só os campos passados', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push({ url, init });
          return jsonResponse({ success: true });
        }),
      );
      await updateBusinessProfile({
        phoneNumberId: 'PN1',
        accessToken: 'tok',
        fields: { about: 'Novo', websites: ['https://a.com'] },
      });
      expect(calls[0].url).toContain('/PN1/whatsapp_business_profile');
      const body = JSON.parse((calls[0].init?.body as string) ?? '{}');
      expect(body.messaging_product).toBe('whatsapp');
      expect(body.about).toBe('Novo');
      expect(body.websites).toEqual(['https://a.com']);
      expect(body.description).toBeUndefined();
    });

    it('inclui profile_picture_handle quando presente', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push({ url, init });
          return jsonResponse({ success: true });
        }),
      );
      await updateBusinessProfile({
        phoneNumberId: 'PN',
        accessToken: 't',
        fields: { profile_picture_handle: '2:HANDLE' },
      });
      const body = JSON.parse((calls[0].init?.body as string) ?? '{}');
      expect(body.profile_picture_handle).toBe('2:HANDLE');
    });

    it('propaga o erro cru da Meta', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'Invalid vertical' } }, false, 400)));
      await expect(
        updateBusinessProfile({ phoneNumberId: 'PN', accessToken: 't', fields: { vertical: 'X' } }),
      ).rejects.toThrow('Invalid vertical');
    });
  });

  describe('setUsername', () => {
    it('posta em /username com body { username } (sem messaging_product)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push({ url, init });
          return jsonResponse({ success: true });
        }),
      );
      await setUsername({ phoneNumberId: 'PN', accessToken: 't', username: 'pure.pilates' });
      expect(calls[0].url).toContain('/PN/username');
      const body = JSON.parse((calls[0].init?.body as string) ?? '{}');
      expect(body.username).toBe('pure.pilates');
      expect(body.messaging_product).toBeUndefined();
      expect(body.transfer_action).toBeUndefined();
    });

    it('inclui transfer_action quando pedido', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push({ url, init });
          return jsonResponse({ success: true });
        }),
      );
      await setUsername({ phoneNumberId: 'PN', accessToken: 't', username: 'x', transferAction: 'force_transfer' });
      const body = JSON.parse((calls[0].init?.body as string) ?? '{}');
      expect(body.transfer_action).toBe('force_transfer');
    });

    it('propaga o erro cru da Meta', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'Username taken' } }, false, 400)));
      await expect(setUsername({ phoneNumberId: 'PN', accessToken: 't', username: 'abc' })).rejects.toThrow('Username taken');
    });
  });

  describe('getUsername', () => {
    it('lê username + status de /username', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push({ url, init });
          return jsonResponse({ username: 'pure.pilates', status: 'reserved' });
        }),
      );
      const out = await getUsername('PN', 't');
      expect(calls[0].url).toContain('/PN/username');
      expect(out).toEqual({ username: 'pure.pilates', status: 'reserved' });
    });

    it('sem username definido → {}', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
      expect(await getUsername('PN', 't')).toEqual({ username: undefined, status: undefined });
    });
  });
});
