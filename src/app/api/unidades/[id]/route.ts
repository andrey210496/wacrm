// ============================================================
// /api/unidades/[id]
//
//   PATCH  — rename and/or toggle active. Admin+.
//   DELETE — delete a unit.               Admin+.
//
// DELETE guard
//   Operational tables (contacts, conversations, deals, ...) and
//   `whatsapp_config` reference `unidades` with ON DELETE CASCADE
//   (migrations 042-043), so deleting a unit silently wipes its
//   data. We refuse the delete (409) when:
//     - the unit still has a connected `whatsapp_config` row, or
//     - it's the account's only unit (every account must keep >= 1;
//       operational tables have NOT NULL unit_id post-043).
//   The admin must disconnect the number / create another unit
//   first — same "empty it before deleting" pattern as the rest
//   of the app's destructive-action guards.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { slugify } from "@/lib/units/slug";

const MAX_NAME_LEN = 80;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:unitUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; active?: unknown }
      | null;

    if (!body || (body.name === undefined && body.active === undefined)) {
      return NextResponse.json(
        { error: "Provide 'name' and/or 'active' to update" },
        { status: 400 },
      );
    }

    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        return NextResponse.json(
          { error: "'name' must be a string" },
          { status: 400 },
        );
      }
      const name = body.name.trim();
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
      patch.name = name;
      patch.slug = slug;
    }

    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        return NextResponse.json(
          { error: "'active' must be a boolean" },
          { status: 400 },
        );
      }
      patch.active = body.active;
    }

    // RLS scopes the UPDATE to admin+ members of the unit's own
    // account, but we also filter by account_id explicitly so a
    // cross-account id resolves to a clean 404 (no row updated)
    // instead of relying solely on RLS to no-op it.
    const { data, error } = await ctx.supabase
      .from("unidades")
      .update(patch)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id, name, slug, active, created_at")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error:
              "A unit with that slug already exists in this account. Choose a different name.",
          },
          { status: 409 },
        );
      }
      console.error("[PATCH /api/unidades/[id]] update error:", error);
      return NextResponse.json(
        { error: "Failed to update unit" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    return NextResponse.json({ unit: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:unitDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // Confirm the unit belongs to the caller's account up front —
    // RLS would block a cross-account delete regardless, but this
    // gives a clean 404 instead of a misleading 409 from the guards
    // below (which assume the unit is in-scope).
    const { data: unit, error: unitError } = await ctx.supabase
      .from("unidades")
      .select("id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (unitError) {
      console.error("[DELETE /api/unidades/[id]] lookup error:", unitError);
      return NextResponse.json(
        { error: "Failed to delete unit" },
        { status: 500 },
      );
    }
    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    // Guard 1: refuse to delete the account's only unit.
    const { count, error: countError } = await ctx.supabase
      .from("unidades")
      .select("id", { count: "exact", head: true })
      .eq("account_id", ctx.accountId);

    if (countError) {
      console.error("[DELETE /api/unidades/[id]] count error:", countError);
      return NextResponse.json(
        { error: "Failed to delete unit" },
        { status: 500 },
      );
    }
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        {
          error:
            "Cannot delete the account's only unit. Create another unit first.",
        },
        { status: 409 },
      );
    }

    // Guard 2: refuse to delete a unit with a connected WhatsApp number.
    const { data: config, error: configError } = await ctx.supabase
      .from("whatsapp_config")
      .select("id")
      .eq("unit_id", id)
      .maybeSingle();

    if (configError) {
      console.error(
        "[DELETE /api/unidades/[id]] whatsapp_config lookup error:",
        configError,
      );
      return NextResponse.json(
        { error: "Failed to delete unit" },
        { status: 500 },
      );
    }
    if (config) {
      return NextResponse.json(
        {
          error:
            "This unit still has a connected WhatsApp number. Disconnect it before deleting the unit.",
        },
        { status: 409 },
      );
    }

    const { error: deleteError } = await ctx.supabase
      .from("unidades")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (deleteError) {
      console.error("[DELETE /api/unidades/[id]] delete error:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete unit" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
