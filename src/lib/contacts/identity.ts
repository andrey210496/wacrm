/**
 * Resolve a identidade de um remetente inbound do WhatsApp.
 *
 * Desde 2026 (usernames/BSUID), o telefone pode não vir: o `wa_id`/`from` só
 * aparece se houve interação nos últimos 30 dias ou o contato está na agenda.
 * O BSUID (`user_id`/`from_user_id`) vem SEMPRE. Então a identidade é:
 *   - telefone se houver;
 *   - o BSUID como chave estável (usado quando não há telefone, e guardado
 *     sempre para religar o mesmo usuário depois).
 *
 * Puro/testável. Ver process-webhook.ts (uso) e dedupe.ts (busca por bsuid).
 */
export type InboundIdentity = {
  /** Telefone cru (não normalizado) se disponível, senão null. */
  phone: string | null;
  /** Business-Scoped User ID (formato "BR.xxxx"), se presente. */
  bsuid: string | null;
  /** Username do WhatsApp, se o usuário ativou. */
  username: string | null;
  /** Nome do perfil (pode ser vazio). */
  name: string;
};

type InboundContact =
  | {
      profile?: { name?: string };
      wa_id?: string;
      user_id?: string;
      username?: string;
    }
  | undefined;

type InboundMessage = { from?: string; from_user_id?: string };

export function resolveInboundIdentity(
  contact: InboundContact,
  message: InboundMessage,
): InboundIdentity {
  const phone = message.from || contact?.wa_id || null;
  const bsuid = message.from_user_id || contact?.user_id || null;
  const username = contact?.username || null;
  const name = contact?.profile?.name || '';
  return { phone, bsuid, username, name };
}
