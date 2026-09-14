// GET /api/whatsapp/coex/config — devolve a config pública do Embedded Signup
// (coex) lida em RUNTIME no servidor (1 imagem/N clientes → não dá pra assar
// NEXT_PUBLIC no build). ADMIN. Não expõe segredo: só appId, configId e versão.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function GET() {
  try {
    await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }
  const appId = process.env.META_APP_ID?.trim() || null;
  const configId = process.env.META_CONFIG_ID?.trim() || null;
  const graphVersion = process.env.META_GRAPH_VERSION?.trim() || "v21.0";
  return NextResponse.json({
    appId,
    configId,
    graphVersion,
    // Só dá pra conectar por coex se o app e a config de login existirem.
    enabled: Boolean(appId && configId),
  });
}
