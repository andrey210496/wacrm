# License contract v1 (instance ↔ control plane)

Every wacrm deployment (SILO packaging — one instance per agency, see
the [SP1 design spec](../superpowers/specs/2026-09-02-usa-i-crm-multiunidade-sp1-design.md))
keeps a single local `license_state` row (migration `046`) that says
whether this instance is allowed to operate. A separate **control
plane** (built in SP2) is the source of truth for billing/licensing
across every deployed instance, and pushes state changes down to each
instance through the endpoints below.

> **Status:** v1 — the apply/status endpoints and the fail-open
> reader ship now. The app-boundary suspend gate (redirecting
> authenticated routes to `/suspended`) and the SP2 control plane
> itself are separate, later work.

## Principle: fail-open

A control-plane outage, a DNS hiccup, or this instance's own database
being briefly unreachable must **never** take a paying client
offline. Every read of the license status:

1. Returns the last value the instance actually stored, if the read
   succeeds.
2. Falls back to the **last known-good value it had cached in
   memory**, if the read fails.
3. Falls back to `'active'`, if it has never had a good read at all
   (e.g. right after a fresh boot, before the first successful
   status check).

Suspension only ever happens on a confirmed `'suspended'` write — it
is never inferred from an error, a timeout, or silence. See
`src/lib/license/state.ts` (`getLicenseStatus`) for the reference
implementation of this behavior.

## `POST /api/license/apply`

Called by the control plane to change this instance's license
status. Authenticates with a shared secret — there is no user session
involved, since the caller is another service, not a person.

**Auth:** header `x-license-secret` must equal the instance's
`LICENSE_CONTROL_SECRET` environment variable. If that variable is
unset, or the header is missing or wrong, the request is rejected —
an unset secret means the endpoint is closed, not open.

**Request**

```
POST /api/license/apply
x-license-secret: <shared secret>
Content-Type: application/json

{
  "status": "active" | "suspended",
  "reason": "optional free-text reason, e.g. \"payment overdue\""
}
```

**Responses**

| Status | Body                              | When                                                    |
| ------ | ---------------------------------- | -------------------------------------------------------- |
| `200`  | `{ "ok": true, "status": "..." }`  | Secret valid, body valid, `license_state` row upserted.  |
| `400`  | `{ "error": "..." }`               | Body isn't valid JSON, or `status` isn't `active`/`suspended`. |
| `401`  | `{ "error": "unauthorized" }`      | `LICENSE_CONTROL_SECRET` unset, or the header is missing/wrong. |
| `500`  | `{ "error": "..." }`               | The database write itself failed.                       |

The write is an upsert against the `license_state` singleton row
(`id = true`), so `apply` is safe to call repeatedly — the latest
call always wins, and there is nothing to create beforehand.

## `GET /api/license/status`

Called by anything on this instance that needs to know the current
license status (today: nothing yet; the app-boundary guard in a
later task will be the first real caller). No auth beyond normal
network access to the instance — this is a read of local state, not
a control-plane action.

**Request**

```
GET /api/license/status
```

**Response**

```
200 OK
{ "status": "active" | "suspended" }
```

Always `200`. This endpoint never fails outward — it inherits the
fail-open reader's guarantee, so even a database outage still returns
a `status` (the last known-good one, or `active`).

## Heartbeat (future — SP2)

Not implemented yet. The SP2 control plane is expected to add an
outbound **heartbeat** — this instance periodically calling home
(e.g. `POST` to a control-plane endpoint) to report that it is alive
and to pick up a status change proactively, rather than relying only
on the control plane pushing to `/api/license/apply`. This keeps the
two directions independent: `apply` lets the control plane push a
change in immediately; a heartbeat would let this instance notice a
change (or a control-plane outage) on its own schedule. Fail-open
still applies — a missed or failed heartbeat must never suspend an
instance on its own; only an explicit `'suspended'` write does that.
