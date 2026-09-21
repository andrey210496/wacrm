import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ supabase: {}, accountId: 'acc', userId: 'user' })),
  toErrorResponse: (e: unknown) => new Response(JSON.stringify({ error: String(e) }), { status: 500 }),
}));
vi.mock('@/lib/units/operator-unit', () => ({ resolveOperatorUnitId: vi.fn(async () => 'u1') }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: (fn: () => unknown) => { void fn; } };
});
const resolveAudienceServer = vi.fn(async (..._args: unknown[]) => [{ id: 'c1', phone: '+1' }]);
vi.mock('@/lib/whatsapp/broadcast-audience', () => ({
  resolveAudienceServer: (...a: unknown[]) => resolveAudienceServer(...a),
  resolveVariables: () => [],
  fetchCustomValueIndex: async () => new Map(),
}));
const createBroadcastQueued = vi.fn(async (..._args: unknown[]) => ({ broadcastId: 'b1', total: 1 }));
vi.mock('@/lib/whatsapp/broadcast-queue', () => ({
  createBroadcastQueued: (...a: unknown[]) => createBroadcastQueued(...a),
  runDrainPass: vi.fn(),
}));

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://x/api/whatsapp/broadcasts/dispatch', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => { resolveAudienceServer.mockResolvedValue([{ id: 'c1', phone: '+1' }]); });

describe('POST /dispatch', () => {
  it('202 com total e rejected', async () => {
    const res = await POST(req({ template: { name: 't' }, audience: { type: 'all' } }));
    expect(res.status).toBe(202);
    const j = await res.json();
    expect(j).toMatchObject({ broadcast_id: 'b1', total_recipients: 1, rejected: 0 });
  });
  it('400 sem template_name', async () => {
    const res = await POST(req({ template: {}, audience: { type: 'all' } }));
    expect(res.status).toBe(400);
  });
  it('400 audiência vazia', async () => {
    resolveAudienceServer.mockResolvedValue([]);
    const res = await POST(req({ template: { name: 't' }, audience: { type: 'all' } }));
    expect(res.status).toBe(400);
  });
  it('grava audience_filter enxuto (sem csvContacts) no createBroadcastQueued', async () => {
    resolveAudienceServer.mockResolvedValue([{ id: 'c1', phone: '+1' }]);
    createBroadcastQueued.mockClear();
    const res = await POST(req({
      template: { name: 't' },
      audience: {
        type: 'csv',
        csvContacts: Array.from({ length: 50 }, (_, i) => ({ phone: `+1555${i}` })),
        tagIds: ['tag1'],
      },
    }));
    expect(res.status).toBe(202);
    expect(createBroadcastQueued).toHaveBeenCalledTimes(1);
    const call = createBroadcastQueued.mock.calls[0] as unknown[];
    const input = call[3] as { audience: Record<string, unknown> };
    expect(input.audience).not.toHaveProperty('csvContacts');
    expect(input.audience).toMatchObject({ type: 'csv', tagIds: ['tag1'] });
  });
});
