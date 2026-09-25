// ============================================================
// POST /api/gateway/whatsapp-provision — control plane -> instance.
//
// Depois que a central conecta um número via Embedded Signup (troca o code,
// inscreve a WABA no app único, registra o número e cria a Conexão de
// roteamento phone_number_id -> RelayTarget), ela EMPURRA número + token para
// ESTA instância, mapeado à unidade escolhida — para que a instância possa
// ENVIAR (outbound vai direto pra Meta com esse token) e rotear o inbound
// relayado por phone_number_id -> unidade.
//
// NÃO faz chamadas à Meta: a central já registrou/inscreveu. Aqui só persiste o
// whatsapp_config da unidade, com o access_token criptografado. Autenticado
// pelo segredo de licença (server-to-server), fail-closed.
//
// Corpo: { phone_number_id, waba_id?, access_token, unit_id }
// ============================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/whatsapp/encryption";
import { isAuthorizedControlPlane } from "@/lib/gateway/license-auth";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(request: Request) {
  if (!isAuthorizedControlPlane(request.headers.get("x-license-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    phone_number_id?: unknown;
    waba_id?: unknown;
    access_token?: unknown;
    unit_id?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const phone_number_id = String(body.phone_number_id ?? "").trim();
  const waba_id = body.waba_id ? String(body.waba_id).trim() : null;
  const access_token = String(body.access_token ?? "").trim();
  const unit_id = String(body.unit_id ?? "").trim();

  if (!phone_number_id || !access_token || !unit_id) {
    return NextResponse.json(
      { error: "phone_number_id, access_token e unit_id são obrigatórios." },
      { status: 400 },
    );
  }

  const db = admin();

  // A unidade existe e está ativa? Deriva o account_id dela.
  const { data: unit, error: unitErr } = await db
    .from("unidades")
    .select("id, account_id, active")
    .eq("id", unit_id)
    .maybeSingle();
  if (unitErr) {
    return NextResponse.json({ error: unitErr.message }, { status: 500 });
  }
  if (!unit || !unit.active) {
    return NextResponse.json(
      { error: "Unidade não encontrada ou inativa." },
      { status: 404 },
    );
  }

  // Resolve o dono da conta — `whatsapp_config.user_id` é NOT NULL (coluna de
  // auditoria/legado). Sem sessão aqui, o dono da conta é o valor natural.
  const { data: account, error: accErr } = await db
    .from("accounts")
    .select("owner_user_id")
    .eq("id", unit.account_id)
    .maybeSingle();
  if (accErr) {
    return NextResponse.json({ error: accErr.message }, { status: 500 });
  }
  if (!account?.owner_user_id) {
    return NextResponse.json(
      { error: "Conta da unidade sem dono definido." },
      { status: 500 },
    );
  }

  // phone_number_id já reivindicado por OUTRA unidade? (UNIQUE global do número
  // — o webhook/relay roteia por phone_number_id com .single()).
  const { data: claimed, error: claimErr } = await db
    .from("whatsapp_config")
    .select("unit_id")
    .eq("phone_number_id", phone_number_id)
    .neq("unit_id", unit_id)
    .maybeSingle();
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (claimed) {
    return NextResponse.json(
      { error: "Este número já está vinculado a outra unidade nesta instância." },
      { status: 409 },
    );
  }

  let access_token_enc: string;
  try {
    access_token_enc = encrypt(access_token);
  } catch {
    return NextResponse.json(
      {
        error:
          "Falha ao criptografar o token (verifique ENCRYPTION_KEY na instância).",
      },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();
  const row = {
    user_id: account.owner_user_id,
    account_id: unit.account_id,
    unit_id,
    phone_number_id,
    waba_id,
    access_token: access_token_enc,
    status: "connected" as const,
    connected_at: now,
    registered_at: now, // a central já registrou o número na Meta
    subscribed_apps_at: now, // a central já inscreveu a WABA no app único
    last_registration_error: null,
    updated_at: now,
  };

  // Upsert por unidade (UNIQUE(unit_id)): existe linha pra essa unidade?
  const { data: existing } = await db
    .from("whatsapp_config")
    .select("id")
    .eq("unit_id", unit_id)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from("whatsapp_config")
      .update(row)
      .eq("unit_id", unit_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await db.from("whatsapp_config").insert(row);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, phone_number_id, unit_id });
}
