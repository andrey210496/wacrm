// POST /api/whatsapp/coex/connect — conexão Coexistence self-service (o próprio
// cliente conecta o número na instância). ADMIN. Recebe o resultado do Embedded
// Signup coex { code, phone_number_id, waba_id, unitId } e:
//   1. troca code→token (App Secret só no server)
//   2. assina a WABA no app
//   3. PULA o /register (coex: número já registrado no app WhatsApp Business)
//   4. dispara os 2 syncs coex (smb_app_state_sync + history), best-effort/≤24h
//   5. salva o whatsapp_config da unidade (connection_type='coex')
//   6. reporta o status pra central (best-effort)
// Token nunca vai ao cliente; guardado criptografado (AES-256-GCM).
import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";
import { exchangeCodeForToken } from "@/lib/whatsapp/embedded-signup";
import { subscribeWabaToApp, syncSmbAppData, getWabaPhoneNumbers } from "@/lib/whatsapp/meta-api";
import { reportNumberStatus } from "@/lib/whatsapp/report-number-status";

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

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

  const code = String(body.code ?? "").trim();
  // COEX: o FINISH traz só o waba_id; o phone_number_id é resolvido pela WABA
  // aqui no servidor. No fluxo padrão o cliente pode já mandar o phone_number_id.
  let phoneNumberId = String(body.phone_number_id ?? "").trim();
  const wabaId = String(body.waba_id ?? "").trim();
  const unitId = String(body.unitId ?? "").trim();
  if (!code || !wabaId || !unitId) {
    return NextResponse.json(
      { error: "code, waba_id e unitId são obrigatórios." },
      { status: 400 },
    );
  }

  // A unidade tem que ser da conta do chamador (RLS + filtro explícito).
  const { data: unit, error: unitErr } = await ctx.supabase
    .from("unidades")
    .select("id, name")
    .eq("id", unitId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (unitErr || !unit) {
    return NextResponse.json({ error: "Unidade não encontrada nesta conta." }, { status: 400 });
  }

  const db = admin();

  // 1. code → token (App Secret só no server).
  let accessToken: string;
  try {
    accessToken = await exchangeCodeForToken({ code });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido da Meta.";
    console.error("[coex/connect] troca de code falhou:", message);
    return NextResponse.json({ error: `Não foi possível concluir o login do Facebook: ${message}` }, { status: 422 });
  }

  // 1b. COEX: sem phone_number_id no evento → busca o número pela WABA.
  if (!phoneNumberId) {
    try {
      const numbers = await getWabaPhoneNumbers({ wabaId, accessToken });
      if (numbers.length === 0) {
        return NextResponse.json({ error: "A conta conectada não tem número de telefone disponível." }, { status: 422 });
      }
      // Coex conecta 1 número; se houver mais de um, pega o primeiro.
      phoneNumberId = numbers[0].id;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido da Meta.";
      console.error("[coex/connect] resolução do número pela WABA falhou:", message);
      return NextResponse.json({ error: `Não foi possível obter o número da conta: ${message}` }, { status: 422 });
    }
  }

  // 2. Trava global de phone_number_id: outra unidade já reivindicou? (409)
  const { data: claimed, error: claimErr } = await db
    .from("whatsapp_config")
    .select("unit_id")
    .eq("phone_number_id", phoneNumberId)
    .neq("unit_id", unitId)
    .maybeSingle();
  if (claimErr) {
    console.error("[coex/connect] checagem de phone_number_id falhou:", claimErr);
    return NextResponse.json({ error: "Falha ao validar o número." }, { status: 500 });
  }
  if (claimed) {
    return NextResponse.json(
      { error: "Este número já está conectado a outra unidade nesta instância." },
      { status: 409 },
    );
  }

  // 2. assina a WABA no app (idempotente).
  try {
    await subscribeWabaToApp({ wabaId, accessToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido da Meta.";
    console.error("[coex/connect] subscribe_apps falhou:", message);
    return NextResponse.json({ error: `Não foi possível assinar a conta WhatsApp: ${message}` }, { status: 422 });
  }

  // 3. COEX: pula o /register (número já registrado no app).

  // 4. dispara os 2 syncs coex (best-effort — não bloqueia a conexão; ≤24h).
  const syncErrors: string[] = [];
  for (const syncType of ["smb_app_state_sync", "history"] as const) {
    try {
      await syncSmbAppData({ phoneNumberId, accessToken, syncType });
    } catch (err) {
      const m = err instanceof Error ? err.message : "erro";
      console.warn(`[coex/connect] sync ${syncType} falhou:`, m);
      syncErrors.push(`${syncType}: ${m}`);
    }
  }

  // 5. salva o whatsapp_config da unidade. Coex = já registrado → status
  // connected + registered_at/subscribed_apps_at = agora.
  let accessTokenEnc: string;
  try {
    accessTokenEnc = encrypt(accessToken);
  } catch (err) {
    console.error("[coex/connect] criptografia falhou:", err);
    return NextResponse.json(
      { error: "Falha ao criptografar o token. Verifique ENCRYPTION_KEY no ambiente." },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();
  const row = {
    phone_number_id: phoneNumberId,
    waba_id: wabaId || null,
    access_token: accessTokenEnc,
    status: "connected",
    connection_type: "coex",
    connected_at: now,
    registered_at: now,
    subscribed_apps_at: now,
    last_registration_error: null,
    updated_at: now,
  };

  const { data: existing } = await ctx.supabase
    .from("whatsapp_config")
    .select("id")
    .eq("account_id", ctx.accountId)
    .eq("unit_id", unitId)
    .maybeSingle();

  if (existing) {
    const { error } = await ctx.supabase
      .from("whatsapp_config")
      .update(row)
      .eq("account_id", ctx.accountId)
      .eq("unit_id", unitId);
    if (error) {
      console.error("[coex/connect] update falhou:", error);
      return NextResponse.json({ error: "Falha ao salvar a configuração." }, { status: 500 });
    }
  } else {
    const { error } = await ctx.supabase
      .from("whatsapp_config")
      .insert({ account_id: ctx.accountId, unit_id: unitId, user_id: ctx.userId, ...row });
    if (error) {
      console.error("[coex/connect] insert falhou:", error);
      return NextResponse.json({ error: "Falha ao salvar a configuração." }, { status: 500 });
    }
  }

  // 6. espelha o status pra central (best-effort — não derruba a resposta).
  const rep = await reportNumberStatus({
    unitId,
    unitName: unit.name,
    phoneNumberId,
    wabaId,
    status: "connected",
    coex: true,
    connectedAt: now,
  });
  if (!rep.ok) console.warn("[coex/connect] report pra central falhou:", rep.error);

  return NextResponse.json({
    ok: true,
    connected: true,
    coex: true,
    syncTriggered: syncErrors.length === 0,
    syncErrors: syncErrors.length ? syncErrors : undefined,
    mirroredToCentral: rep.ok,
  });
}
