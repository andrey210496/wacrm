import { describe, it, expect, vi, afterEach } from 'vitest';

// Isola o roteamento: o builder de components não é o alvo aqui.
vi.mock('@/lib/whatsapp/template-send-builder', () => ({
  buildSendComponents: () => [],
}));

import { sendTemplateMessage } from './meta-api';
import type { MessageTemplate } from '@/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetchCapture() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'M1' }] }) };
    }),
  );
  return calls;
}

const marketingTemplate = { category: 'Marketing' } as MessageTemplate;
const utilityTemplate = { category: 'Utility' } as MessageTemplate;

describe('sendTemplateMessage — roteamento MM Lite', () => {
  it('template MARKETING vai para /marketing_messages com product_policy', async () => {
    vi.stubEnv('META_MM_API_VERSION', 'v24.0');
    const calls = stubFetchCapture();
    await sendTemplateMessage({
      phoneNumberId: 'PN1',
      accessToken: 'tok',
      to: '15550001',
      templateName: 'promo',
      template: marketingTemplate,
    });
    expect(calls[0].url).toBe('https://graph.facebook.com/v24.0/PN1/marketing_messages');
    expect(calls[0].body.product_policy).toBe('CLOUD_API_FALLBACK');
    expect(calls[0].body.type).toBe('template');
  });

  it('template UTILITY continua no /messages, sem product_policy', async () => {
    const calls = stubFetchCapture();
    await sendTemplateMessage({
      phoneNumberId: 'PN1',
      accessToken: 'tok',
      to: '15550001',
      templateName: 'recibo',
      template: utilityTemplate,
    });
    expect(calls[0].url).toContain('/PN1/messages');
    expect(calls[0].url).not.toContain('marketing_messages');
    expect(calls[0].body.product_policy).toBeUndefined();
  });

  it('sem template row (legacy) continua no /messages', async () => {
    const calls = stubFetchCapture();
    await sendTemplateMessage({
      phoneNumberId: 'PN1',
      accessToken: 'tok',
      to: '15550001',
      templateName: 'promo',
      params: ['x'],
    });
    expect(calls[0].url).toContain('/PN1/messages');
    expect(calls[0].body.product_policy).toBeUndefined();
  });
});
