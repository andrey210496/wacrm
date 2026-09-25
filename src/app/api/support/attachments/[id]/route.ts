import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supportDownloadAttachment } from "@/lib/support/central-support-client";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("viewer"); // qualquer usuário logado da instância
  } catch (err) {
    return toErrorResponse(err);
  }
  const { id } = await params;
  const upstream = await supportDownloadAttachment(id);
  if (!upstream.ok || !upstream.body) {
    return new Response("Arquivo indisponível.", { status: upstream.status === 404 ? 404 : 502 });
  }
  const headers = new Headers();
  for (const h of ["content-type", "content-disposition", "content-length", "x-content-type-options", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: 200, headers });
}
