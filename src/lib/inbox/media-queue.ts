/**
 * Regras puras da FILA de anexos do compositor (envio de múltiplos arquivos).
 *
 * O WhatsApp envia 1 mídia por mensagem, então o compositor mantém uma fila e
 * despacha cada item como uma mensagem separada. Aqui decidimos quais arquivos
 * escolhidos entram na fila: respeitando o teto de quantidade e o limite de
 * tamanho por tipo (o mesmo cap da Meta já usado no upload). Puro/testável.
 */

export const MAX_MEDIA_QUEUE = 10;

export type MediaQueueKind = "image" | "video" | "document" | "audio";

export interface AcceptInput {
  files: File[];
  kind: MediaQueueKind;
  /** Quantos itens já estão na fila. */
  currentCount: number;
  /** Limite de bytes para este tipo (MEDIA_MAX_BYTES_BY_KIND[kind]). */
  maxBytes: number;
}

export interface AcceptResult {
  accepted: File[];
  rejected: { name: string; reason: string }[];
}

export function acceptFilesForQueue(input: AcceptInput): AcceptResult {
  const accepted: File[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let slot = input.currentCount;
  for (const file of input.files) {
    if (slot >= MAX_MEDIA_QUEUE) {
      rejected.push({
        name: file.name,
        reason: `Limite de no máximo ${MAX_MEDIA_QUEUE} arquivos por vez.`,
      });
      continue;
    }
    if (file.size > input.maxBytes) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      const cap = Math.round(input.maxBytes / 1024 / 1024);
      rejected.push({
        name: file.name,
        reason: `${file.name} tem ${mb} MB — limite de ${input.kind} é ${cap} MB.`,
      });
      continue;
    }
    accepted.push(file);
    slot++;
  }
  return { accepted, rejected };
}
