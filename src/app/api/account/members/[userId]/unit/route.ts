// ============================================================
// /api/account/members/[userId]/unit
//
//   PATCH — assign (or clear) the unit a member is locked to.
//           Admin+.
//
// Note on the [userId] segment name: the sibling route
// `/api/account/members/[userId]` already exists and identifies a
// member by `profiles.user_id` (not the profile row's own `id`).
// Next.js requires every route sharing a path position to use the
// same dynamic-segment name, so this route reuses `[userId]` rather
// than `[id]` — same identifier convention as
// `/api/account/members/[userId]/route.ts` (PATCH role, DELETE).
//
// Body: { unitId: string | null }. `null` clears the assignment —
// the member becomes account-wide "management" (sees everything,
// same as owner/admin regardless of their actual role... though in
// practice only agent/viewer rows are ever scoped by unit_id; see
// `@/lib/units/context`).
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberUnit:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { unitId?: unknown }
      | null;

    if (!body || !("unitId" in body)) {
      return NextResponse.json(
        { error: "'unitId' is required (a unit id, or null to unassign)" },
        { status: 400 },
      );
    }

    const { unitId } = body;
    if (unitId !== null && typeof unitId !== "string") {
      return NextResponse.json(
        { error: "'unitId' must be a string or null" },
        { status: 400 },
      );
    }

    // Validate the target unit belongs to the caller's account before
    // touching the member row. RLS on `unidades` would let us read it
    // regardless of account (any member can SELECT any unit in their
    // own account only), so an explicit account_id filter is what
    // actually rejects a foreign-account id here.
    if (unitId !== null) {
      const { data: unit, error: unitError } = await ctx.supabase
        .from("unidades")
        .select("id")
        .eq("id", unitId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();

      if (unitError) {
        console.error(
          "[PATCH members/[userId]/unit] unit lookup error:",
          unitError,
        );
        return NextResponse.json(
          { error: "Failed to assign unit" },
          { status: 500 },
        );
      }
      if (!unit) {
        return NextResponse.json(
          { error: "Unit not found in this account" },
          { status: 400 },
        );
      }
    }

    // Scope the UPDATE to the caller's own account so a userId from a
    // different account can't be targeted — profiles RLS would block
    // it anyway, but this keeps the failure a clean 404.
    const { data, error } = await ctx.supabase
      .from("profiles")
      .update({ unit_id: unitId })
      .eq("user_id", userId)
      .eq("account_id", ctx.accountId)
      .select("user_id, full_name, account_role, unit_id")
      .maybeSingle();

    if (error) {
      console.error("[PATCH members/[userId]/unit] update error:", error);
      return NextResponse.json(
        { error: "Failed to assign unit" },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ member: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
