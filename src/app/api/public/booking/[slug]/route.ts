// Rotas PÚBLICAS do autoagendamento (Fase C) — SEM sessão. Escopadas pelo slug;
// rate-limited; honeypot. GET = dados públicos; POST = agendar.
import { NextResponse } from "next/server";
import { resolveBySlug, publicCatalog, createPublicBooking } from "@/lib/public/booking";
import { allow } from "@/lib/public/rate-limit";

export const dynamic = "force-dynamic";

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const unit = await resolveBySlug(slug);
  if (!unit) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { services, resources } = await publicCatalog(unit.unitId);
  return NextResponse.json({
    ok: true,
    unitName: unit.unitName,
    leadTimeMin: unit.leadTimeMin,
    windowDays: unit.windowDays,
    services,
    resources,
  });
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const ip = clientIp(request);

  // Rate-limit: 8 tentativas / 10min por IP+slug.
  if (!allow(`book:${slug}:${ip}`, 8, 10 * 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Honeypot: bots preenchem `hp`. Responde sucesso falso (não grava nada).
  if (typeof body.hp === "string" && body.hp.trim() !== "") {
    return NextResponse.json({ ok: true, appointmentId: "" });
  }

  const unit = await resolveBySlug(slug);
  if (!unit) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const serviceId = String(body.serviceId ?? "");
  const rawResource = String(body.resourceId ?? "");
  const resourceId = rawResource && rawResource !== "any" ? rawResource : null;
  const startsAtISO = String(body.startsAt ?? "");
  const name = String(body.name ?? "");
  const phone = String(body.phone ?? "");
  if (!serviceId || !startsAtISO || !name || !phone) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const result = await createPublicBooking({ unit, serviceId, resourceId, startsAtISO, name, phone });
  if (result.ok) {
    return NextResponse.json({ ok: true, appointmentId: result.appointmentId, startsAt: result.startsAt });
  }
  const status = result.reason === "invalid" ? 400 : 409;
  return NextResponse.json({ error: result.reason }, { status });
}
