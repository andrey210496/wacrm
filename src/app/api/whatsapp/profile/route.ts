// GET/POST /api/whatsapp/profile — perfil do WhatsApp Business por unidade
// (Frente 3). ADMIN+: mexer no perfil público do negócio é gestão, não
// atendimento. Lê/edita direto na Meta com o token da unidade decriptado no
// server (nunca no cliente) e devolve o erro CRU da Meta pra divergência de
// campo/versão aparecer explícita — correção num ponto só (meta-profile.ts).
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { getBusinessProfile, updateBusinessProfile } from "@/lib/whatsapp/meta-profile";
import { validateProfileFields, type BusinessProfileFields } from "@/lib/whatsapp/profile-validate";

/**
 * Carrega a config da unidade e devolve `{ phoneNumberId, accessToken }` já
 * decriptado, ou um erro shaped pra UI. Scope por account_id + unit_id sob RLS:
 * um unitId de outra conta some (maybeSingle → null → no_config).
 */
async function loadUnitCreds(
  supabase: SupabaseClient,
  accountId: string,
  unitId: string,
): Promise<
  | { ok: true; phoneNumberId: string; accessToken: string }
  | { ok: false; reason: string; message: string }
> {
  const { data: config, error } = await supabase
    .from("whatsapp_config")
    .select("phone_number_id, access_token")
    .eq("account_id", accountId)
    .eq("unit_id", unitId)
    .maybeSingle();

  if (error) {
    console.error("[whatsapp/profile] config lookup failed:", error);
    return { ok: false, reason: "db_error", message: "Falha ao ler a configuração." };
  }
  if (!config) {
    return {
      ok: false,
      reason: "no_config",
      message: "Esta unidade ainda não tem o WhatsApp conectado. Conecte o número antes de editar o perfil.",
    };
  }
  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token);
  } catch (err) {
    console.error("[whatsapp/profile] token decrypt failed:", err);
    return {
      ok: false,
      reason: "token_corrupted",
      message: "O token salvo não pôde ser decriptado (ENCRYPTION_KEY mudou). Reconecte o número desta unidade.",
    };
  }
  return { ok: true, phoneNumberId: config.phone_number_id, accessToken };
}

/** GET /api/whatsapp/profile?unitId=... → perfil atual da unidade (via Meta). */
export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }

  const unitId = new URL(request.url).searchParams.get("unitId")?.trim();
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });

  // Fonte única da flag de username: a UI só mostra o bloco quando ligado.
  const usernameEnabled = process.env.PROFILE_USERNAME_ENABLED === "true";

  const creds = await loadUnitCreds(ctx.supabase, ctx.accountId, unitId);
  if (!creds.ok) {
    return NextResponse.json(
      { connected: false, reason: creds.reason, message: creds.message, username_enabled: usernameEnabled },
      { status: 200 },
    );
  }

  try {
    const profile = await getBusinessProfile({ phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken });
    return NextResponse.json({ connected: true, profile, username_enabled: usernameEnabled });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido da Meta.";
    console.error("[whatsapp/profile GET] Meta error:", message);
    return NextResponse.json(
      {
        connected: false,
        reason: "meta_api_error",
        message: `A Meta recusou a leitura do perfil: ${message}`,
        username_enabled: usernameEnabled,
      },
      { status: 200 },
    );
  }
}

/** POST /api/whatsapp/profile → atualiza campos do perfil (valida antes; erro da Meta cru no 502). */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const unitId = String(body.unitId ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });

  const fields = (body.fields ?? {}) as BusinessProfileFields;
  const photoHandle = body.profile_picture_handle;

  // Valida ANTES de tocar na Meta (mensagens em PT, limites centralizados).
  const valid = validateProfileFields(fields);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

  const creds = await loadUnitCreds(ctx.supabase, ctx.accountId, unitId);
  if (!creds.ok) return NextResponse.json({ error: creds.message }, { status: 400 });

  // Monta só os campos presentes (undefined não vai; "" limpa o campo na Meta).
  const payload: Partial<BusinessProfileFields> & { profile_picture_handle?: string } = {};
  if (fields.about !== undefined) payload.about = fields.about;
  if (fields.description !== undefined) payload.description = fields.description;
  if (fields.email !== undefined) payload.email = fields.email;
  if (fields.address !== undefined) payload.address = fields.address;
  if (fields.vertical !== undefined) payload.vertical = fields.vertical;
  if (fields.websites !== undefined) payload.websites = fields.websites;
  if (typeof photoHandle === "string" && photoHandle.length > 0) payload.profile_picture_handle = photoHandle;

  try {
    await updateBusinessProfile({ phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken, fields: payload });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido da Meta.";
    console.error("[whatsapp/profile POST] Meta error:", message);
    return NextResponse.json({ error: `A Meta recusou a atualização: ${message}` }, { status: 502 });
  }
}
