import crypto from 'node:crypto'

/**
 * Autentica o webhook uazapi → esta instância.
 *
 * A central e a instância derivam o MESMO token a partir do segredo de licença
 * (que a central tem via licenseSecretEnc e a instância tem em
 * `LICENSE_CONTROL_SECRET`), sem trafegar o segredo cru. A central põe esse
 * token na URL do webhook (`?token=`); aqui a gente recomputa e compara em
 * tempo constante. Fail-closed: sem `LICENSE_CONTROL_SECRET`, rejeita tudo.
 */
export function deriveUazapiRelayToken(licenseSecret: string): string {
  return crypto.createHmac('sha256', licenseSecret).update('uazapi-relay').digest('hex')
}

export function verifyUazapiRelayToken(provided: string | null): boolean {
  const secret = process.env.LICENSE_CONTROL_SECRET
  if (!secret || !provided) return false
  const expected = deriveUazapiRelayToken(secret)
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
