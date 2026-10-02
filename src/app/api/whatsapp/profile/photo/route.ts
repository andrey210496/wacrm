// POST /api/whatsapp/profile/photo — troca a foto do perfil do WhatsApp
// Business da unidade. ADMIN+. Recebe o arquivo por multipart (campo `file` +
// `unitId`), sobe pela Resumable Upload API (app-scoped) e aplica o handle no
// perfil. Sem fetch de URL do usuário → sem SSRF.
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { uploadProfilePhoto, updateBusinessProfile } from "@/lib/whatsapp/meta-profile";

// Limites da foto de perfil. // CONFIRMAR NA META os valores exatos.
const ALLOWED_TYPES = ["image/jpeg", "image/png"];
const MAX_BYTES = 5 * 1024 * 1024;

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
    console.error("[whatsapp/profile/photo] config lookup failed:", error);
    return { ok: false, message: "Falha ao ler a configuração." };
  }
  if (!config) return { ok: false, message: "Esta unidade ainda não tem o WhatsApp conectado." };
  try {
    return { ok: true, phoneNumberId: config.phone_number_id, accessToken: decrypt(config.access_token) };
  } catch (err) {
    console.error("[whatsapp/profile/photo] token decrypt failed:", err);
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

  const appId = process.env.META_APP_ID;
  if (!appId) {
    return NextResponse.json(
      { error: "A troca de foto precisa da variável META_APP_ID no ambiente (usada pelo Resumable Upload da Meta)." },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Envie o arquivo como multipart/form-data." }, { status: 400 });
  }

  const unitId = String(form.get("unitId") ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo 'file' (imagem) é obrigatório." }, { status: 400 });
  }
  const mimeType = (file.type || "").toLowerCase();
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: "A foto deve ser JPEG ou PNG." }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "Arquivo vazio." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `A foto tem ${(file.size / 1024 / 1024).toFixed(1)} MB — o limite é 5 MB.` },
      { status: 400 },
    );
  }

  const creds = await loadUnitCreds(ctx.supabase, ctx.accountId, unitId);
  if (!creds.ok) return NextResponse.json({ error: creds.message }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileName = mimeType === "image/png" ? "profile.png" : "profile.jpg";

  try {
    const { handle } = await uploadProfilePhoto({ appId, accessToken: creds.accessToken, fileName, mimeType, bytes });
    await updateBusinessProfile({
      phoneNumberId: creds.phoneNumberId,
      accessToken: creds.accessToken,
      fields: { profile_picture_handle: handle },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido da Meta.";
    console.error("[whatsapp/profile/photo POST] Meta error:", message);
    // 422 (não 502): recusa da Meta, não falha de gateway (ver username/route).
    return NextResponse.json({ error: `A Meta recusou a foto: ${message}` }, { status: 422 });
  }
}
