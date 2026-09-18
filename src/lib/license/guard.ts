// ============================================================
// Dashboard-layout license gate.
//
// Checked once per server-rendered dashboard request (NOT in
// middleware — middleware runs on the Edge and a DB round-trip
// there is expensive on every request; the dashboard route-group
// layout is a server component that already does other per-request
// setup, so this piggybacks on that).
//
// Fail-open is inherited from getLicenseStatus (src/lib/license/state.ts):
// a control-plane / DB outage must never take a paying client offline.
// The try/catch below is a second, belt-and-suspenders layer around
// that — if building the client or calling getLicenseStatus ever
// throws (e.g. a missing env var), the dashboard layout must not 500;
// it should render normally rather than lock everyone out.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { getLicenseStatus } from "@/lib/license/state";

export async function isSuspended(): Promise<boolean> {
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    return (await getLicenseStatus(admin)) === "suspended";
  } catch {
    return false;
  }
}
