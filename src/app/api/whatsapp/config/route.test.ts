import { beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------
// The config route talks to four collaborators. We stub all of them so
// the test exercises only the routing/scoping logic this rework changed:
//   * @/lib/supabase/server        — the caller's RLS-scoped client
//   * @supabase/supabase-js        — the service-role admin client used
//                                    for the cross-unit claim check
//   * @/lib/whatsapp/meta-api      — Meta verification / registration
//   * @/lib/whatsapp/encryption    — token encrypt/decrypt
// ------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  userSupabase: null as unknown,
  // The route lazily creates and caches ONE service-role admin client at
  // module scope, so a fresh per-test stub would never be picked up after
  // the first call. Instead the admin stub is a stable object that records
  // into `adminCalls` (reset each test) and always reports the number as
  // unclaimed — the cross-unit claim check is asserted via those calls.
  adminCalls: [] as { table: string; ops: { op: string; args: unknown[] }[] }[],
  verifyPhoneNumber: vi.fn(),
  registerPhoneNumber: vi.fn(),
  subscribeWabaToApp: vi.fn(),
  encrypt: vi.fn((v: string) => `enc(${v})`),
  decrypt: vi.fn((v: string) => v.replace(/^enc\(|\)$/g, '')),
}))

function makeAdminStub() {
  function from(table: string) {
    const call = { table, ops: [] as { op: string; args: unknown[] }[] }
    mocks.adminCalls.push(call)
    const record = (op: string) => (...args: unknown[]) => {
      call.ops.push({ op, args })
      return chain
    }
    const unclaimed = Promise.resolve({ data: null, error: null })
    const chain: Record<string, unknown> = {
      select: record('select'),
      eq: record('eq'),
      neq: record('neq'),
      maybeSingle: () => unclaimed,
      single: () => unclaimed,
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        unclaimed.then(resolve, reject),
    }
    return chain
  }
  return { from }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mocks.userSupabase),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => makeAdminStub()),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: mocks.verifyPhoneNumber,
  registerPhoneNumber: mocks.registerPhoneNumber,
  subscribeWabaToApp: mocks.subscribeWabaToApp,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
}))

import { GET, POST, DELETE } from './route'

// ------------------------------------------------------------
// Sequential-queue Supabase stub (same shape as the /api/unidades test).
// Each `.from(table)` records a Call and consumes the next queued result
// on whichever terminal (`maybeSingle`, `single`, or a bare `await`) the
// route uses. `.eq/.neq/.order/.limit` all record their args so a test
// can assert the write was scoped to the right unit.
// ------------------------------------------------------------
interface QueuedResult {
  data?: unknown
  error?: unknown
}

interface Call {
  table: string
  ops: { op: string; args: unknown[] }[]
}

function makeSupabase(queue: QueuedResult[], user: { id: string } | null = { id: 'user-1' }) {
  let i = 0
  const calls: Call[] = []

  function from(table: string) {
    const call: Call = { table, ops: [] }
    calls.push(call)

    const resolveNext = () => {
      const result = queue[Math.min(i, queue.length - 1)] ?? { data: null, error: null }
      i += 1
      return result
    }

    const record = (op: string) => (...args: unknown[]) => {
      call.ops.push({ op, args })
      return chain
    }

    const chain: Record<string, unknown> = {
      select: record('select'),
      insert: record('insert'),
      update: record('update'),
      delete: record('delete'),
      eq: record('eq'),
      neq: record('neq'),
      order: record('order'),
      limit: record('limit'),
      single: () => Promise.resolve(resolveNext()),
      maybeSingle: () => Promise.resolve(resolveNext()),
      then: (resolve: (v: QueuedResult) => void, reject: (e: unknown) => void) =>
        Promise.resolve(resolveNext()).then(resolve, reject),
    }
    return chain
  }

  return {
    supabase: {
      from,
      auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    } as unknown,
    calls,
  }
}

/** Find the ops recorded against the Nth `.from('whatsapp_config')` call. */
function whatsappCalls(calls: Call[]): Call[] {
  return calls.filter((c) => c.table === 'whatsapp_config')
}

/** True if a call scoped itself with `.eq('unit_id', unitId)`. */
function scopedToUnit(call: Call, unitId: string): boolean {
  return call.ops.some(
    (o) => o.op === 'eq' && o.args[0] === 'unit_id' && o.args[1] === unitId,
  )
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/whatsapp/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.adminCalls.length = 0
  mocks.verifyPhoneNumber.mockResolvedValue({ verified_name: 'Acme' })
  mocks.registerPhoneNumber.mockResolvedValue(undefined)
  mocks.subscribeWabaToApp.mockResolvedValue(undefined)
})

describe('POST /api/whatsapp/config — unit scoping', () => {
  it('rejects a request with no unitId (400) before any write', async () => {
    // profiles lookup (resolveAccountId) is the only db call reached.
    const { supabase } = makeSupabase([{ data: { account_id: 'acct-1' }, error: null }])
    mocks.userSupabase = supabase

    const res = await POST(
      postRequest({ phone_number_id: '111', access_token: 'tok' }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/unitId is required/i)
  })

  it('rejects a unitId that is not in the caller account (400)', async () => {
    const { supabase } = makeSupabase([
      { data: { account_id: 'acct-1' }, error: null }, // profiles
      { data: null, error: null }, // unidades ownership → not found
    ])
    mocks.userSupabase = supabase

    const res = await POST(
      postRequest({ phone_number_id: '111', access_token: 'tok', unitId: 'foreign-unit' }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/not found in this account/i)
  })

  it('updates ONLY the targeted unit row (scopes update by unit_id, no insert)', async () => {
    const unitId = 'unit-a'
    const { supabase, calls } = makeSupabase([
      { data: { account_id: 'acct-1' }, error: null }, // profiles
      { data: { id: unitId }, error: null }, // unidades ownership
      { data: { id: 'cfg-a', registered_at: '2026-01-01T00:00:00Z', phone_number_id: '111' }, error: null }, // existing (this unit)
      { data: null, error: null }, // update result
    ])
    mocks.userSupabase = supabase

    const res = await POST(
      postRequest({ phone_number_id: '111', access_token: 'tok', unitId }),
    )
    expect(res.status).toBe(200)

    const wa = whatsappCalls(calls)
    // Two whatsapp_config touches on the USER client: the existing-lookup
    // and the update. Both must be pinned to this unit; neither is an insert.
    const updateCall = wa.find((c) => c.ops.some((o) => o.op === 'update'))
    expect(updateCall, 'an update was issued').toBeTruthy()
    expect(scopedToUnit(updateCall!, unitId), 'update scoped to unit_id').toBe(true)
    expect(wa.some((c) => c.ops.some((o) => o.op === 'insert'))).toBe(false)
  })

  it('claim check excludes the current unit (keys on unit_id, not account_id)', async () => {
    const unitId = 'unit-a'
    const { supabase } = makeSupabase([
      { data: { account_id: 'acct-1' }, error: null }, // profiles
      { data: { id: unitId }, error: null }, // unidades ownership
      { data: { id: 'cfg-a', registered_at: '2026-01-01T00:00:00Z', phone_number_id: '111' }, error: null }, // existing
      { data: null, error: null }, // update
    ])
    mocks.userSupabase = supabase

    await POST(postRequest({ phone_number_id: '111', access_token: 'tok', unitId }))

    const claim = mocks.adminCalls.filter((c) => c.table === 'whatsapp_config')[0]
    expect(claim, 'claim check ran on the admin client').toBeTruthy()
    const neq = claim.ops.find((o) => o.op === 'neq')
    expect(neq?.args).toEqual(['unit_id', unitId])
  })
})

describe('DELETE /api/whatsapp/config — unit scoping', () => {
  it('requires a unitId query param (400)', async () => {
    const { supabase } = makeSupabase([{ data: { account_id: 'acct-1' }, error: null }])
    mocks.userSupabase = supabase

    const res = await DELETE(new Request('http://localhost/api/whatsapp/config', { method: 'DELETE' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/unitId/i)
  })

  it('deletes ONLY the targeted unit row (scopes delete by unit_id)', async () => {
    const unitId = 'unit-b'
    const { supabase, calls } = makeSupabase([
      { data: { account_id: 'acct-1' }, error: null }, // profiles
      { data: { id: unitId }, error: null }, // unidades ownership
      { data: null, error: null }, // delete result
    ])
    mocks.userSupabase = supabase

    const res = await DELETE(
      new Request(`http://localhost/api/whatsapp/config?unitId=${unitId}`, { method: 'DELETE' }),
    )
    expect(res.status).toBe(200)

    const del = whatsappCalls(calls).find((c) => c.ops.some((o) => o.op === 'delete'))
    expect(del, 'a delete was issued').toBeTruthy()
    expect(scopedToUnit(del!, unitId), 'delete scoped to unit_id').toBe(true)
  })
})

describe('GET /api/whatsapp/config — unit scoping', () => {
  it('scopes the config read to the unitId query param', async () => {
    const unitId = 'unit-c'
    const { supabase, calls } = makeSupabase([
      { data: { account_id: 'acct-1' }, error: null }, // profiles (resolveAccountId)
      { data: { phone_number_id: '111', access_token: 'enc(tok)', status: 'connected' }, error: null }, // config
    ])
    mocks.userSupabase = supabase

    const res = await GET(new Request(`http://localhost/api/whatsapp/config?unitId=${unitId}`))
    expect(res.status).toBe(200)

    const configRead = whatsappCalls(calls)[0]
    expect(scopedToUnit(configRead, unitId), 'read scoped to unit_id').toBe(true)
  })

  it('falls back to the oldest row when no unitId is given (no throw on multi-unit)', async () => {
    const { supabase, calls } = makeSupabase([
      { data: { account_id: 'acct-1' }, error: null }, // profiles
      { data: { phone_number_id: '111', access_token: 'enc(tok)', status: 'connected' }, error: null }, // config
    ])
    mocks.userSupabase = supabase

    const res = await GET(new Request('http://localhost/api/whatsapp/config'))
    expect(res.status).toBe(200)

    const configRead = whatsappCalls(calls)[0]
    // Ordered + limited rather than a bare maybeSingle that would PGRST116.
    expect(configRead.ops.some((o) => o.op === 'limit')).toBe(true)
    expect(configRead.ops.some((o) => o.op === 'order')).toBe(true)
  })
})
