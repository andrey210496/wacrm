/**
 * Uma conversa só deve aparecer no inbox quando bate com a unidade selecionada.
 *
 * `selectedUnitId === null` significa "todas as unidades" (visão admin) → tudo
 * é visível. Quando uma unidade está selecionada, só conversas dessa unidade
 * aparecem; uma conversa sem unidade (não deveria acontecer) é tratada como NÃO
 * visível (fail-closed), para nunca vazar uma conversa de outra unidade.
 *
 * A carga inicial da lista já filtra por unidade (ConversationList). Este helper
 * garante o MESMO filtro no caminho de tempo real (Realtime), onde eventos de
 * conversas/mensagens de QUALQUER unidade da conta chegam ao admin.
 */
export function conversationVisibleInScope(
  conversationUnitId: string | null | undefined,
  selectedUnitId: string | null,
): boolean {
  if (!selectedUnitId) return true;
  return conversationUnitId === selectedUnitId;
}
