// POST /api/whatsapp/coex/connect — conexão via Embedded Signup self-service.
// A tela da Meta oferece DOIS caminhos e o `mode` diz qual foi:
//   • mode='official' (número novo): troca token → assina WABA → REGISTRA o
//     número (/register com PIN gerado, o passo que tira de "pendente") → salva.
//   • mode='coex' (conectar app existente): troca token → assina WABA → PULA o
//     /register (já registrado no app) → dispara os 2 syncs (contatos+histórico).
// Depois salva o whatsapp_config (connection_type) e reporta o status à central.
// Token nunca vai ao cliente; guardado criptografado (AES-256-GCM).
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";
import { exchangeCodeForToken } from "@/lib/whatsapp/embedded-signup";
import { subscribeWabaToApp, syncSmbAppData, getWabaPhoneNumbers, registerPhoneNumber } from "@/lib/whatsapp/meta-api";
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
  // Modo escolhido na tela da Meta. Se não vier, infere pela presença do número
  // (número novo/oficial traz phone_number_id; coex não). Default seguro: coex.
  const mode: "official" | "coex" = body.mode === "official" ? "official" : body.mode === "coex" ? "coex" : phoneNumberId ? "official" : "coex";
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

  // 3. Registro do número.
  //   • OFICIAL (número novo): PRECISA do /register com um PIN de 2 etapas — é o
  //     passo que tira de "pendente / Account not registered". Geramos o PIN,
  //     registramos e devolvemos UMA vez pro cliente guardar.
  //   • COEX: PULA o /register (o número já vem registrado do app).
  let registerPin: string | null = null;
  let registrationError: string | null = null;
  if (mode === "official") {
    registerPin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await registerPhoneNumber({ phoneNumberId, accessToken, pin: registerPin });
    } catch (err) {
      registrationError = err instanceof Error ? err.message : "Erro desconhecido da Meta.";
      console.error("[coex/connect] register (oficial) falhou:", registrationError);
    }
  }

  // 4. Syncs coex (contatos+histórico) — só no coex; best-effort, ≤24h.
  const syncErrors: string[] = [];
  if (mode === "coex") {
    for (const syncType of ["smb_app_state_sync", "history"] as const) {
      try {
        await syncSmbAppData({ phoneNumberId, accessToken, syncType });
      } catch (err) {
        const m = err instanceof Error ? err.message : "erro";
        console.warn(`[coex/connect] sync ${syncType} falhou:`, m);
        syncErrors.push(`${syncType}: ${m}`);
      }
    }
  }

  // 5. salva o whatsapp_config da unidade.
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
  // Coex já é registrado. Oficial só fica "connected/registered" se o /register
  // deu certo; se falhou, salva as credenciais mas marca desconectado + o erro.
  const isLive = mode === "coex" || registrationError === null;
  const row = {
    phone_number_id: phoneNumberId,
    waba_id: wabaId || null,
    access_token: accessTokenEnc,
    status: isLive ? "connected" : "disconnected",
    connection_type: mode,
    connected_at: isLive ? now : null,
    registered_at: isLive ? now : null,
    subscribed_apps_at: now,
    last_registration_error: registrationError,
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
    status: isLive ? "connected" : "pending",
    coex: mode === "coex",
    connectedAt: now,
  });
  if (!rep.ok) console.warn("[coex/connect] report pra central falhou:", rep.error);

  return NextResponse.json({
    ok: true,
    mode,
    connected: isLive,
    // Oficial: PIN de 2 etapas devolvido UMA vez (só quando o registro deu certo).
    registerPin: mode === "official" && registrationError === null ? registerPin : null,
    registrationError,
    syncTriggered: mode === "coex" ? syncErrors.length === 0 : undefined,
    syncErrors: syncErrors.length ? syncErrors : undefined,
    mirroredToCentral: rep.ok,
  });
}
