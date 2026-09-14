import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (vi.hoisted p/ os factories) ----
const m = vi.hoisted(() => ({
  getHybridConfig: vi.fn(),
  nextInterleaveCounter: vi.fn(),
  sendUazapi: vi.fn(),
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
}));

vi.mock('@/lib/channels/hybrid-config', () => ({
  getHybridConfig: m.getHybridConfig,
  nextInterleaveCounter: m.nextInterleaveCounter,
}));
vi.mock('@/lib/uazapi/central-client', () => ({ sendUazapi: m.sendUazapi }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: m.sendTextMessage,
  sendTemplateMessage: m.sendTemplateMessage,
  sendMediaMessage: m.sendMediaMessage,
  sendInteractiveButtons: m.sendInteractiveButtons,
  sendInteractiveList: m.sendInteractiveList,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'token',
  encrypt: () => 'enc',
  isLegacyFormat: () => false,
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }),
    }),
  }),
}));

import { sendMessageToConversation } from './send-message';

function makeDb(conversation: unknown, config: unknown, capture: { row?: Record<string, unknown> }) {
  return {
    from(table: string) {
      const obj: Record<string, unknown> = {};
      Object.assign(obj, {
        select: () => obj,
        eq: () => obj,
        limit: () => obj,
        order: () => obj,
        update: () => obj,
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') capture.row = row;
          return obj;
        },
        single: async () => {
          if (table === 'conversations') return { data: conversation, error: null };
          if (table === 'whatsapp_config') return { data: config, error: null };
          if (table === 'messages') return { data: { id: 'msg1' }, error: null };
          return { data: null, error: null };
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (onF: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(onF),
      });
      return obj;
    },
  };
}

const CONFIG = { id: 'cfg1', phone_number_id: 'PNID', access_token: 'enc:token' };

function convo(contact: Record<string, unknown>) {
  return {
    id: 'conv1',
    account_id: 'acc1',
    unit_id: 'unit1',
    last_inbound_at: new Date().toISOString(),
    contact,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.nextInterleaveCounter.mockResolvedValue(0);
  m.sendTextMessage.mockResolvedValue({ messageId: 'META1' });
  m.sendMediaMessage.mockResolvedValue({ messageId: 'METAM' });
  m.sendUazapi.mockResolvedValue({ messageId: 'UZ1' });
  // Híbrido ligado, 100%, modo 'always' (cobrável independe da data) → força a rota uazapi.
  m.getHybridConfig.mockResolvedValue({ hybridEnabled: true, uazapiPct: 100, billableMode: 'always' });
});

describe('sendMessageToConversation — roteamento híbrido', () => {
  it('texto cobrável 100% + telefone → envia por uazapi, NÃO pela Meta, channel=uazapi', async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const db = makeDb(convo({ id: 'c1', phone: '5511999998888', bsuid: null }), CONFIG, capture);
    const r = await sendMessageToConversation(db as never, 'acc1', {
      conversationId: 'conv1',
      messageType: 'text',
      contentText: 'oi',
    });
    expect(m.sendUazapi).toHaveBeenCalledTimes(1);
    expect(m.sendUazapi).toHaveBeenCalledWith('unit1', expect.objectContaining({ to: '5511999998888', type: 'text', text: 'oi' }));
    expect(m.sendTextMessage).not.toHaveBeenCalled();
    expect(capture.row?.channel).toBe('uazapi');
    expect(r.whatsappMessageId).toBe('UZ1');
  });

  it('uazapi FALHA → fail-safe pela Meta, channel=official', async () => {
    m.sendUazapi.mockRejectedValue(new Error('uazapi off'));
    const capture: { row?: Record<string, unknown> } = {};
    const db = makeDb(convo({ id: 'c1', phone: '5511999998888', bsuid: null }), CONFIG, capture);
    const r = await sendMessageToConversation(db as never, 'acc1', {
      conversationId: 'conv1',
      messageType: 'text',
      contentText: 'oi',
    });
    expect(m.sendUazapi).toHaveBeenCalledTimes(1);
    expect(m.sendTextMessage).toHaveBeenCalledTimes(1); // caiu pro oficial
    expect(capture.row?.channel).toBe('official');
    expect(r.whatsappMessageId).toBe('META1');
  });

  it('contato só-BSUID (sem telefone) → nunca uazapi, Meta por recipient, channel=official', async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const db = makeDb(convo({ id: 'c1', phone: null, bsuid: 'BR.abc' }), CONFIG, capture);
    await sendMessageToConversation(db as never, 'acc1', {
      conversationId: 'conv1',
      messageType: 'text',
      contentText: 'oi',
    });
    expect(m.sendUazapi).not.toHaveBeenCalled();
    expect(m.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(capture.row?.channel).toBe('official');
  });

  it('override official força Meta mesmo com híbrido 100%', async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const db = makeDb(convo({ id: 'c1', phone: '5511999998888', bsuid: null }), CONFIG, capture);
    await sendMessageToConversation(db as never, 'acc1', {
      conversationId: 'conv1',
      messageType: 'text',
      contentText: 'oi',
      channelOverride: 'official',
    });
    expect(m.sendUazapi).not.toHaveBeenCalled();
    expect(m.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(capture.row?.channel).toBe('official');
  });
});
