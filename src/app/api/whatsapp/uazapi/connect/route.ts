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
  try {
    const r = await connectUazapi(unitId);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
