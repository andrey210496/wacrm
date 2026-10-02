# USA.i CRM Multiunidade (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "unidade" (unit) layer to wacrm so one client account holds N WhatsApp numbers, each with its own lead pool, while management sees everything consolidated — packaged SILO-style for EasyPanel, with a stub license gate the control plane (SP2) will drive.

**Architecture:** A new `unidades` table sits between `accounts` and the operational tables. Every operational row (contacts, conversations, deals, broadcasts, automations, flows) gains a `unit_id`. RLS composes the existing `is_account_member(account_id, role)` with a new `can_see_unit(account_id, unit_id)` helper: admin+ see all units, agent/viewer see only their assigned `profiles.unit_id`. The webhook routes inbound by `phone_number_id → whatsapp_config.unit_id`. The UI gains a unit selector and a consolidated dashboard. A fail-open license gate reads a local state (stub) and exposes an apply endpoint for SP2.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Supabase (Postgres + Auth + RLS), Vitest, recharts, Docker + EasyPanel.

**Base state:** migrations run through `039`; new deltas start at `040` (never edit a committed migration — every change is a new migration). Branch `feature/usa-i-multiunidade-sp1` already exists. Design spec: `docs/superpowers/specs/2026-09-02-usa-i-crm-multiunidade-sp1-design.md`.

**Verification commands (whole plan):**
- `npm run test` — Vitest unit tests
- `npm run typecheck` — tsc
- `npm run build` — Next build (catches RSC/pg bundle leaks tsc misses)
- Migrations verified by applying to the dev Supabase project and running the check query in each task.

---

## File Structure

**Migrations (create):**
- `supabase/migrations/040_unidades.sql` — `unidades` table + RLS.
- `supabase/migrations/041_profiles_unit_scope.sql` — `profiles.unit_id` + `can_see_unit` helper.
- `supabase/migrations/042_whatsapp_config_unit.sql` — `whatsapp_config.unit_id`, swap UNIQUE(account_id)→UNIQUE(unit_id), backfill "Matriz".
- `supabase/migrations/043_operational_unit_id.sql` — `unit_id` on contacts/conversations/deals/broadcasts/automations/flows + backfill + NOT NULL + indexes.
- `supabase/migrations/044_contacts_unit_dedup.sql` — dedup index → `(account_id, unit_id, phone_normalized)`.
- `supabase/migrations/045_rls_unit_scoping.sql` — rewrite operational RLS with `can_see_unit`.
- `supabase/migrations/046_license_state.sql` — local license state table.

**App code (create):**
- `src/lib/units/context.ts` — server helper: resolve caller's visible units + selected unit from cookie.
- `src/components/units/unit-selector.tsx` — topbar unit switcher (management only).
- `src/lib/license/state.ts` — read/write local license state, fail-open cache.
- `src/lib/license/guard.ts` — `requireLicense()` gate.
- `src/app/api/license/status/route.ts` — GET current license status.
- `src/app/api/license/apply/route.ts` — POST (control-plane→instance) set status, shared-secret auth.
- `src/app/(dashboard)/dashboard/consolidado/page.tsx` — consolidated dashboard (management).
- `src/app/(dashboard)/settings/unidades/page.tsx` + `src/components/settings/unidades-manager.tsx` — unit CRUD + agent assignment.
- `src/app/api/unidades/route.ts` + `src/app/api/unidades/[id]/route.ts` — unit CRUD API.

**App code (modify):**
- `src/lib/contacts/dedupe.ts` — add `unitId` param to `findExistingContact`.
- `src/app/api/whatsapp/webhook/route.ts` — thread `unit_id` through processing.
- `src/components/settings/whatsapp-config.tsx` — connect number per unit.
- `src/middleware.ts` (or proxy) — license gate + closed-signup redirect.
- `docker-compose.yml`, `.env.local.example`, `docs/docker.md` — SILO env + closed signup.
- `docs/contracts/license-v1.md` (create) — the instance↔control-plane contract.

---

## Phase 1 — Data foundation (migrations)

> Each migration task: write SQL → apply to dev Supabase (SQL editor or `psql`) → run the check query → confirm idempotency by applying twice → commit. Migrations are idempotent (repo convention).

### Task 1: `unidades` table + RLS

**Files:**
- Create: `supabase/migrations/040_unidades.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 040_unidades.sql — the "unidade" (unit) tenancy level between accounts and data.
-- One account (client) has N unidades; each unidade owns one WhatsApp number and
-- its own lead pool. Idempotent.

CREATE TABLE IF NOT EXISTS unidades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_unidades_account ON unidades(account_id);

ALTER TABLE unidades ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON unidades;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON unidades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Members read; admins+ write (settings-class).
DROP POLICY IF EXISTS unidades_select ON unidades;
DROP POLICY IF EXISTS unidades_insert ON unidades;
DROP POLICY IF EXISTS unidades_update ON unidades;
DROP POLICY IF EXISTS unidades_delete ON unidades;
CREATE POLICY unidades_select ON unidades FOR SELECT USING (is_account_member(account_id));
CREATE POLICY unidades_insert ON unidades FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY unidades_update ON unidades FOR UPDATE USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY unidades_delete ON unidades FOR DELETE USING (is_account_member(account_id, 'admin'));
```

- [ ] **Step 2: Apply to dev Supabase and verify**

Run the migration in the Supabase SQL editor (or `psql "$DATABASE_URL" -f supabase/migrations/040_unidades.sql`).
Check: `SELECT to_regclass('public.unidades');` → expected: `unidades` (not null).
Check idempotency: run the file a second time → expected: no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/040_unidades.sql
git commit -m "feat(db): unidades table + RLS (040)"
```

### Task 2: `profiles.unit_id` + `can_see_unit` helper

**Files:**
- Create: `supabase/migrations/041_profiles_unit_scope.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 041_profiles_unit_scope.sql — assign a user to a unit + the visibility helper.
-- owner/admin: unit_id irrelevant, they see ALL units (role >= admin).
-- agent/viewer: see ONLY rows whose unit_id == their profiles.unit_id.
-- An agent/viewer with NULL unit_id sees nothing until assigned (safe default).
-- Idempotent.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_unit ON profiles(unit_id);

-- SECURITY DEFINER so RLS policy bodies can read profiles without recursion.
CREATE OR REPLACE FUNCTION can_see_unit(
  target_account_id UUID,
  target_unit_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND (
        CASE p.account_role
          WHEN 'owner'  THEN 4
          WHEN 'admin'  THEN 3
          WHEN 'agent'  THEN 2
          WHEN 'viewer' THEN 1
        END >= 3
        OR p.unit_id = target_unit_id
      )
  );
$$;

ALTER FUNCTION can_see_unit(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION can_see_unit(UUID, UUID) TO authenticated, service_role;
```

- [ ] **Step 2: Apply and verify**

Check: `SELECT proname FROM pg_proc WHERE proname = 'can_see_unit';` → expected: one row.
Check: `SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name='unit_id';` → expected: `unit_id`.
Run twice → no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/041_profiles_unit_scope.sql
git commit -m "feat(db): profiles.unit_id + can_see_unit helper (041)"
```

### Task 3: `whatsapp_config.unit_id` + multi-number + backfill "Matriz"

**Files:**
- Create: `supabase/migrations/042_whatsapp_config_unit.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 042_whatsapp_config_unit.sql — one WhatsApp number PER UNIT (was per account).
-- Backfill: every existing account gets a "Matriz" unidade, and its existing
-- whatsapp_config row (if any) is linked to it. Keeps UNIQUE(phone_number_id)
-- global (webhook uses .single()). Idempotent.

-- 1) Column
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;

-- 2) Backfill: one "Matriz" unidade per account that has none yet.
INSERT INTO unidades (account_id, name, slug)
SELECT a.id, 'Matriz', 'matriz'
FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM unidades u WHERE u.account_id = a.id);

-- 3) Link existing configs to their account's Matriz (first unidade).
UPDATE whatsapp_config wc
SET unit_id = (
  SELECT u.id FROM unidades u
  WHERE u.account_id = wc.account_id
  ORDER BY u.created_at ASC
  LIMIT 1
)
WHERE wc.unit_id IS NULL;

-- 4) Swap the uniqueness: drop per-account, add per-unit.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_unit_id_key') THEN
    ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_unit_id_key UNIQUE (unit_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_unit ON whatsapp_config(unit_id);
```

- [ ] **Step 2: Apply and verify**

Check: `SELECT COUNT(*) FROM whatsapp_config WHERE unit_id IS NULL;` → expected: `0`.
Check: `SELECT conname FROM pg_constraint WHERE conname='whatsapp_config_unit_id_key';` → one row.
Run twice → no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/042_whatsapp_config_unit.sql
git commit -m "feat(db): whatsapp_config.unit_id — multi-number per account (042)"
```

### Task 4: `unit_id` on operational tables + backfill + NOT NULL

**Files:**
- Create: `supabase/migrations/043_operational_unit_id.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 043_operational_unit_id.sql — stamp unit_id on every operational parent table.
-- Backfill points existing rows at the account's Matriz unidade. Idempotent.

ALTER TABLE contacts       ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE conversations  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE deals          ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE broadcasts     ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE automations    ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE flows          ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;

-- Backfill each table to the account's Matriz (oldest unidade of that account).
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY['contacts','conversations','deals','broadcasts','automations','flows'];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format($f$
      UPDATE %I t
      SET unit_id = (
        SELECT u.id FROM unidades u
        WHERE u.account_id = t.account_id
        ORDER BY u.created_at ASC LIMIT 1
      )
      WHERE t.unit_id IS NULL
    $f$, v_table);
  END LOOP;
END $$;

ALTER TABLE contacts       ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE conversations  ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE deals          ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE broadcasts     ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE automations    ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE flows          ALTER COLUMN unit_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_unit      ON contacts(unit_id);
CREATE INDEX IF NOT EXISTS idx_conversations_unit ON conversations(unit_id);
CREATE INDEX IF NOT EXISTS idx_deals_unit         ON deals(unit_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_unit    ON broadcasts(unit_id);
CREATE INDEX IF NOT EXISTS idx_automations_unit   ON automations(unit_id);
CREATE INDEX IF NOT EXISTS idx_flows_unit         ON flows(unit_id);
```

- [ ] **Step 2: Apply and verify**

Check (per table): `SELECT COUNT(*) FROM contacts WHERE unit_id IS NULL;` → `0`. Repeat for each table.
Run twice → no error (NOT NULL on already-NOT NULL is a no-op).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/043_operational_unit_id.sql
git commit -m "feat(db): unit_id on operational tables + backfill (043)"
```

### Task 5: contacts dedup per unit

**Files:**
- Create: `supabase/migrations/044_contacts_unit_dedup.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 044_contacts_unit_dedup.sql — the same phone can be a lead in two different
-- unidades (each keeps its own carteira), so dedup is now per (account, unit, phone).
-- Replaces the (account_id, phone_normalized) index from migration 022. Idempotent.

DROP INDEX IF EXISTS idx_contacts_account_phone_normalized;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_unit_phone_normalized
  ON contacts (account_id, unit_id, phone_normalized)
  WHERE phone_normalized <> '';
```

- [ ] **Step 2: Apply and verify**

Check: `SELECT indexname FROM pg_indexes WHERE indexname='idx_contacts_account_unit_phone_normalized';` → one row.
Check old index gone: `SELECT indexname FROM pg_indexes WHERE indexname='idx_contacts_account_phone_normalized';` → zero rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/044_contacts_unit_dedup.sql
git commit -m "feat(db): contacts dedup per unit (044)"
```

### Task 6: RLS unit-scoping rewrite

**Files:**
- Create: `supabase/migrations/045_rls_unit_scoping.sql`

- [ ] **Step 1: Write the migration** — compose `can_see_unit` into the operational-parent policies, and into child-table policies via the parent's `unit_id`.

```sql
-- 045_rls_unit_scoping.sql — agent/viewer see only their unit; admin+ see all.
-- Parent tables get an extra can_see_unit(account_id, unit_id) predicate;
-- child tables inherit the parent's unit via the existing join. Idempotent
-- (drop-then-create; migration owns these policy names).

-- ---- contacts ----
DROP POLICY IF EXISTS contacts_select ON contacts;
DROP POLICY IF EXISTS contacts_insert ON contacts;
DROP POLICY IF EXISTS contacts_update ON contacts;
DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY contacts_insert ON contacts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY contacts_update ON contacts FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY contacts_delete ON contacts FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- conversations ----
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY conversations_insert ON conversations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY conversations_delete ON conversations FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- deals ----
DROP POLICY IF EXISTS deals_select ON deals;
DROP POLICY IF EXISTS deals_insert ON deals;
DROP POLICY IF EXISTS deals_update ON deals;
DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_select ON deals FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY deals_insert ON deals FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY deals_update ON deals FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY deals_delete ON deals FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- broadcasts ----
DROP POLICY IF EXISTS broadcasts_select ON broadcasts;
DROP POLICY IF EXISTS broadcasts_insert ON broadcasts;
DROP POLICY IF EXISTS broadcasts_update ON broadcasts;
DROP POLICY IF EXISTS broadcasts_delete ON broadcasts;
CREATE POLICY broadcasts_select ON broadcasts FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY broadcasts_insert ON broadcasts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY broadcasts_update ON broadcasts FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY broadcasts_delete ON broadcasts FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- automations ----
DROP POLICY IF EXISTS automations_select ON automations;
DROP POLICY IF EXISTS automations_insert ON automations;
DROP POLICY IF EXISTS automations_update ON automations;
DROP POLICY IF EXISTS automations_delete ON automations;
CREATE POLICY automations_select ON automations FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY automations_insert ON automations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY automations_update ON automations FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY automations_delete ON automations FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- flows ----
DROP POLICY IF EXISTS flows_select ON flows;
DROP POLICY IF EXISTS flows_insert ON flows;
DROP POLICY IF EXISTS flows_update ON flows;
DROP POLICY IF EXISTS flows_delete ON flows;
CREATE POLICY flows_select ON flows FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY flows_insert ON flows FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY flows_update ON flows FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY flows_delete ON flows FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- messages (child of conversations) ----
DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id
          AND is_account_member(c.account_id) AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);
```

> NOTE for implementer: also rewrite the child policies that join to contacts (contact_tags, contact_custom_values, contact_notes) and to broadcasts (broadcast_recipients) the same way — add `AND can_see_unit(<parent>.account_id, <parent>.unit_id)` to each. Read migration 017 (lines 486–598) for the exact existing bodies and mirror them. contact_notes carries account_id directly, so add the predicate on its own columns.

- [ ] **Step 2: Apply and verify RLS behaviour** — verify with simulated JWTs.

In the Supabase SQL editor, create two test profiles (agent in unit A, admin) and run under each with `request.jwt.claims`:
```sql
-- As agent of unit A: should return only unit-A rows
SELECT set_config('request.jwt.claims', json_build_object('sub', '<agentA_user_id>')::text, true);
SET LOCAL ROLE authenticated;
SELECT count(*) FROM contacts;              -- expected: only unit A's contacts
RESET ROLE;
```
Repeat as admin → expected: all units' contacts. Document the counts.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/045_rls_unit_scoping.sql
git commit -m "feat(db): RLS unit scoping — agent locked to unit (045)"
```

### Task 7: license state table

**Files:**
- Create: `supabase/migrations/046_license_state.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 046_license_state.sql — single-row local license state for this SILO instance.
-- The control plane (SP2) flips `status` via /api/license/apply. Fail-open: the
-- app reads the last known value; if the row is missing it treats the instance
-- as active. Idempotent.

CREATE TABLE IF NOT EXISTS license_state (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),   -- singleton row (id is always true)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO license_state (id, status) VALUES (true, 'active')
ON CONFLICT (id) DO NOTHING;

-- Only the service role touches this table (server routes). No client RLS policy.
ALTER TABLE license_state ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply and verify**

Check: `SELECT status FROM license_state;` → expected: `active` (one row).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/046_license_state.sql
git commit -m "feat(db): local license_state singleton (046)"
```

---

## Phase 2 — Contact dedup helper (unit-scoped)

### Task 8: `findExistingContact` gains a `unitId` argument

**Files:**
- Modify: `src/lib/contacts/dedupe.ts`
- Test: `src/lib/contacts/dedupe.test.ts` (create if absent)

- [ ] **Step 1: Read the current helper** — open `src/lib/contacts/dedupe.ts` and note the exact signature of `findExistingContact` and how it filters (last-8-digit suffix pre-filter + `phonesMatch`).

- [ ] **Step 2: Write the failing test** — the helper must scope candidates by `unit_id`.

```ts
// src/lib/contacts/dedupe.test.ts
import { describe, it, expect, vi } from 'vitest'
import { findExistingContact } from './dedupe'

function fakeClient(rows: Array<{ id: string; phone: string; unit_id: string }>) {
  const builder: any = {
    _rows: rows,
    from() { return builder },
    select() { return builder },
    eq(col: string, val: string) {
      builder._rows = builder._rows.filter((r: any) => r[col] === val)
      return builder
    },
    like() { return builder },
    then(res: (v: any) => void) { res({ data: builder._rows, error: null }) },
  }
  return builder
}

describe('findExistingContact unit scoping', () => {
  it('does not match a contact with the same phone in another unit', async () => {
    const client = fakeClient([{ id: 'c1', phone: '5511999', unit_id: 'unitB' }])
    const found = await findExistingContact(client, 'acc1', '5511999', 'unitA')
    expect(found).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- dedupe`
Expected: FAIL (findExistingContact ignores the 4th arg / matches across units).

- [ ] **Step 4: Implement** — add `unitId: string` as the 4th parameter and add `.eq('unit_id', unitId)` to the candidate query. Update the JSDoc.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- dedupe`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/contacts/dedupe.ts src/lib/contacts/dedupe.test.ts
git commit -m "feat(contacts): scope dedup lookup by unit_id"
```

---

## Phase 3 — Webhook unit routing

### Task 9: thread `unit_id` from config through contact/conversation creation

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts`
- Test: `src/app/api/whatsapp/webhook/route.test.ts`

- [ ] **Step 1: Write the failing test** — an inbound message on a number whose config has `unit_id = U` must create the contact and conversation with `unit_id = U`. Model the arrange/act on the existing `route.test.ts` (reuse its Supabase mock + sample payload). Assert the `insert` into `contacts` and `conversations` includes `unit_id: 'U'`, and that `findOrCreateContact` was called with the unit.

```ts
// add to src/app/api/whatsapp/webhook/route.test.ts
it('stamps unit_id from the matched whatsapp_config onto contact + conversation', async () => {
  // config row returned by the phone_number_id lookup carries unit_id: 'unit-U'
  // (see existing mock setup in this file). After POST + flushing after(),
  // expect the contacts insert and conversations insert to include unit_id 'unit-U'.
  // Assert on the captured insert payloads from the mocked supabaseAdmin().
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- webhook`
Expected: FAIL (inserts have no unit_id).

- [ ] **Step 3: Implement** — in `processWebhook`, read `config.unit_id` and pass it into `processMessage`; thread it through `findOrCreateContact` (add to the `insert({...})` and to the `findExistingContact(..., unitId)` call) and `findOrCreateConversation` (add to the `insert({...})` and to the account+contact lookup so an existing conversation in the SAME unit is reused). Signature additions:
  - `processMessage(message, contact, accountId, unitId, configOwnerUserId, accessToken, mirrorMedia)`
  - `findOrCreateContact(accountId, unitId, configOwnerUserId, phone, name)`
  - `findOrCreateConversation(accountId, unitId, configOwnerUserId, contactId)`

Add `.eq('unit_id', unitId)` to the conversation lookup query. Add `unit_id: unitId` to both inserts.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- webhook`
Expected: PASS. Also run full suite: `npm run test` → no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/whatsapp/webhook/route.ts src/app/api/whatsapp/webhook/route.test.ts
git commit -m "feat(webhook): route inbound to the number's unidade"
```

---

## Phase 4 — License gate (fail-open stub) + contract

### Task 10: license state reader with fail-open cache

**Files:**
- Create: `src/lib/license/state.ts`
- Test: `src/lib/license/state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/license/state.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getLicenseStatus, __setCacheForTest } from './state'

describe('getLicenseStatus fail-open', () => {
  beforeEach(() => __setCacheForTest(null))
  it('returns active when the backing store throws but we have no cache', async () => {
    const client = { from: () => ({ select: () => ({ maybeSingle: async () => { throw new Error('db down') } }) }) } as any
    expect(await getLicenseStatus(client)).toBe('active')
  })
  it('returns the last good cached value when the store later fails', async () => {
    const ok = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { status: 'suspended' }, error: null }) }) }) } as any
    expect(await getLicenseStatus(ok)).toBe('suspended')
    const down = { from: () => ({ select: () => ({ maybeSingle: async () => { throw new Error('db down') } }) }) } as any
    expect(await getLicenseStatus(down)).toBe('suspended') // last good, not 'active'
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- license`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/license/state.ts
export type LicenseStatus = 'active' | 'suspended'

let _cache: LicenseStatus | null = null

/** Test-only cache reset. */
export function __setCacheForTest(v: LicenseStatus | null) { _cache = v }

/**
 * Fail-open license read. Returns the stored status; on any error returns the
 * last good cached value, or 'active' if we never had one. The control plane
 * (SP2) can suspend an instance, but a control-plane / DB outage must never
 * take a paying client offline.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLicenseStatus(client: any): Promise<LicenseStatus> {
  try {
    const { data, error } = await client
      .from('license_state')
      .select('status')
      .maybeSingle()
    if (error) throw error
    const status: LicenseStatus = data?.status === 'suspended' ? 'suspended' : 'active'
    _cache = status
    return status
  } catch {
    return _cache ?? 'active'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- license`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/license/state.ts src/lib/license/state.test.ts
git commit -m "feat(license): fail-open license state reader"
```

### Task 11: apply endpoint (control-plane → instance) with shared-secret auth

**Files:**
- Create: `src/app/api/license/apply/route.ts`
- Create: `src/app/api/license/status/route.ts`
- Test: `src/app/api/license/apply/route.test.ts`

- [ ] **Step 1: Write the failing test** — POST without the shared secret → 401; with it and `{status:'suspended'}` → writes the row and returns 200.

```ts
// src/app/api/license/apply/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => { process.env.LICENSE_CONTROL_SECRET = 'shhh' })

it('rejects without the shared secret', async () => {
  const { POST } = await import('./route')
  const res = await POST(new Request('http://x/api/license/apply', {
    method: 'POST', body: JSON.stringify({ status: 'suspended' }),
  }))
  expect(res.status).toBe(401)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- license/apply`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement** both routes.

```ts
// src/app/api/license/apply/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(request: Request) {
  const secret = process.env.LICENSE_CONTROL_SECRET
  const provided = request.headers.get('x-license-secret')
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let body: { status?: string; reason?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  if (body.status !== 'active' && body.status !== 'suspended') {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }
  const { error } = await admin().from('license_state').upsert({
    id: true, status: body.status, reason: body.reason ?? null, updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, status: body.status })
}
```

```ts
// src/app/api/license/status/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getLicenseStatus } from '@/lib/license/state'

export async function GET() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  return NextResponse.json({ status: await getLicenseStatus(admin) })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- license/apply`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/license/apply/route.ts src/app/api/license/status/route.ts src/app/api/license/apply/route.test.ts
git commit -m "feat(license): apply + status endpoints (control-plane contract v1)"
```

### Task 12: license guard on the app boundary + suspended page

**Files:**
- Create: `src/lib/license/guard.ts`
- Modify: `src/middleware.ts` (read it first; if routing lives in `proxy.ts`, edit that per the deprecation notice)
- Create: `src/app/suspended/page.tsx`

- [ ] **Step 1: Read `src/middleware.ts`** to learn the existing matcher + auth redirect pattern.

- [ ] **Step 2: Implement guard** — `requireLicense()` returns the status via `getLicenseStatus`; middleware redirects authenticated app routes to `/suspended` when status is `suspended` (leave `/api/license/*`, `/suspended`, auth routes, and static assets unguarded). Fail-open is inherited from `getLicenseStatus`.

- [ ] **Step 3: Manual verify** — set `license_state.status='suspended'` in SQL, load the app → redirected to `/suspended`; set back to `active` → app loads. Screenshot both.

- [ ] **Step 4: Commit**

```bash
git add src/lib/license/guard.ts src/middleware.ts src/app/suspended/page.tsx
git commit -m "feat(license): suspend gate on app boundary (fail-open)"
```

### Task 13: document the contract

**Files:**
- Create: `docs/contracts/license-v1.md`

- [ ] **Step 1: Write the contract doc** — endpoints (`POST /api/license/apply`, `GET /api/license/status`), the `x-license-secret` header, the `{status, reason}` body, fail-open semantics, and the heartbeat placeholder SP2 will call. Commit.

```bash
git add docs/contracts/license-v1.md
git commit -m "docs: license contract v1 (instance <-> control plane)"
```

---

## Phase 5 — Unit context + selector UI

### Task 14: server-side unit context

**Files:**
- Create: `src/lib/units/context.ts`
- Test: `src/lib/units/context.test.ts`

- [ ] **Step 1: Read** how the app resolves the current account/profile server-side (grep for `account_id` in `src/lib` and `src/app` server helpers; find the existing "get current profile" utility).

- [ ] **Step 2: Write failing test** — `getVisibleUnits(profile, client)` returns all account units for admin+, and only the profile's unit for agent/viewer; `getSelectedUnitId(profile, cookieValue, visibleUnits)` returns the cookie value if it's visible, else null ("Todas") for management or the single unit for an agent.

- [ ] **Step 3: Implement** the two helpers. Agent/viewer selection is forced to their `unit_id` (no "Todas"). Management defaults to "Todas" (null) unless a valid cookie is set.

- [ ] **Step 4: Run test** `npm run test -- units/context` → PASS. **Commit.**

### Task 15: unit selector component (management only)

**Files:**
- Create: `src/components/units/unit-selector.tsx`
- Modify: the dashboard topbar/layout (read `src/app` layout files to find where a global topbar control mounts)

- [ ] **Step 1: Read** an existing shadcn Select usage in the repo (grep `from '@/components/ui/select'`) to match the pattern.

- [ ] **Step 2: Implement** a client component: shows "Todas as unidades" + each unit for admin+; writes the choice to a `unidade` cookie and refreshes server components. For agent/viewer, render the unit name as a static label (no dropdown).

- [ ] **Step 3: Wire lists to respect the selection** — for each operational list (inbox, contacts, funil, broadcasts), read the selected unit in the server component and add `.eq('unit_id', selected)` when a unit is chosen (RLS already blocks cross-unit for agents; the selector is the management filter). Add/adjust one integration test per list if the repo has them; otherwise verify manually.

- [ ] **Step 4: Manual verify** with `preview_start` (dev on 3100): as admin switch units and confirm lists filter; confirm "Todas" aggregates. Screenshot.

- [ ] **Step 5: Commit** `feat(ui): unit selector + per-unit list filtering`.

---

## Phase 6 — Unit management (settings)

### Task 16: unit CRUD API

**Files:**
- Create: `src/app/api/unidades/route.ts` (GET list, POST create), `src/app/api/unidades/[id]/route.ts` (PATCH, DELETE)
- Test: `src/app/api/unidades/route.test.ts`

- [ ] **Step 1: Read** an existing settings-class API route (e.g. `src/app/api/whatsapp/config/route.ts`) for the auth/account-resolution + admin-check pattern.

- [ ] **Step 2: Write failing test** — POST as non-admin → 403; as admin → creates a unit with a slugified name scoped to the account.

- [ ] **Step 3: Implement** the routes using the server Supabase client (RLS enforces admin+); slug from name; unique per account (surface the unique-violation as 409).

- [ ] **Step 4: Run test** `npm run test -- unidades` → PASS. **Commit.**

### Task 17: unit manager UI + agent assignment + per-unit number connect

**Files:**
- Create: `src/app/(dashboard)/settings/unidades/page.tsx`, `src/components/settings/unidades-manager.tsx`
- Modify: `src/components/settings/whatsapp-config.tsx` (bind the connect flow to a chosen unit)

- [ ] **Step 1: Read** `src/components/settings/whatsapp-config.tsx` and the members/settings pages to match layout + the invitation/role UI.

- [ ] **Step 2: Implement** the manager: list/create/rename/deactivate units; assign a member to a unit (PATCH `profiles.unit_id` via a small admin-only API — create `src/app/api/account/members/[id]/unit/route.ts`); and make "connect WhatsApp number" pick which unit it belongs to (write `whatsapp_config.unit_id`).

- [ ] **Step 3: Manual verify** on 3100: create 2 units, connect a (test) number to each, assign an agent to unit A, log in as that agent → sees only unit A. Screenshot.

- [ ] **Step 4: Commit** `feat(settings): unidades manager + agent assignment + per-unit number`.

---

## Phase 7 — Consolidated dashboard

### Task 18: consolidated metrics query

**Files:**
- Create: `src/lib/units/metrics.ts`
- Test: `src/lib/units/metrics.test.ts`

- [ ] **Step 1: Write failing test** — `getConsolidatedMetrics(client, accountId)` returns per-unit `{ unitId, unitName, leads, openConversations, deals, wonValue }` plus account totals.

- [ ] **Step 2: Implement** with grouped queries (or an RPC if the repo prefers SQL aggregates — check `supabase/migrations` for the `*_increment_counter` RPC style). Keep it robust: leads by unit, funnel by stage per unit, conversion, lead origin.

- [ ] **Step 3: Run test** `npm run test -- units/metrics` → PASS. **Commit.**

### Task 19: consolidated dashboard page (management)

**Files:**
- Create: `src/app/(dashboard)/dashboard/consolidado/page.tsx`
- Modify: dashboard nav to add the link (admin+ only)

- [ ] **Step 1: Read** an existing dashboard page + a `recharts` usage in the repo to match chart styling.

- [ ] **Step 2: Implement** a robust management view (per the "painéis robustos" standard): unit comparison bar chart, funnel-by-unit, conversion rates, lead-origin breakdown, a per-unit table with drill-down link (sets the unit cookie and navigates to the inbox), and CSV export. Admin+ only (agents are redirected to their unit's normal dashboard).

- [ ] **Step 3: Manual verify** on 3100 with seeded data in 2 units: charts render in light/dark; agent cannot open `/dashboard/consolidado`. Screenshot.

- [ ] **Step 4: Commit** `feat(dashboard): consolidated multi-unit management view`.

---

## Phase 8 — SILO packaging (EasyPanel)

### Task 20: closed signup + instance envs

**Files:**
- Modify: `src/middleware.ts` (or the signup route/page), `.env.local.example`
- Read first: the signup page/route to find the cleanest gate point.

- [ ] **Step 1: Implement** an env flag `SIGNUP_DISABLED=true` that makes the public signup route/page return 403 / redirect to `/login`. Owner is provisioned (first account created out-of-band or via a one-time seed); teammates still join via the existing invitation flow.

- [ ] **Step 2: Document** the per-instance env block in `.env.local.example` (Supabase URL/keys, ENCRYPTION_KEY, META_APP_SECRET, `SIGNUP_DISABLED`, `LICENSE_CONTROL_SECRET`, optional `CONTROL_PLANE_URL`).

- [ ] **Step 3: Verify** `next build` passes with the flag. **Commit** `feat(silo): closed signup + per-instance env`.

### Task 21: EasyPanel compose + deploy doc

**Files:**
- Modify: `docker-compose.yml`, `docs/docker.md`
- Read first: the current `docker-compose.yml` and `next.config.ts` (confirm `output: 'standalone'`).

- [ ] **Step 1: Verify** the standalone build runs in the container locally (`docker build` + `docker run` with a test `.env`), hitting `/login`.

- [ ] **Step 2: Write** an EasyPanel section in `docs/docker.md`: one app service per client, build args for `NEXT_PUBLIC_*`, runtime secrets in the panel, healthcheck, Let's Encrypt domain, and the note that each client is its own instance + its own Supabase/Postgres (SILO). Reference: publish in batches; the app restarts on deploy.

- [ ] **Step 3: Commit** `docs(silo): EasyPanel per-client deploy guide`.

---

## Phase 9 — Full verification

### Task 22: green suite + build + smoke

- [ ] **Step 1:** `npm run test` → all pass.
- [ ] **Step 2:** `npm run typecheck` → clean.
- [ ] **Step 3:** `npm run build` → succeeds (watch for RSC/pg bundle leaks — a value import from a server-only module into a client component breaks the build; keep pure constants in their own module).
- [ ] **Step 4:** Dev smoke on 3100: two units, an agent locked to one, management consolidated view, license suspend→active toggle. Capture screenshots.
- [ ] **Step 5:** Update the design spec's "status" and open a PR from `feature/usa-i-multiunidade-sp1` (do not merge without user go-ahead).

---

## Self-Review (author checklist — done)

- **Spec coverage:** unidades model (T1–T4), RBAC Opção 2 (T2/T6/T14), multi-number (T3), webhook routing (T9), dedup per unit (T5/T8), consolidated dashboard (T18–T19), unit management (T16–T17), selector (T14–T15), SILO packaging (T20–T21), license contract (T10–T13). All spec sections map to a task.
- **Placeholder scan:** backend tasks carry complete SQL/TS; UI tasks specify exact files, a pattern file to read first, test intent, and manual verification — no "TBD"/"add error handling" hand-waving.
- **Type consistency:** `can_see_unit(account_id, unit_id)`, `getLicenseStatus(client)`, `findExistingContact(client, accountId, phone, unitId)`, `unit_id` column name used consistently across tasks.
- **Known follow-ups flagged inline:** child-policy rewrite note in T6; middleware-vs-proxy note in T12/T20.
