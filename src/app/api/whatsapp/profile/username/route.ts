// POST /api/whatsapp/profile/username — reserva/define o username do número
// (Username API da Meta, recurso NOVO em rollout 2026). ADMIN+. Fica atrás da
// flag PROFILE_USERNAME_ENABLED (default OFF): com a flag desligada devolve 501
// "em breve". O endpoint da Username API está // CONFIRMAR NA META, então o erro
// cru da Meta sobe pra UI se ainda não estiver liberado pro número.
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { setUsername } from "@/lib/whatsapp/meta-profile";
import { validateUsername } from "@/lib/whatsapp/profile-validate";

function usernameEnabled(): boolean {
  return process.env.PROFILE_USERNAME_ENABLED === "true";
}

async function loadUnitCreds(
  supabase: SupabaseClient,
  accountId: string,
  unitId: string,
): Promise<{ ok: true; phoneNumberId: string; accessToken: string } | { ok: false; message: string }> {
  const { data: config, error } = await supabase
    .from("whatsapp_config")
    .select("phone_number_id, access_token")
    .eq("account_id", accountId)
    .eq("unit_id", unitId)
    .maybeSingle();
  if (error) {
    console.error("[whatsapp/profile/username] config lookup failed:", error);
    return { ok: false, message: "Falha ao ler a configuração." };
  }
  if (!config) return { ok: false, message: "Esta unidade ainda não tem o WhatsApp conectado." };
  try {
    return { ok: true, phoneNumberId: config.phone_number_id, accessToken: decrypt(config.access_token) };
  } catch (err) {
    console.error("[whatsapp/profile/username] token decrypt failed:", err);
    return { ok: false, message: "O token salvo não pôde ser decriptado. Reconecte o número desta unidade." };
  }
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }

  if (!usernameEnabled()) {
    return NextResponse.json(
      { error: "O username do WhatsApp ainda não está disponível. Recurso em liberação gradual pela Meta." },
      { status: 501 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const unitId = String(body.unitId ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });

  const username = String(body.username ?? "").trim();
  const valid = validateUsername(username);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

  const creds = await loadUnitCreds(ctx.supabase, ctx.accountId, unitId);
  if (!creds.ok) return NextResponse.json({ error: creds.message }, { status: 400 });

  try {
    await setUsername({ phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken, username });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido da Meta.";
    console.error("[whatsapp/profile/username POST] Meta error:", message);
    // 422 (não 502): é recusa de conteúdo da Meta, não falha de gateway — não
    // colide com o 502 do proxy nem sugere "tente de novo" pra erro não-retentável.
    return NextResponse.json({ error: `A Meta recusou o username: ${message}` }, { status: 422 });
  }
}
