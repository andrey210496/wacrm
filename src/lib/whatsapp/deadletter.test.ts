import { describe, it, expect } from 'vitest'
import { deadletterKey } from './deadletter'

describe('deadletterKey', () => {
  const val = (ids: string[], pnid = '123') => ({
    metadata: { phone_number_id: pnid },
    messages: ids.map((id) => ({ id })),
  })

  it('é determinística para o mesmo evento (mesma chave)', () => {
    expect(deadletterKey('123', val(['wamid.A']))).toBe(
      deadletterKey('123', val(['wamid.A'])),
    )
  })

  it('independe da ORDEM das mensagens (ids ordenados)', () => {
    expect(deadletterKey('123', val(['wamid.A', 'wamid.B']))).toBe(
      deadletterKey('123', val(['wamid.B', 'wamid.A'])),
    )
  })

  it('difere por phone_number_id', () => {
    expect(deadletterKey('123', val(['wamid.A']))).not.toBe(
      deadletterKey('999', val(['wamid.A'])),
    )
  })

  it('difere por conjunto de mensagens', () => {
    expect(deadletterKey('123', val(['wamid.A']))).not.toBe(
      deadletterKey('123', val(['wamid.A', 'wamid.B'])),
    )
  })

  it('sem ids de mensagem, cai no hash do corpo (e ainda é estável)', () => {
    const v = { metadata: { phone_number_id: '123' }, messages: [] }
    const k1 = deadletterKey('123', v)
    const k2 = deadletterKey('123', v)
    expect(k1).toBe(k2)
    expect(k1).toHaveLength(64) // sha256 hex
  })
})
