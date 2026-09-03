// ============================================================
// Unit ("unidade") selection cookie — the persistence layer for the
// management-side unit filter.
//
// Deliberately dependency-free so it's safe to import from BOTH the
// server helper (`active-unit.ts`, which reads the cookie via
// `next/headers`) and client components (which read/write it via
// `document.cookie`). Keep it that way: it MUST NOT import anything
// that pulls `pg` / node built-ins, or importing the pure `UNIT_COOKIE`
// constant server-side would drag server-only code into the client
// bundle (the RSC/pg bundle-leak trap).
//
// Every `document` access lives inside a function body and is guarded
// with a `typeof document` check, so importing this module on the
// server never touches the DOM.
// ============================================================

/** Name of the cookie holding the admin's currently-selected unit id. */
export const UNIT_COOKIE = "unidade";

/** One year — the selection is a durable preference, not a session flag. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Persist (or clear) the selected unit. Passing `null` clears the
 * cookie, which the server helper reads as "all units".
 * No-op on the server (`document` undefined).
 */
export function writeUnitCookie(unitId: string | null): void {
  if (typeof document === "undefined") return;
  const base = `${UNIT_COOKIE}=`;
  if (unitId) {
    document.cookie = `${base}${encodeURIComponent(
      unitId,
    )}; path=/; SameSite=Lax; max-age=${MAX_AGE_SECONDS}`;
  } else {
    document.cookie = `${base}; path=/; SameSite=Lax; max-age=0`;
  }
}

/**
 * Read the selected unit id from `document.cookie`. Returns `null`
 * when absent or on the server. Server code should read the cookie
 * via `next/headers` + `UNIT_COOKIE` instead.
 */
export function readUnitCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${UNIT_COOKIE}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}
