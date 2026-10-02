import { describe, it, expect, vi, beforeEach } from 'vitest';

const runDrainPass = vi.fn(async (..._args: unknown[]) => ({ skipped: false, remaining: 0 }));
vi.mock('@/lib/whatsapp/broadcast-queue', () => ({ runDrainPass: (...a: unknown[]) => runDrainPass(...a) }));
const broadcasts: { id: string; account_id: string }[] = [];
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ or: () => ({ limit: () => Promise.resolve({ data: broadcasts, error: null }) }) }) }) }),
  }),
}));

import { POST } from './route';

function req(headers: Record<string, string>) {
  return new Request('http://x/api/whatsapp/broadcasts/drain', { method: 'POST', headers });
}

beforeEach(() => {
  process.env.BROADCAST_DRAIN_SECRET = 'S';
  broadcasts.length = 0;
  runDrainPass.mockClear();
});

describe('POST /drain', () => {
  it('401 sem segredo', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
  });
  it('processa broadcasts com segredo do cron', async () => {
    broadcasts.push({ id: 'b1', account_id: 'a1' }, { id: 'b2', account_id: 'a2' });
    const res = await POST(req({ 'x-cron-secret': 'S' }));
    expect(res.status).toBe(200);
    expect(runDrainPass).toHaveBeenCalledTimes(2);
  });
});
