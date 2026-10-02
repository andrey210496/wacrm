import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { deriveUazapiRelayToken, verifyUazapiRelayToken } from './relay-auth'

describe('uazapi relay-auth', () => {
  const ORIG = process.env.LICENSE_CONTROL_SECRET
  beforeEach(() => {
    process.env.LICENSE_CONTROL_SECRET = 'licenca-123'
  })
  afterEach(() => {
    if (ORIG === undefined) delete process.env.LICENSE_CONTROL_SECRET
    else process.env.LICENSE_CONTROL_SECRET = ORIG
  })

  it('token derivado é HMAC hex estável e sem o segredo cru', () => {
    const t = deriveUazapiRelayToken('licenca-123')
    expect(t).toHaveLength(64)
    expect(t).not.toContain('licenca')
  })

  it('aceita o token correto (derivado do LICENSE_CONTROL_SECRET)', () => {
    const t = deriveUazapiRelayToken('licenca-123')
    expect(verifyUazapiRelayToken(t)).toBe(true)
  })

  it('rejeita token errado', () => {
    expect(verifyUazapiRelayToken('errado')).toBe(false)
  })

  it('rejeita ausente', () => {
    expect(verifyUazapiRelayToken(null)).toBe(false)
  })

  it('fail-closed sem LICENSE_CONTROL_SECRET', () => {
    delete process.env.LICENSE_CONTROL_SECRET
    expect(verifyUazapiRelayToken(deriveUazapiRelayToken('licenca-123'))).toBe(false)
  })
})
