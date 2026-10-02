// ============================================================
// Resolução do RESPONSÁVEL (atendente) de uma conversa para exibição.
// Puro/testável, compartilhado pelo cabeçalho da conversa (message-thread)
// e pelo item da lista (conversation-list), pra os dois mostrarem "quem
// está atendendo" de forma consistente.
// ============================================================

interface ProfileLite {
  user_id: string;
  full_name: string;
  avatar_url?: string | null;
}

export interface AssigneeInfo {
  /** A conversa tem responsável? (assigned_agent_id preenchido) */
  assigned: boolean;
  /** Nome do responsável, ou null quando não atribuído OU o agente não está
   *  no conjunto de perfis visível (RLS). A UI aplica o rótulo de fallback. */
  name: string | null;
  /** Iniciais do nome (até 2), ou null quando não há nome. */
  initials: string | null;
  /** Foto do responsável, quando houver. */
  avatarUrl: string | null;
}

/** Até 2 iniciais maiúsculas de um nome (primeiro + último). */
export function assigneeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (
    parts[0].charAt(0) + parts[parts.length - 1].charAt(0)
  ).toUpperCase();
}

/**
 * Resolve o responsável de uma conversa para exibição.
 * - Sem `assignedAgentId` → não atribuído.
 * - Atribuído e no conjunto visível → nome/iniciais/avatar.
 * - Atribuído mas fora do conjunto visível (RLS) → `assigned:true` sem nome,
 *   pra UI mostrar "atribuído" em vez de "não atribuído".
 */
export function resolveAssignee(
  profiles: ProfileLite[],
  assignedAgentId: string | null | undefined,
): AssigneeInfo {
  if (!assignedAgentId) {
    return { assigned: false, name: null, initials: null, avatarUrl: null };
  }
  const p = profiles.find((x) => x.user_id === assignedAgentId);
  if (!p) {
    return { assigned: true, name: null, initials: null, avatarUrl: null };
  }
  const name = p.full_name?.trim() ? p.full_name.trim() : null;
  return {
    assigned: true,
    name,
    initials: name ? assigneeInitials(name) : null,
    avatarUrl: p.avatar_url ?? null,
  };
}
