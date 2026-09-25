"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/account";
import { resolveAuthorName } from "@/lib/support/author-name";
import { supportReply } from "@/lib/support/central-support-client";

export async function submitSupportReply(
  ticketId: string,
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const ctx = await requireRole("viewer");

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return "Escreva uma mensagem.";

  const authorName = await resolveAuthorName(ctx.supabase, ctx.userId, ctx.account.name);

  try {
    await supportReply(ticketId, formData, authorName);
  } catch (e) {
    return e instanceof Error ? e.message : "Falha ao enviar a resposta.";
  }

  revalidatePath(`/support/${ticketId}`);
  return undefined;
}
