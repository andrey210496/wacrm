/**
 * "Qualquer disponível" (Fase C): dado os slots livres POR recurso, produz uma
 * lista única por horário de início, atribuindo o 1º recurso livre. Puro.
 */

import type { TimeRange } from "./availability";

export type ResourceSlots = { resourceId: string; slots: TimeRange[] };
export type AssignedSlot = { start: Date; end: Date; resourceId: string };

/**
 * Une os slots de vários recursos: para cada horário de início distinto, o
 * PRIMEIRO recurso (na ordem dada) que tem aquele slot livre é atribuído.
 * Resultado ordenado por horário.
 */
export function combineResourceSlots(perResource: ResourceSlots[]): AssignedSlot[] {
  const byStart = new Map<number, AssignedSlot>();
  for (const { resourceId, slots } of perResource) {
    for (const s of slots) {
      const key = s.start.getTime();
      if (!byStart.has(key)) {
        byStart.set(key, { start: s.start, end: s.end, resourceId });
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}
