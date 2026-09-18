// POST /api/whatsapp/uazapi/connect — painel (admin) -> central -> uazapi.
// Conecta/reconecta o canal uazapi de uma unidade e devolve o QR. Sessão ADMIN+.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { connectUazapi } from "@/lib/uazapi/central-client";

export async function POST(request: Request) {
  try {
    await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }
  let body: { unitId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const unitId = String(body.unitId ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });
  const t0 = Date.now();
  try {
    const r = await connectUazapi(unitId);
    console.info(`[uazapi/connect] ok unit=${unitId} status=${r.status ?? "?"} qr=${r.qrcode ? "sim" : "não"} ${Date.now() - t0}ms`);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    // Log com duração: distingue "demorou/timeout" de "falhou rápido" no diagnóstico.
    console.error(`[uazapi/connect] falhou unit=${unitId} ${Date.now() - t0}ms: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
