// ============================================================
// Resolução de mídia do canal Coexistence (echoes/history).
//
// Mensagens de mídia que o negócio envia pelo app WhatsApp Business chegam
// via smb_message_echoes/history carregando um `id` de mídia baixável. Este
// helper reusa EXATAMENTE o mesmo caminho do inbound oficial:
//   getMediaUrl (verifica + pega a URL da Meta) → mirrorInboundMedia (copia
//   pro bucket durável `chat-media`, pois a Meta apaga a mídia em ~30 dias) →
//   fallback pro proxy `/api/whatsapp/media/<id>`.
//
// Best-effort: nunca lança (uma falha vira null e a mensagem fica sem mídia,
// nunca derruba o webhook). getInfo/mirror são injetáveis para teste.
// ============================================================

import { getMediaUrl } from "./meta-api";
import { mirrorInboundMedia } from "./mirror-inbound-media";

type Storage = Parameters<typeof mirrorInboundMedia>[0]["storage"];

export interface ResolveCoexMediaArgs {
  mediaId: string;
  accessToken: string;
  /** accountId para espelhar no bucket; `null` desliga o espelho (usa o proxy). */
  accountId: string | null;
  storage: Storage;
  fileName?: string | null;
  messageTimestamp?: number | null;
  // Injeção de dependência (testes):
  getInfo?: typeof getMediaUrl;
  mirror?: typeof mirrorInboundMedia;
}

export async function resolveCoexMediaUrl(
  args: ResolveCoexMediaArgs,
): Promise<string | null> {
  const getInfo = args.getInfo ?? getMediaUrl;
  const mirror = args.mirror ?? mirrorInboundMedia;
  try {
    const info = await getInfo({
      mediaId: args.mediaId,
      accessToken: args.accessToken,
    });

    if (args.accountId) {
      const mirrored = await mirror({
        storage: args.storage,
        accountId: args.accountId,
        mediaId: args.mediaId,
        downloadUrl: info.url,
        accessToken: args.accessToken,
        mimeType: info.mimeType,
        fileSize: info.fileSize,
        fileName: args.fileName ?? undefined,
        messageTimestamp: args.messageTimestamp ?? undefined,
      });
      if (mirrored) return mirrored;
    }

    return `/api/whatsapp/media/${args.mediaId}`;
  } catch (err) {
    console.error(
      `[coex] falha ao resolver mídia ${args.mediaId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
