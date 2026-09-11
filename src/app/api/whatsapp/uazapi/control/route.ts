// POST /api/whatsapp/uazapi/control — painel (admin) -> central.
// Body: { unitId, action: 'disconnect' | 'reset' }.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { controlUazapi } from "@/lib/uazapi/central-client";

export async function POST(request: Request) {
  try {
    await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }
  let body: { unitId?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const unitId = String(body.unitId ?? "").trim();
  const action = body.action === "reset" ? "reset" : "disconnect";
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });
  try {
    const r = await controlUazapi(unitId, action);
    return NextResponse.json({ ok: r.ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
