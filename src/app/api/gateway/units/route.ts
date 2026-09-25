// ============================================================
// GET /api/gateway/units — control plane -> instance.
//
// Lista as unidades ATIVAS desta instância SILO para a central montar o
// seletor de unidade no Embedded Signup (Opção A). Autenticado pelo segredo de
// licença (server-to-server), nunca por sessão. Devolve só dados não-sensíveis.
// ============================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthorizedControlPlane } from "@/lib/gateway/license-auth";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(request: Request) {
  if (!isAuthorizedControlPlane(request.headers.get("x-license-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await admin()
    .from("unidades")
    .select("id, name, slug")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ units: data ?? [] });
}
