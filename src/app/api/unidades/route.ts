// ============================================================
// /api/unidades
//
//   GET  — list the caller's account units. Any member (RLS'
//          `unidades_select` policy allows any account member to
//          read the full list — settings-class visibility, not
//          the narrower per-unit scoping from `@/lib/units/context`).
//   POST — create a new unit. Admin+.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { slugify } from "@/lib/units/slug";

const MAX_NAME_LEN = 80;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("unidades")
      .select("id, name, slug, active, created_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/unidades] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load units" },
        { status: 500 },
      );
    }

    return NextResponse.json({ units: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:unitCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown }
      | null;
    const rawName = body?.name;

    if (typeof rawName !== "string") {
      return NextResponse.json(
        { error: "'name' must be a string" },
        { status: 400 },
      );
    }

    const name = rawName.trim();
    if (name.length === 0) {
      return NextResponse.json(
        { error: "Unit name cannot be empty" },
        { status: 400 },
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Unit name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const slug = slugify(name);
    if (!slug) {
      return NextResponse.json(
        { error: "Unit name must contain at least one letter or number" },
        { status: 400 },
      );
    }

    // RLS allows this INSERT because `unidades_insert` requires
    // `is_account_member(account_id, 'admin')`, and requireRole
    // already guaranteed the caller is admin+.
    const { data, error } = await ctx.supabase
      .from("unidades")
      .insert({ account_id: ctx.accountId, name, slug })
      .select("id, name, slug, active, created_at")
      .single();

    if (error) {
      // 23505 = unique_violation. UNIQUE(account_id, slug) on `unidades`.
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error: `A unit with the slug "${slug}" already exists in this account. Choose a different name.`,
          },
          { status: 409 },
        );
      }
      console.error("[POST /api/unidades] insert error:", error);
      return NextResponse.json(
        { error: "Failed to create unit" },
        { status: 500 },
      );
    }

    return NextResponse.json({ unit: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
