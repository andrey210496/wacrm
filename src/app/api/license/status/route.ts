// ============================================================
// GET /api/license/status — this instance's current license status.
//
// Fail-open: see src/lib/license/state.ts. A control-plane / DB
// outage returns the last good cached status, or 'active' if we
// never had one.
// ============================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLicenseStatus } from "@/lib/license/state";

export async function GET() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return NextResponse.json({ status: await getLicenseStatus(admin) });
}
