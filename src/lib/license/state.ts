// ============================================================
// Local license-state reader for this SILO instance.
//
// The control plane (SP2) flips `license_state.status` via
// POST /api/license/apply (see docs/contracts/license-v1.md). This
// reader is deliberately fail-open: a control-plane / DB outage must
// never take a paying client offline, so any read error falls back to
// the last good in-memory value, or 'active' if we never had one.
// ============================================================

export type LicenseStatus = "active" | "suspended";

let _cache: LicenseStatus | null = null;

/** Test-only: reset/seed the in-memory cache. */
export function __setCacheForTest(v: LicenseStatus | null) {
  _cache = v;
}

/**
 * Fail-open license read. Returns the stored status; on any error returns the
 * last good cached value, or 'active' if we never had one. A control-plane / DB
 * outage must never take a paying client offline.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLicenseStatus(client: any): Promise<LicenseStatus> {
  try {
    const { data, error } = await client
      .from("license_state")
      .select("status")
      .maybeSingle();
    if (error) throw error;
    const status: LicenseStatus = data?.status === "suspended" ? "suspended" : "active";
    _cache = status;
    return status;
  } catch {
    return _cache ?? "active";
  }
}
