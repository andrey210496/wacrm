import type { SupabaseClient } from "@supabase/supabase-js";

/** Nome de exibição do usuário logado (profiles.full_name), fallback p/ o nome da conta. */
export async function resolveAuthorName(
  supabase: SupabaseClient,
  userId: string,
  accountName: string,
): Promise<string> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", userId)
      .maybeSingle();
    const n = (data?.full_name as string | undefined)?.trim();
    return n && n.length > 0 ? n : accountName;
  } catch {
    return accountName;
  }
}
