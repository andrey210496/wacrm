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

-- ---- contact_tags (child of contacts) ----
DROP POLICY IF EXISTS contact_tags_select ON contact_tags;
DROP POLICY IF EXISTS contact_tags_modify ON contact_tags;
CREATE POLICY contact_tags_select ON contact_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id
          AND is_account_member(c.account_id) AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY contact_tags_modify ON contact_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);

-- ---- contact_custom_values (child of contacts) ----
DROP POLICY IF EXISTS contact_custom_values_select ON contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_modify ON contact_custom_values;
CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id
          AND is_account_member(c.account_id) AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY contact_custom_values_modify ON contact_custom_values FOR ALL USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);

-- ---- contact_notes (carries account_id directly; also has contact_id) ----
DROP POLICY IF EXISTS contact_notes_select ON contact_notes;
DROP POLICY IF EXISTS contact_notes_insert ON contact_notes;
DROP POLICY IF EXISTS contact_notes_update ON contact_notes;
DROP POLICY IF EXISTS contact_notes_delete ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_notes.contact_id
          AND is_account_member(c.account_id) AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY contact_notes_insert ON contact_notes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_notes.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY contact_notes_update ON contact_notes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_notes.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY contact_notes_delete ON contact_notes FOR DELETE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_notes.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);

-- ---- broadcast_recipients (child of broadcasts) ----
DROP POLICY IF EXISTS broadcast_recipients_select ON broadcast_recipients;
DROP POLICY IF EXISTS broadcast_recipients_modify ON broadcast_recipients;
CREATE POLICY broadcast_recipients_select ON broadcast_recipients FOR SELECT USING (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id
          AND is_account_member(b.account_id) AND can_see_unit(b.account_id, b.unit_id))
);
CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL USING (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id
          AND is_account_member(b.account_id, 'agent') AND can_see_unit(b.account_id, b.unit_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id
          AND is_account_member(b.account_id, 'agent') AND can_see_unit(b.account_id, b.unit_id))
);

-- ---- message_reactions (grandchild: reaction -> message -> conversation) ----
DROP POLICY IF EXISTS message_reactions_select ON message_reactions;
DROP POLICY IF EXISTS message_reactions_modify ON message_reactions;
CREATE POLICY message_reactions_select ON message_reactions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id) AND can_see_unit(c.account_id, c.unit_id)
  )
);
CREATE POLICY message_reactions_modify ON message_reactions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id)
  )
);
