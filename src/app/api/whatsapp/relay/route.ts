import { NextResponse, after } from 'next/server'
import { verifyRelaySignature } from '@/lib/whatsapp/relay-signature'
import {
  processWebhook,
  type WhatsAppWebhookEntry,
} from '@/lib/whatsapp/process-webhook'

// Same headroom as the direct Meta webhook: the `after()` callback fans
// out to per-media Meta verification calls during inbound processing.
export const maxDuration = 60

/**
 * Parse a relayed body into the Meta webhook envelope. The central
 * relays the Meta event VERBATIM, normally as `application/json`. For
 * robustness we also tolerate `application/x-www-form-urlencoded` with a
 * `data=<json>` field (some relays / proxies re-wrap the payload that
 * way). Throws on anything we can't decode so the caller can log + ack.
 */
function parseRelayBody(
  rawBody: string,
  contentType: string | null,
): { entry?: WhatsAppWebhookEntry[] } {
  if (contentType?.includes('application/x-www-form-urlencoded')) {
    const data = new URLSearchParams(rawBody).get('data')
    if (data == null) {
      throw new Error('form-urlencoded body missing `data` field')
    }
    return JSON.parse(data)
  }
  return JSON.parse(rawBody)
}

// POST - Receive a webhook event relayed by the WhatsApp Gateway central.
//
// PUBLIC route: the central (Gestão USAI) calls it server-to-server and
// authenticates with an HMAC relay signature, not a browser session —
// so it is excluded from the middleware auth gate alongside the direct
// Meta webhook.
export async function POST(request: Request) {
  // Read the raw body first so we can HMAC-verify the exact bytes the
  // central signed. request.json() would re-encode and break the check.
  const rawBody = await request.text()
  const signature = request.headers.get('x-relay-signature')

  // Fail-closed relay auth. A missing secret, a missing header, or a
  // mismatch all reject with 401 — the ONLY guard on this public
  // endpoint. Never logs the secret or the raw body.
  if (!verifyRelaySignature(rawBody, signature)) {
    console.warn('[relay] rejected request with invalid relay signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // After this point we ALWAYS return 200. The central retries on any
  // non-2xx, so a parse failure or a downstream processing error must
  // not turn into a retry loop — we log and ack instead.
  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = parseRelayBody(rawBody, request.headers.get('content-type'))
  } catch {
    // Malformed body: log (without the raw body) and ack so the central
    // stops retrying an event we can never decode.
    console.error('[relay] could not parse relayed body — acking to stop retries')
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  // Process AFTER the response so we ack the central fast, while the
  // runtime keeps the function alive until the callback resolves — same
  // reasoning as the direct webhook (issue #301). Reuses the exact same
  // processing (routing by phone_number_id, idempotency/dedup, engines,
  // fan-out) as the direct Meta webhook.
  after(async () => {
    try {
      await processWebhook(body)
    } catch (error) {
      console.error('[relay] error processing relayed webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}
