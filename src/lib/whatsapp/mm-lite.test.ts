import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isMarketingTemplate,
  marketingSendUrl,
  mmApiVersion,
  getMarketingOnboardingStatus,
} from './mm-lite';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isMarketingTemplate', () => {
  it('true para categoria Marketing (case-insensitive)', () => {
    expect(isMarketingTemplate({ category: 'Marketing' })).toBe(true);
    expect(isMarketingTemplate({ category: 'marketing' })).toBe(true);
  });
  it('false para Utility, Authentication, ausente', () => {
    expect(isMarketingTemplate({ category: 'Utility' })).toBe(false);
    expect(isMarketingTemplate({ category: 'Authentication' })).toBe(false);
    expect(isMarketingTemplate(undefined)).toBe(false);
    expect(isMarketingTemplate(null)).toBe(false);
  });
});

describe('mmApiVersion / marketingSendUrl', () => {
  it('usa a env META_MM_API_VERSION quando definida', () => {
    vi.stubEnv('META_MM_API_VERSION', 'v25.0');
    expect(mmApiVersion()).toBe('v25.0');
    expect(marketingSendUrl('PN1')).toBe(
      'https://graph.facebook.com/v25.0/PN1/marketing_messages',
    );
  });
  it('cai no default quando a env não está setada', () => {
    vi.stubEnv('META_MM_API_VERSION', '');
    expect(mmApiVersion()).toBe('v24.0');
  });
});

describe('getMarketingOnboardingStatus', () => {
  function stubFetch(status: number, body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      })),
    );
  }

  it('ONBOARDED', async () => {
    stubFetch(200, { marketing_messages_onboarding_status: 'ONBOARDED', id: 'W1' });
    const r = await getMarketingOnboardingStatus('W1', 'tok');
    expect(r.status).toBe('ONBOARDED');
    expect(r.raw).toBe('ONBOARDED');
  });
  it('ELIGIBLE', async () => {
    stubFetch(200, { marketing_messages_onboarding_status: 'ELIGIBLE' });
    expect((await getMarketingOnboardingStatus('W1', 'tok')).status).toBe('ELIGIBLE');
  });
  it('valor desconhecido -> UNKNOWN', async () => {
    stubFetch(200, { marketing_messages_onboarding_status: 'SOMETHING_NEW' });
    expect((await getMarketingOnboardingStatus('W1', 'tok')).status).toBe('UNKNOWN');
  });
  it('resposta não-ok -> UNKNOWN', async () => {
    stubFetch(400, { error: { message: 'bad' } });
    expect((await getMarketingOnboardingStatus('W1', 'tok')).status).toBe('UNKNOWN');
  });
  it('fetch lança -> UNKNOWN (nunca propaga)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect((await getMarketingOnboardingStatus('W1', 'tok')).status).toBe('UNKNOWN');
  });
});
