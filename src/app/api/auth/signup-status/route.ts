// ============================================================
// GET /api/auth/signup-status — server-side source of truth for
// whether self-serve signup is closed on this SILO instance.
//
// SIGNUP_DISABLED is a server-only env var (not NEXT_PUBLIC_*), so the
// client signup form can't read it directly. Middleware already
// redirects an anonymous visit to /signup -> /login when disabled, but
// that alone isn't enough: a stale cached copy of the signup page
// (e.g. served by an edge CDN without hitting this app's origin — see
// the Cache-Control note in next.config.ts) could still reach a
// browser and its JS would call supabase.auth.signUp() directly. This
// route is hit fresh (no-store, per next.config.ts's /api/* rule) right
// before that call, so the check can never be served stale.
//
// The invite/join flow is exempt everywhere in this app (middleware,
// here) since teammates must still be able to create an account from
// /join/<token> -> /signup?invite=<token> while signup is otherwise
// closed.
// ============================================================

import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const hasInvite = Boolean(request.nextUrl.searchParams.get("invite"));
  const disabled = process.env.SIGNUP_DISABLED === "true" && !hasInvite;
  return NextResponse.json({ disabled });
}
