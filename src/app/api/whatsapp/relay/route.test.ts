import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

// Shared, hoisted state the module mocks close over. Reset per test.
const h = vi.hoisted(() => ({
  processWebhook: vi.fn(),
  state: {
    afterCallbacks: [] as (() => Promise<void> | void)[],
  },
}))

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

// The relay route reuses the SAME processing as the direct webhook. We
// mock it here so we can assert the route calls it (and with what) —
// the extraction test below confirms both routes point at this module.
vi.mock('@/lib/whatsapp/process-webhook', () => ({
  processWebhook: h.processWebhook,
}))

import { POST } from './route'

/** HMAC-SHA256(rawBody, GATEWAY_RELAY_SECRET) as lowercase hex — the
 *  exact header the central sends. Uses the same secret the route reads
 *  from the env (set in vitest.config.ts). */
function sign(rawBody: string): string {
  return crypto
    .createHmac('sha256', process.env.GATEWAY_RELAY_SECRET as string)
    .update(rawBody)
    .digest('hex')
}

const META_EVENT = {
  entry: [
    {
      id: 'waba-1',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'pn-1' },
            contacts: [{ wa_id: '15551230000', profile: { name: 'Ada' } }],
            messages: [
              {
                id: 'wamid.RELAY1',
                from: '15551230000',
                timestamp: '1700000000',
                type: 'text',
                text: { body: 'hello via relay' },
              },
            ],
          },
        },
      ],
    },
  ],
}

/** Build a Request-like object: raw body + the headers the route reads. */
function relayRequest({
  rawBody,
  signature,
  contentType = 'application/json',
}: {
  rawBody: string
  signature: string | null
  contentType?: string | null
}): Request {
  const headers: Record<string, string | null> = {
    'x-relay-signature': signature,
    'content-type': contentType,
  }
  return {
    text: async () => rawBody,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as Request
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runRelay(request: Request): Promise<any> {
  const res = await POST(request)
  // Drain the after() callback exactly as the runtime would.
  for (const cb of h.state.afterCallbacks) await cb()
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.afterCallbacks = []
  h.processWebhook.mockResolvedValue(undefined)
})

describe('relay route: signature auth (fail-closed, timing-safe)', () => {
  it('a valid x-relay-signature processes the event and returns 200', async () => {
    const rawBody = JSON.stringify(META_EVENT)
    const res = await runRelay(
      relayRequest({ rawBody, signature: sign(rawBody) }),
    )

    expect(res.init?.status).toBe(200)
    expect(h.processWebhook).toHaveBeenCalledTimes(1)
    expect(h.processWebhook).toHaveBeenCalledWith(META_EVENT)
  })

  it('a missing signature is rejected with 401 and never processes', async () => {
    const rawBody = JSON.stringify(META_EVENT)
    const res = await runRelay(relayRequest({ rawBody, signature: null }))

    expect(res.init?.status).toBe(401)
    expect(h.processWebhook).not.toHaveBeenCalled()
  })

  it('a wrong signature is rejected with 401 and never processes', async () => {
    const rawBody = JSON.stringify(META_EVENT)
    const res = await runRelay(
      relayRequest({ rawBody, signature: sign('a different body') }),
    )

    expect(res.init?.status).toBe(401)
    expect(h.processWebhook).not.toHaveBeenCalled()
  })

  it('a signature for a tampered body is rejected (verifies the exact bytes)', async () => {
    const rawBody = JSON.stringify(META_EVENT)
    const signature = sign(rawBody)
    // Same valid signature, but the body was altered in transit.
    const tampered = rawBody.replace('hello via relay', 'malicious')
    const res = await runRelay(relayRequest({ rawBody: tampered, signature }))

    expect(res.init?.status).toBe(401)
    expect(h.processWebhook).not.toHaveBeenCalled()
  })

  it('fails closed with 401 when GATEWAY_RELAY_SECRET is unset', async () => {
    const original = process.env.GATEWAY_RELAY_SECRET
    // Sign with the real secret, then remove it: the route must still
    // reject rather than fall open.
    const rawBody = JSON.stringify(META_EVENT)
    const signature = sign(rawBody)
    delete process.env.GATEWAY_RELAY_SECRET
    try {
      const res = await runRelay(relayRequest({ rawBody, signature }))
      expect(res.init?.status).toBe(401)
      expect(h.processWebhook).not.toHaveBeenCalled()
    } finally {
      process.env.GATEWAY_RELAY_SECRET = original
    }
  })

  it('accepts a `sha256=`-prefixed signature (Meta-style shape)', async () => {
    const rawBody = JSON.stringify(META_EVENT)
    const res = await runRelay(
      relayRequest({ rawBody, signature: `sha256=${sign(rawBody)}` }),
    )

    expect(res.init?.status).toBe(200)
    expect(h.processWebhook).toHaveBeenCalledTimes(1)
  })
})

describe('relay route: body parsing', () => {
  it('parses form-urlencoded `data=` payloads', async () => {
    const json = JSON.stringify(META_EVENT)
    // The signed body is the form-urlencoded string itself.
    const rawBody = `data=${encodeURIComponent(json)}`
    const res = await runRelay(
      relayRequest({
        rawBody,
        signature: sign(rawBody),
        contentType: 'application/x-www-form-urlencoded',
      }),
    )

    expect(res.init?.status).toBe(200)
    expect(h.processWebhook).toHaveBeenCalledWith(META_EVENT)
  })

  it('acks a malformed (but authenticated) body with 200 without throwing', async () => {
    const rawBody = 'not json at all {{{'
    const res = await runRelay(
      relayRequest({ rawBody, signature: sign(rawBody) }),
    )

    // 200 so the central does not retry an event it can never decode,
    // and processing is never invoked.
    expect(res.init?.status).toBe(200)
    expect(h.processWebhook).not.toHaveBeenCalled()
  })

  it('acks a form body missing its `data` field with 200', async () => {
    const rawBody = 'other=1&foo=bar'
    const res = await runRelay(
      relayRequest({
        rawBody,
        signature: sign(rawBody),
        contentType: 'application/x-www-form-urlencoded',
      }),
    )

    expect(res.init?.status).toBe(200)
    expect(h.processWebhook).not.toHaveBeenCalled()
  })

  it('does not throw when processWebhook itself rejects (logged, still 200)', async () => {
    h.processWebhook.mockRejectedValueOnce(new Error('downstream boom'))
    const rawBody = JSON.stringify(META_EVENT)
    const res = await runRelay(
      relayRequest({ rawBody, signature: sign(rawBody) }),
    )

    expect(res.init?.status).toBe(200)
    expect(h.processWebhook).toHaveBeenCalledTimes(1)
  })
})
