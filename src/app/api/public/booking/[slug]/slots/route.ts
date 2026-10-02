// GET público — horários livres de um dia (Fase C). Sem sessão; escopado pelo slug.
import { NextResponse } from "next/server";
import { resolveBySlug, publicSlots } from "@/lib/public/booking";
import { allow } from "@/lib/public/rate-limit";

export const dynamic = "force-dynamic";

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  // Rate-limit leve na consulta de horários (60/10min por IP+slug).
  if (!allow(`slots:${slug}:${clientIp(request)}`, 60, 10 * 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const unit = await resolveBySlug(slug);
  if (!unit) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(request.url);
  const serviceId = url.searchParams.get("serviceId")?.trim() ?? "";
  const rawResource = url.searchParams.get("resourceId")?.trim() ?? "";
  const resourceId = rawResource && rawResource !== "any" ? rawResource : null;
  const dateStr = url.searchParams.get("date")?.trim() ?? "";
  if (!serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const slots = await publicSlots({ unit, serviceId, resourceId, dateStr });
  return NextResponse.json({ ok: true, slots });
}
