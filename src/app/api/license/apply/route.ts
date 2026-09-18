// ============================================================
// POST /api/license/apply — control plane -> instance.
//
// The SP2 control plane flips this SILO instance's license status by
// calling this endpoint with a shared secret (LICENSE_CONTROL_SECRET).
// See docs/contracts/license-v1.md for the full contract.
// ============================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(request: Request) {
  const secret = process.env.LICENSE_CONTROL_SECRET;
  const provided = request.headers.get("x-license-secret");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { status?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (body.status !== "active" && body.status !== "suspended") {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const { error } = await admin()
    .from("license_state")
    .upsert({
      id: true,
      status: body.status,
      reason: body.reason ?? null,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: body.status });
}
