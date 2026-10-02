// GET/POST /api/channels/hybrid — config do canal híbrido "Conexão redezap".
// Sessão ADMIN+. GET ?unitId lê; POST grava.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { getHybridConfig, saveHybridConfig } from "@/lib/channels/hybrid-config";
import type { BillableMode } from "@/lib/whatsapp/outbound-router";

export async function GET(request: Request) {
  try {
    await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }
  const unitId = new URL(request.url).searchParams.get("unitId")?.trim();
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });
  const cfg = await getHybridConfig(unitId);
  return NextResponse.json({ ok: true, ...cfg });
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
  const unitId = String(body.unitId ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "unitId é obrigatório" }, { status: 400 });
  const modes: BillableMode[] = ["auto", "always", "template_only"];
  const billableMode: BillableMode = modes.includes(body.billableMode as BillableMode)
    ? (body.billableMode as BillableMode)
    : "auto";
  try {
    await saveHybridConfig({
      unitId,
      accountId: ctx.accountId,
      hybridEnabled: body.hybridEnabled === true,
      uazapiPct: Number(body.uazapiPct ?? 0),
      billableMode,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
