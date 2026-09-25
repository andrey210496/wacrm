"use server";

import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/account";
import { resolveAuthorName } from "@/lib/support/author-name";
import { supportCreateTicket } from "@/lib/support/central-support-client";

export async function submitNewSupportTicket(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const ctx = await requireRole("viewer");

  const title = String(formData.get("title") ?? "").trim();
  if (title.length < 3) return "Informe um título (mín. 3 caracteres).";

  const authorName = await resolveAuthorName(ctx.supabase, ctx.userId, ctx.account.name);

  let id: string;
  try {
    const r = await supportCreateTicket(formData, authorName);
    id = r.id;
  } catch (e) {
    return e instanceof Error ? e.message : "Falha ao abrir o chamado.";
  }

  redirect(`/support/${id}`);
}
