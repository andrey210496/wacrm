// GET /api/whatsapp/uazapi/status?unitId=... — painel (admin) -> central.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { statusUazapi } from "@/lib/uazapi/central-client";

export async function GET(request: Request) {
  try {
    await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }
  const unitId = new URL(request.url).searchParams.get("unitId")?.trim();
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });
  try {
    const r = await statusUazapi(unitId);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
