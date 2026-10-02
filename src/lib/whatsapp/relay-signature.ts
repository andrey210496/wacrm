import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature the WhatsApp Gateway central
 * (Gestão USAI) attaches to relayed webhook POSTs.
 *
 * After the gateway switch, inbound WhatsApp events for RedeZap's
 * numbers no longer arrive from Meta directly — the central receives
 * Meta's single webhook and relays each event to the owning product by
 * `phone_number_id`. The central signs the raw relayed body with the
 * RedeZap RelayTarget's shared secret and sends the result in the
 * `x-relay-signature` header. This is the ONLY thing standing between a
 * public relay endpoint and anyone POSTing fabricated inbound messages,
 * so it mirrors the fail-closed, timing-safe contract of
 * `verifyMetaWebhookSignature`.
 *
 * Contract:
 *   `GATEWAY_RELAY_SECRET` is **required**. If it's missing we fail
 *   closed — every relayed request is rejected until the operator
 *   configures the secret (the RelayTarget secret from the central).
 *
 * Header format: the central sends the lowercase hex digest of
 * HMAC-SHA256(rawBody, secret). An optional `sha256=` prefix is
 * tolerated so the endpoint keeps working if the central ever adopts
 * the same prefixed shape Meta uses.
 */
export function verifyRelaySignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.GATEWAY_RELAY_SECRET
  if (!secret) {
    console.error(
      '[relay] GATEWAY_RELAY_SECRET is not set — rejecting request. ' +
        'Configure the env var (the RedeZap RelayTarget secret from the ' +
        'WhatsApp Gateway central) to enable relay signature verification.',
    )
    return false
  }

  if (!signatureHeader) return false

  // Normalize away an optional `sha256=` prefix so both the bare-hex and
  // Meta-style prefixed shapes verify identically.
  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
