import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getMediaUrl } from '@/lib/whatsapp/meta-api'
import { mirrorInboundMedia } from '@/lib/whatsapp/mirror-inbound-media'
import { recordDeadLetter } from '@/lib/whatsapp/deadletter'
import { findExistingContact, findContactByBsuid, isUniqueViolation } from '@/lib/contacts/dedupe'
import { resolveInboundIdentity, type InboundIdentity } from '@/lib/contacts/identity'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { maybeConfirmAppointment } from '@/lib/scheduling/confirm-inbound'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook'
import {
  parseMessageEchoes,
  parseMessageEdits,
  parseHistory,
  parseAppStateSync,
  type NormalizedEdit,
} from '@/lib/whatsapp/coex-webhooks'
import { resolveCoexMediaUrl } from '@/lib/whatsapp/coex-media'

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
export function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

interface WhatsAppMessage {
  id: string
  // `from` (telefone) some quando o usuário escondeu o número (username). O
  // BSUID vem em `from_user_id` — SEMPRE presente (migration 050 / Meta 2026).
  from?: string
  from_user_id?: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  /**
   * Set when the customer taps a button or list row on an interactive
   * message we sent. `button_reply.id` / `list_reply.id` is whatever id
   * we put on the button/row when sending — the Flows engine uses this
   * to advance the per-contact run.
   */
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  /**
   * Set when the customer taps a QUICK_REPLY button on a *template*
   * message — a broadcast, or any template send. Meta uses a different
   * envelope from `interactive` above: `type: 'button'`, the label in
   * `button.text`, and the payload configured on the template's button
   * in `button.payload` (Meta's own template editor doesn't ask for a
   * payload and mirrors the label into it).
   */
  button?: { text?: string; payload?: string }
  /** Present when the customer swipe-replies to one of our messages. */
  context?: { id: string }
  /**
   * Presente quando a conversa começou por um anúncio Click-to-WhatsApp
   * (Feature C). Abre a janela grátis de 72h e marca a origem do lead.
   */
  referral?: {
    source_url?: string
    source_type?: string
    source_id?: string
    headline?: string
    body?: string
    ctwa_clid?: string
  }
}

export interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        // wa_id (telefone) só quando disponível; user_id (BSUID) sempre;
        // username quando o usuário ativou (migration 050 / Meta 2026).
        wa_id?: string
        user_id?: string
        username?: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id?: string
        recipient_user_id?: string
        pricing?: {
          billable?: boolean
          pricing_model?: string
          category?: string
          type?: string
        }
      }>
    }
    field: string
  }>
}

export async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      // Template-lifecycle events (status / quality / components
      // updates from Meta) come in on a different change.field and
      // have a different value shape — route them through the
      // dedicated handler. Skip the messaging branches below so we
      // don't try to read message-shaped fields off a template event.
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange(
          { field: change.field, value: change.value as unknown },
          supabaseAdmin(),
        )
        continue
      }

      // Coexistence (Fase 2): mensagens do app WhatsApp Business + histórico +
      // contatos. Chegam com change.field próprio e value de forma diferente —
      // handlers dedicados, cada um resolve o config por phone_number_id.
      if (change.field === 'smb_message_echoes') {
        await handleMessageEchoes(change.value as unknown)
        continue
      }
      if (change.field === 'history') {
        await handleHistory(change.value as unknown)
        continue
      }
      if (change.field === 'smb_app_state_sync') {
        await handleAppStateSync(change.value as unknown)
        continue
      }

      const value = change.value

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      // Handle incoming messages
      if (!value.messages) continue // sem mensagens = evento não-inbound (status já tratado)
      if (!value.contacts) {
        // Tem mensagem mas sem bloco de contato — hoje é o caso BSUID/username
        // (inbound sem telefone). Em vez de descartar de vez, grava na
        // dead-letter (a Feature B trata esses; até lá, nada se perde).
        await recordDeadLetter(supabaseAdmin(), {
          phoneNumberId: value.metadata?.phone_number_id,
          value,
          reason: 'no_contacts',
        })
        continue
      }

      const phoneNumberId = value.metadata.phone_number_id

      // Find user's config by phone_number_id. `.single()` returns
      // PGRST116 for both 0 rows AND ≥2 rows — distinguish them so
      // operators see the real cause in logs. ≥2 rows shouldn't happen
      // post-migration 013 (UNIQUE constraint), but a row created
      // before the constraint, or a race, would still surface here.
      const { data: configRows, error: configError } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('*')
        .eq('phone_number_id', phoneNumberId)

      if (configError) {
        console.error(
          'Error fetching whatsapp_config for phone_number_id:',
          phoneNumberId,
          configError
        )
        // Erro TRANSITÓRIO de banco — o worker de retry reprocessa (não perde).
        await recordDeadLetter(supabaseAdmin(), {
          phoneNumberId,
          value,
          reason: 'db_error',
          lastError: configError.message,
        })
        continue
      }

      if (!configRows || configRows.length === 0) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        // Número roteado pra esta instância mas SEM config (provisão quebrada).
        // Guarda pra alerta + reprocesso quando o config existir.
        await recordDeadLetter(supabaseAdmin(), {
          phoneNumberId,
          value,
          reason: 'no_config',
        })
        continue
      }

      if (configRows.length > 1) {
        console.error(
          `Multiple configs (${configRows.length}) found for phone_number_id:`,
          phoneNumberId,
          '— inbound message dropped. Resolve duplicates so each number maps to a single account.',
          'Account owners:',
          configRows.map((r: { account_id: string; user_id: string }) => `${r.account_id} (admin ${r.user_id})`)
        )
        await recordDeadLetter(supabaseAdmin(), {
          phoneNumberId,
          value,
          reason: 'multiple_configs',
        })
        continue
      }

      const config = configRows[0]

      const decryptedAccessToken = decrypt(config.access_token)

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          // Tenancy — drives every contact / conversation lookup
          // and the engines' active-row dispatch.
          config.account_id,
          // Unit tenancy — the number that received this message owns
          // one unit (whatsapp_config.unit_id, migration 042). Every
          // contact / conversation created downstream is stamped with
          // it so it lands in the right unit's lead pool.
          config.unit_id,
          // Audit / sender-of-record — used as the user_id on row
          // inserts that need it for NOT NULL FK compliance. Always
          // the admin who saved the WhatsApp config.
          config.user_id,
          decryptedAccessToken,
          // Default ON: the column is NOT NULL DEFAULT TRUE, but a row
          // read before migration 039 lands would have it undefined,
          // and losing attachments is the failure mode worth avoiding.
          config.mirror_inbound_media !== false
        )
      }
    }
  }
}

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

/**
 * Can a recipient transition from `current` to `incoming`?
 *   - Along the ladder, only forward moves are allowed.
 *   - `failed` is accepted only from `pending` or `sent`; it's refused
 *     once the recipient has reached any of the success states.
 */
function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false // failed is terminal
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false // unknown incoming status
  if (ci < 0) return true // unknown current — accept anything on the ladder
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id?: string
  recipient_user_id?: string
  // pricing (Feature C): a Meta manda a categoria + se é cobrável no status.
  // É a FONTE DA VERDADE do que é cobrado (dentro/fora da janela, FEP 72h etc.).
  pricing?: {
    billable?: boolean
    pricing_model?: string
    category?: string
    type?: string
  }
}) {
  // 1) Mirror onto messages (legacy behavior) — Meta's status values
  //    already match the CHECK constraint on messages.status. No
  //    `.select()`: message_id is NOT unique (migration 009 — Meta ids
  //    repeat across numbers), so this updates 0..N rows and must not
  //    assume a single row.
  const msgUpdate: Record<string, unknown> = { status: status.status }
  // Grava o pricing quando presente (Feature C: base do painel de consumo).
  if (status.pricing) {
    if (typeof status.pricing.category === 'string')
      msgUpdate.pricing_category = status.pricing.category
    if (typeof status.pricing.billable === 'boolean')
      msgUpdate.pricing_billable = status.pricing.billable
    if (typeof status.pricing.pricing_model === 'string')
      msgUpdate.pricing_model = status.pricing.pricing_model
    if (typeof status.pricing.type === 'string')
      msgUpdate.pricing_type = status.pricing.type
  }
  const { error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update(msgUpdate)
    .eq('message_id', status.id)

  if (msgErr) {
    console.error('Error updating message status:', msgErr)
  }

  // Webhook fan-out for this status change happens at the END of this
  // handler (after the broadcast mirror below), so a slow subscriber
  // endpoint can't delay the broadcast_recipients update.

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (added in migration 003). The aggregate trigger on
  //    broadcast_recipients re-derives the parent broadcast's
  //    sent/delivered/read/failed counts automatically.
  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString()

  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle()

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr)
  } else if (
    recipient &&
    // Guard transitions — forward-only on the success ladder, and
    // `failed` only from pre-delivered states.
    isValidStatusTransition(recipient.status, status.status)
  ) {
    const update: Record<string, unknown> = { status: status.status }
    if (status.status === 'sent' && !('sent_at' in update)) update.sent_at = tsIso
    if (status.status === 'delivered') update.delivered_at = tsIso
    if (status.status === 'read') update.read_at = tsIso

    const { error: recUpdateErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id)

    if (recUpdateErr) {
      console.error('Error updating broadcast recipient status:', recUpdateErr)
    }
  }

  // 3) Webhook fan-out for messages we store (inbox / API sends).
  //    Runs last so a slow subscriber can't delay the mirrors above.
  //    Bounded to one row (message_id isn't unique) purely to resolve
  //    the owning account for delivery.
  const { data: msgRow } = await supabaseAdmin()
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', status.id)
    .limit(1)
    .maybeSingle()

  if (msgRow) {
    const conv = msgRow.conversations as { account_id: string } | null
    const accountId = conv?.account_id
    if (accountId) {
      await dispatchWebhookEvent(
        supabaseAdmin(),
        accountId,
        'message.status_updated',
        {
          whatsapp_message_id: status.id,
          conversation_id: msgRow.conversation_id,
          status: status.status,
        }
      )
    }
  }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast.
 *
 * Runs on a best-effort basis — failures here must not break the
 * main inbound-message flow, so errors are swallowed with a log.
 */
async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    // Most recent outbound broadcast in this account that hasn't
    // been replied to yet. Account-scoped so a shared inbox reply
    // marks the broadcast as replied regardless of which teammate
    // sent it.
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)

    if (updErr) {
      console.error('Error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

/**
 * Resolve a Meta-side message_id into the matching internal UUID, scoped
 * to one conversation. Returns null when we never received the parent
 * (e.g. a swipe-reply to a message older than this CRM install).
 */
async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

/**
 * Persist an inbound reaction. WhatsApp reactions are not new messages —
 * they're per-(target, actor) state. We upsert / delete on
 * `message_reactions`, never write a row into `messages`.
 *
 * Best-effort: a missing parent (we never received it) is logged and
 * skipped so the webhook still acks 200 to Meta.
 */
async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    )
    return
  }

  // Empty emoji = removal (per Meta's Cloud API spec).
  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    if (delError) {
      console.error('[webhook] reaction delete failed:', delError.message)
    }
    return
  }

  const { error: upsertError } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    )
  if (upsertError) {
    console.error('[webhook] reaction upsert failed:', upsertError.message)
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: {
    profile: { name: string }
    wa_id?: string
    user_id?: string
    username?: string
  },
  // Tenancy. Resolved from the matched whatsapp_config row; every
  // contact / conversation / message row created downstream is
  // stamped with this so any member of the account can see it.
  accountId: string,
  // Unit tenancy — the unit that owns the receiving WhatsApp number
  // (whatsapp_config.unit_id). Stamped on every contact / conversation
  // created here so the lead lands in the right unit's pool, and used
  // to scope the find-or-create lookups (dedup is now per
  // (account, unit, phone) — migration 044).
  unitId: string,
  // Sender-of-record for inserts that need a NOT NULL user_id FK
  // (contacts, conversations). Always the admin who saved the
  // WhatsApp config; the choice is arbitrary post-017 but stable.
  configOwnerUserId: string,
  accessToken: string,
  // Per-account opt-out for the inbound-media mirror (migration 039).
  // See parseMessageContent for what it turns off.
  mirrorMedia: boolean
) {
  // Identidade: telefone se houver, senão o BSUID (username). O BSUID é sempre
  // guardado para religar o mesmo usuário quando o telefone aparecer depois.
  const identity = resolveInboundIdentity(contact, message)

  // Find or create contact (por telefone OU bsuid, com merge)
  const contactOutcome = await findOrCreateContact(
    accountId,
    unitId,
    configOwnerUserId,
    identity
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // Find or create conversation
  const convResult = await findOrCreateConversation(
    accountId,
    unitId,
    configOwnerUserId,
    contactRecord.id
  )
  if (!convResult) return
  const conversation = convResult.conversation

  // Emit conversation.created as soon as the thread is opened — BEFORE
  // the reaction short-circuit below — so a conversation first opened by
  // a reaction still fires the event, and a subscriber always sees the
  // thread open before its first message.received.
  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  // Feature C: refresca a janela de atendimento de 24h (todo inbound do cliente)
  // e, quando a conversa vem de um anúncio Click-to-WhatsApp, grava o referral
  // (origem do lead + base da janela grátis de 72h). BEST-EFFORT: envolto em
  // try/catch para NUNCA bloquear a persistência da mensagem — se essa
  // atualização falhar, a mensagem ainda é gravada e o inbound não se perde.
  try {
    const convPatch: Record<string, unknown> = {
      last_inbound_at: new Date().toISOString(),
    }
    if (message.referral) {
      convPatch.referral = message.referral
      convPatch.referral_at = new Date().toISOString()
    }
    const { error: convPatchErr } = await supabaseAdmin()
      .from('conversations')
      .update(convPatch)
      .eq('id', conversation.id)
    if (convPatchErr) {
      console.error('[webhook] update janela/referral falhou (não-fatal):', convPatchErr.message)
    }
  } catch (err) {
    console.error('[webhook] update janela/referral lançou (não-fatal):', err)
  }

  // Reactions short-circuit here — they aren't messages. We never insert
  // into `messages`, never bump unread_count, never update last_message_text.
  // Done before parseMessageContent so the media-URL fetch is skipped.
  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  // Parse message content based on type
  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(
      message,
      accessToken,
      mirrorMedia ? { accountId } : null
    )

  // Resolve swipe-reply context if present. A missing parent is fine —
  // we just store NULL and the UI renders the message without a quote.
  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )
    if (!replyToInternalId) {
      console.warn(
        '[webhook] reply context parent not found:',
        message.context.id
      )
    }
  }

  // Insert message — field names MUST match the messages table schema
  // (see supabase/migrations/001_initial_schema.sql):
  //   conversation_id, sender_type, content_type, content_text,
  //   media_url, media_type, template_name, message_id, status,
  //   created_at

  // The messages.content_type CHECK constraint (widened in migration 010
  // to add 'interactive' for button/list taps) allows:
  //   text, image, document, audio, video, location, template, interactive
  // Map incoming WhatsApp types that aren't in that list to the closest
  // allowed value so the INSERT doesn't fail with a constraint error.
  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'         // stickers are images
      : message.type === 'button'
        ? 'interactive' // template quick-reply tap (issue #478)
        : 'text'        // reaction, unknown → text fallback

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate. Covers the case where
  // the contact row already exists (manual add / CSV import) but they've
  // never messaged us before — which new_contact_created wouldn't catch.
  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  // Idempotent insert. Meta retries webhook deliveries (a slow ack, a
  // transient 5xx), and each retry replays the exact same message.id. The
  // unique index on (conversation_id, message_id) added in migration 037
  // makes a replay conflict; `ignoreDuplicates` turns that into an ON
  // CONFLICT DO NOTHING, and the `.select()` then returns the inserted row
  // ONLY on a genuine first insert — an empty result means this delivery
  // was a replay. This is the single idempotency boundary that must sit
  // BEFORE the unread bump and all downstream fan-out below (issue #367).
  const { data: insertedRows, error: msgError } = await supabaseAdmin()
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        // Meta's MIME type for the attachment (migration 039). Was
        // discarded before, which forced the download path to guess an
        // extension from the fetched blob — impossible to do until the
        // bytes had already been fetched successfully.
        media_type: mediaType,
        message_id: message.id,
        status: 'delivered',
        created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
        reply_to_message_id: replyToInternalId,
        // Only populated for content_type='interactive'. Migration 010 added
        // the column; null for every other content_type so existing inserts
        // behave identically.
        interactive_reply_id: interactiveReplyId,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
    )
    .select('id')

  if (msgError) {
    console.error('Error inserting message:', msgError)
    return
  }

  // Replayed delivery: the message already exists, so acknowledge it as a
  // no-op. Returning here is what keeps a retry from double-bumping unread,
  // re-advancing flows, re-firing automations, re-invoking AI handling, and
  // re-dispatching public webhooks (issue #367).
  if (!insertedRows || insertedRows.length === 0) {
    console.info(
      '[webhook] duplicate inbound message ignored (idempotent replay):',
      message.id
    )
    return
  }

  // Update conversation. The unread bump is done DB-side (migration 037's
  // bump_conversation_on_inbound) rather than as a read-modify-write of the
  // snapshot loaded above: two inbound messages for the same conversation
  // can process concurrently, and computing `snapshot + 1` in the app let
  // both reads see the same value and write the same increment, losing one
  // (issue #369). The RPC increments in a single UPDATE and refreshes the
  // last-message summary in the same statement.
  const { error: convError } = await supabaseAdmin().rpc(
    'bump_conversation_on_inbound',
    {
      p_conversation_id: conversation.id,
      p_last_message_text: contentText || `[${message.type}]`,
    }
  )

  if (convError) {
    console.error('Error updating conversation:', convError)
  }

  // A customer writing again re-opens the thread (issue #409). Kept as a
  // separate conditional statement rather than a `status` field on the
  // update above so the write can be gated on the row's CURRENT status in
  // SQL — see the helper for why that matters.
  await reopenClosedConversation(supabaseAdmin(), conversation)

  // If this contact was a recent broadcast recipient, flag the reply
  // so the broadcast's `replied_count` advances (via the aggregate
  // trigger installed in migration 003).
  await flagBroadcastReplyIfAny(accountId, contactRecord.id)

  // ============================================================
  // Flow runner dispatch.
  //
  // If the runner consumes the message (it either advanced an active
  // run or started a new one), we suppress the `new_message_received`
  // + `keyword_match` automation triggers for this inbound. Customer
  // is navigating the bot menu, not sending a fresh trigger word
  // that should fork into automations.
  //
  // The relationship-level triggers (`new_contact_created`,
  // `first_inbound_message`) still fire even when consumed — those
  // are about WHO is messaging, not what they said.
  //
  // Awaited (not fire-and-forget) because we need the `consumed`
  // result before deciding whether to dispatch automations. The
  // runner has its own try/catch and never throws. Accounts with
  // no active flows take the runner's early-exit "no_match" path
  // basically for free (one indexed SELECT for the active run).
  // ============================================================
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message:
      interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: message.id,
          }
        : {
            kind: 'text',
            text: contentText ?? message.text?.body ?? '',
            meta_message_id: message.id,
          },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  // Fire any automations that react to this webhook event. All dispatches
  // run here (not earlier) so the contact, conversation, and inbound
  // message all exist before any step — including send_message — runs.
  // Fire-and-forget: a slow or failing automation must not block the
  // webhook's 200 OK response to Meta.
  const inboundText = contentText ?? message.text?.body ?? ''

  // Confirmação de agendamento por palavra-chave (Fase B). Best-effort.
  await maybeConfirmAppointment({
    unitId: conversation.unit_id,
    contactId: contactRecord.id,
    text: inboundText,
  })

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = []
  // Content-level triggers are suppressed when a flow consumed the
  // message — see the comment block above.
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
    // Interactive tap → fire the interactive_reply trigger too (only
    // meaningful when a button/list reply actually arrived). Enables
    // automation-only chained menus; when a Flow owns the menu it will
    // have consumed the reply and this is skipped.
    if (interactiveReplyId) {
      automationTriggers.push('interactive_reply')
    }
  }
  // new_contact_created fires only when the webhook just auto-created the
  // contact row. first_inbound_message fires whenever this is the contact's
  // first-ever customer-sent message — a superset that also catches
  // manually-imported contacts sending for the first time. We dispatch both
  // so users can pick whichever semantic they want; an automation that
  // listens to only one trigger runs only when that trigger matches.
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  // Awaited — not fire-and-forget. We're inside the route's `after()`
  // block, which only keeps the function alive for promises it can see, so
  // a detached dispatch can be frozen part-way through: the log row is
  // inserted, then the steps never run. That is issue #301's failure mode
  // recurring one level down, and it's what issue #409 reported as runs
  // logging zero steps. `runAutomationsForTrigger` owns its own try/catch
  // and never throws; the `.catch` is belt-and-braces so one trigger
  // type's failure can't skip the rest of the loop.
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        // Only set on interactive taps; drives the interactive_reply
        // trigger's exact-id match.
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  // AI auto-reply. Runs only for plain-text inbound the deterministic
  // flow runner did NOT consume (flows win over the LLM), and only when
  // the account has enabled it. Awaited inside `after()` (same reason as
  // the webhook dispatch below); `dispatchInboundToAiReply` owns its
  // eligibility gates + try/catch and never throws.
  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
    })
  }

  // message.received webhook (public API). Awaited — not fire-and-forget
  // — because we're inside the route's `after()` block, which only keeps
  // the function alive for promises it can see; a detached promise could
  // be frozen before it delivers. `dispatchWebhookEvent` early-exits
  // when the account has no matching endpoint and never throws.
  // (conversation.created is emitted earlier, right after the thread is
  // opened.)
  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: message.id,
    content_type: contentType,
    text: contentText,
  })
}

/**
 * Ingestão de inbound JÁ NORMALIZADO, roteado por UNIDADE (não por
 * phone_number_id). Usado pelo canal uazapi, cuja mensagem não tem
 * phone_number_id — a unidade vem do webhook. Reusa os MESMOS helpers do caminho
 * oficial (findOrCreateContact/Conversation, bump de unread, reopen, flows,
 * automações, IA, webhook público), então a mensagem cai no inbox e dispara tudo
 * igual. NÃO toca no `processMessage` oficial (o fluxo Meta segue idêntico).
 *
 * Mídia: a uazapi entrega URL direta (`mediaUrl`) — não há fetch da Meta aqui.
 */
export async function ingestNormalizedInbound(params: {
  accountId: string
  unitId: string
  configOwnerUserId: string
  identity: InboundIdentity
  content: {
    type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'unknown'
    text: string
    mediaUrl: string | null
  }
  messageId: string
  timestamp: number | null
}): Promise<void> {
  const { accountId, unitId, configOwnerUserId, identity, content, messageId } = params

  if (!identity.phone && !identity.bsuid) {
    console.error('[uazapi] inbound sem telefone e sem identidade — ignorado')
    return
  }

  const contactOutcome = await findOrCreateContact(
    accountId,
    unitId,
    configOwnerUserId,
    identity,
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(
    accountId,
    unitId,
    configOwnerUserId,
    contactRecord.id,
  )
  if (!convResult) return
  const conversation = convResult.conversation
  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  // Janela de 24h (Feature C) — best-effort, nunca bloqueia.
  try {
    await supabaseAdmin()
      .from('conversations')
      .update({ last_inbound_at: new Date().toISOString() })
      .eq('id', conversation.id)
  } catch (err) {
    console.error('[uazapi] update janela falhou (não-fatal):', err)
  }

  const ALLOWED = new Set(['text', 'image', 'document', 'audio', 'video'])
  const contentType = ALLOWED.has(content.type) ? content.type : 'text'

  const { count: prior } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (prior ?? 0) === 0

  const createdAt =
    params.timestamp && params.timestamp > 0
      ? new Date(params.timestamp * 1000).toISOString()
      : new Date().toISOString()

  // Idempotente por (conversation_id, message_id) — igual ao oficial.
  const { data: inserted, error: msgError } = await supabaseAdmin()
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: content.text,
        media_url: content.mediaUrl,
        media_type: null,
        message_id: messageId,
        status: 'delivered',
        created_at: createdAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id')

  if (msgError) {
    console.error('[uazapi] erro ao inserir mensagem:', msgError)
    return
  }
  if (!inserted || inserted.length === 0) {
    // Replay idempotente — não re-dispara nada.
    return
  }

  const { error: convErr } = await supabaseAdmin().rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: content.text || `[${content.type}]`,
  })
  if (convErr) console.error('[uazapi] erro ao atualizar conversa:', convErr)

  await reopenClosedConversation(supabaseAdmin(), conversation)

  const inboundText = content.text ?? ''

  // Confirmação de agendamento por palavra-chave (Fase B). Best-effort.
  await maybeConfirmAppointment({
    unitId: conversation.unit_id,
    contactId: contactRecord.id,
    text: inboundText,
  })

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: { kind: 'text', text: inboundText, meta_message_id: messageId },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const triggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowConsumed) triggers.push('new_message_received', 'keyword_match')
  if (contactOutcome.wasCreated) triggers.unshift('new_contact_created')
  if (isFirstInboundMessage) triggers.unshift('first_inbound_message')
  for (const triggerType of triggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: { message_text: inboundText, conversation_id: conversation.id },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  if (!flowConsumed && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
    })
  }

  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: messageId,
    content_type: contentType,
    text: content.text,
  })
}

// ============================================================
// Coexistence (Fase 2) — ingestão de echoes / history / contatos.
//
// Handlers best-effort: um item ruim não derruba o webhook (a Meta precisa do
// 200). Insert idempotente por (conversation_id, message_id) cobre re-entrega +
// chunks de history. NADA de automação/fluxo/IA/webhook público nem bump de
// não-lida — é backfill / espelho, não inbound fresco. Mídia NÃO é reprocessada:
// gravamos como texto (legenda/rótulo), pois a mídia antiga pode ter expirado.
// ============================================================

/** Resolve o whatsapp_config (conta/unidade/dono) por phone_number_id. */
async function resolveCoexConfig(
  phoneNumberId: string | undefined,
): Promise<{
  account_id: string
  unit_id: string
  user_id: string
  access_token: string
  mirror_inbound_media: boolean | null
} | null> {
  if (!phoneNumberId) return null
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id, unit_id, user_id, access_token, mirror_inbound_media')
    .eq('phone_number_id', phoneNumberId)
    .limit(1)
    .maybeSingle()
  if (error || !data) {
    if (error) console.error('[coex] config lookup falhou:', error.message)
    return null
  }
  return data
}

/** Insere uma mensagem coex (idempotente) e devolve true se foi novidade. */
async function insertCoexMessage(params: {
  conversationId: string
  senderType: 'agent' | 'customer'
  contentText: string | null
  metaId: string
  status: string
  viaBusinessApp: boolean
  timestamp: number | null
  /** Tipo do conteúdo; default 'text'. Mídia resolvida passa 'image'/'video'/… */
  contentType?: string
  /** URL da mídia espelhada (bucket durável) ou proxy; null = sem mídia. */
  mediaUrl?: string | null
  mediaType?: string | null
}): Promise<boolean> {
  const createdAt =
    params.timestamp && params.timestamp > 0
      ? new Date(params.timestamp * 1000).toISOString()
      : new Date().toISOString()
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .upsert(
      {
        conversation_id: params.conversationId,
        sender_type: params.senderType,
        content_type: params.contentType ?? 'text',
        content_text: params.contentText,
        media_url: params.mediaUrl ?? null,
        media_type: params.mediaType ?? null,
        message_id: params.metaId,
        status: params.status,
        via_business_app: params.viaBusinessApp,
        created_at: createdAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id')
  if (error) {
    console.error('[coex] insert de mensagem falhou:', error.message)
    return false
  }
  return Boolean(data && data.length > 0)
}

/** Atualiza o resumo da conversa (sem bump de não-lida). Best-effort. */
async function touchConversationSummary(conversationId: string, text: string | null, timestamp: number | null) {
  const at =
    timestamp && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString()
  await supabaseAdmin()
    .from('conversations')
    .update({ last_message_text: text || '[mídia]', last_message_at: at, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
}

/**
 * Resolve os campos de mídia de uma mensagem coex para o insert. Quando há
 * `mediaId`, baixa+espelha (reusa o caminho oficial) e devolve content_type
 * real + media_url + legenda. Se não há mídia OU a resolução falha, cai no
 * marcador atual (content_type text, sem media_url) — sem regressão.
 */
async function coexMediaFields(
  config: {
    account_id: string
    access_token: string
    mirror_inbound_media: boolean | null
  },
  m: {
    contentType: string
    contentText: string | null
    mediaId: string | null
    mediaMime: string | null
    mediaFilename: string | null
    mediaCaption: string | null
    timestamp: number | null
  },
): Promise<{
  contentType: string
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
}> {
  if (!m.mediaId) {
    return { contentType: 'text', contentText: m.contentText, mediaUrl: null, mediaType: null }
  }
  const mediaUrl = await resolveCoexMediaUrl({
    mediaId: m.mediaId,
    accessToken: decrypt(config.access_token),
    accountId: config.mirror_inbound_media === false ? null : config.account_id,
    storage: supabaseAdmin().storage,
    fileName: m.mediaFilename,
    messageTimestamp: m.timestamp,
  })
  if (!mediaUrl) {
    // Falha best-effort → mantém o marcador (usuário ainda vê o tipo).
    return { contentType: 'text', contentText: m.contentText, mediaUrl: null, mediaType: null }
  }
  return {
    // contentType já vem mapeado (sticker→image) por coexContentType.
    contentType: m.contentType,
    // Legenda REAL da mídia (null quando não há) — a bolha renderiza a mídia.
    contentText: m.mediaCaption,
    mediaUrl,
    mediaType: m.mediaMime,
  }
}

/**
 * Aplica uma edição: atualiza a mensagem ORIGINAL (por message_id na conversa)
 * com o conteúdo novo. Se a original não existe no nosso banco (não recebida),
 * insere o conteúdo editado (keyed pelo id do echo de edição) pra não perder.
 */
async function applyCoexEdit(
  config: {
    account_id: string
    access_token: string
    mirror_inbound_media: boolean | null
  },
  conversationId: string,
  ed: NormalizedEdit,
): Promise<void> {
  const mf = await coexMediaFields(config, ed)
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .update({
      content_type: mf.contentType,
      content_text: mf.contentText,
      media_url: mf.mediaUrl,
      media_type: mf.mediaType,
    })
    .eq('conversation_id', conversationId)
    .eq('message_id', ed.originalMessageId)
    .select('id')
  if (error) {
    console.error('[coex] update de edição falhou:', error.message)
    return
  }
  if (data && data.length > 0) return // original atualizada com o conteúdo novo
  // Original desconhecida → insere o conteúdo editado (não perde a mensagem).
  await insertCoexMessage({
    conversationId,
    senderType: 'agent',
    contentText: mf.contentText,
    metaId: ed.editId,
    status: 'sent',
    viaBusinessApp: true,
    timestamp: ed.timestamp,
    contentType: mf.contentType,
    mediaUrl: mf.mediaUrl,
    mediaType: mf.mediaType,
  })
}

async function handleMessageEchoes(value: unknown): Promise<void> {
  const v = value as { metadata?: { phone_number_id?: string } }
  const config = await resolveCoexConfig(v.metadata?.phone_number_id)
  if (!config) return
  const echoes = parseMessageEchoes(value)
  for (const e of echoes) {
    const contactOutcome = await findOrCreateContact(config.account_id, config.unit_id, config.user_id, {
      phone: e.contactPhone,
      bsuid: null,
      username: null,
      name: '',
    })
    if (!contactOutcome) continue
    const convResult = await findOrCreateConversation(config.account_id, config.unit_id, config.user_id, contactOutcome.contact.id)
    if (!convResult) continue
    const mf = await coexMediaFields(config, e)
    const inserted = await insertCoexMessage({
      conversationId: convResult.conversation.id,
      senderType: 'agent',
      contentText: mf.contentText,
      metaId: e.metaId,
      status: 'sent',
      viaBusinessApp: true,
      timestamp: e.timestamp,
      contentType: mf.contentType,
      mediaUrl: mf.mediaUrl,
      mediaType: mf.mediaType,
    })
    // Resumo da conversa: o marcador/legenda original (list preview).
    if (inserted) await touchConversationSummary(convResult.conversation.id, e.contentText, e.timestamp)
  }

  // Edições (type='edit'): atualizam a mensagem original em vez de virar bolha nova.
  const edits = parseMessageEdits(value)
  for (const ed of edits) {
    const contactOutcome = await findOrCreateContact(config.account_id, config.unit_id, config.user_id, {
      phone: ed.contactPhone,
      bsuid: null,
      username: null,
      name: '',
    })
    if (!contactOutcome) continue
    const convResult = await findOrCreateConversation(config.account_id, config.unit_id, config.user_id, contactOutcome.contact.id)
    if (!convResult) continue
    await applyCoexEdit(config, convResult.conversation.id, ed)
  }
}

async function handleHistory(value: unknown): Promise<void> {
  const v = value as { metadata?: { phone_number_id?: string; display_phone_number?: string } }
  const config = await resolveCoexConfig(v.metadata?.phone_number_id)
  if (!config) return
  const businessPhone = v.metadata?.display_phone_number ?? ''
  const msgs = parseHistory(value, businessPhone)

  // Agrupa por telefone do contato: resolve contato+conversa uma vez por thread.
  const byPhone = new Map<string, typeof msgs>()
  for (const m of msgs) {
    const arr = byPhone.get(m.contactPhone) ?? []
    arr.push(m)
    byPhone.set(m.contactPhone, arr)
  }

  for (const [phone, items] of byPhone) {
    const contactOutcome = await findOrCreateContact(config.account_id, config.unit_id, config.user_id, {
      phone,
      bsuid: null,
      username: null,
      name: '',
    })
    if (!contactOutcome) continue
    const convResult = await findOrCreateConversation(config.account_id, config.unit_id, config.user_id, contactOutcome.contact.id)
    if (!convResult) continue

    let newest: { text: string | null; ts: number | null } | null = null
    for (const m of items) {
      const mf = await coexMediaFields(config, m)
      await insertCoexMessage({
        conversationId: convResult.conversation.id,
        senderType: m.direction === 'out' ? 'agent' : 'customer',
        contentText: mf.contentText,
        metaId: m.metaId,
        status: m.status,
        viaBusinessApp: m.direction === 'out',
        timestamp: m.timestamp,
        contentType: mf.contentType,
        mediaUrl: mf.mediaUrl,
        mediaType: mf.mediaType,
      })
      if (!newest || (m.timestamp ?? 0) > (newest.ts ?? 0)) {
        newest = { text: m.contentText, ts: m.timestamp }
      }
    }
    // Resumo = mensagem mais recente do thread (sem marcar não-lida).
    if (newest) await touchConversationSummary(convResult.conversation.id, newest.text, newest.ts)
  }
}

async function handleAppStateSync(value: unknown): Promise<void> {
  const v = value as { metadata?: { phone_number_id?: string } }
  const config = await resolveCoexConfig(v.metadata?.phone_number_id)
  if (!config) return
  const contacts = parseAppStateSync(value)
  for (const c of contacts) {
    await findOrCreateContact(config.account_id, config.unit_id, config.user_id, {
      phone: c.phone,
      bsuid: null,
      username: null,
      name: c.name ?? '',
    })
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string,
  // Tenancy + opt-out for the media mirror. Null disables mirroring
  // entirely, which is what the account-level toggle does.
  mirror: { accountId: string } | null
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  /**
   * For interactive button / list replies: the stable id of the tapped
   * option (whatever we put on the button when sending). Used by the
   * Flows engine to advance the per-contact run; persisted to
   * `messages.interactive_reply_id` so the inbox bubble can render the
   * tap with the right affordance. Null for everything else.
   */
  interactiveReplyId: string | null
}> {
  // getMediaUrl signature is (mediaId, accessToken) — earlier code had
  // the args swapped, so every verification hit an invalid Meta URL and
  // fell through to the catch block, leaving mediaUrl as null. That's
  // why images showed up as empty bubbles in the inbox.
  //
  // Beyond verifying, this is where inbound media gets COPIED into the
  // `chat-media` bucket (issue #466). Meta deletes media ~30 days after
  // receipt, so the `/api/whatsapp/media/<id>` proxy URL we used to
  // store is a pointer with an expiry date on it — every inbound
  // attachment silently became "Photo unavailable" a month later.
  // Mirroring stores a durable public URL instead.
  //
  // The mirror is strictly best-effort. `mirrorInboundMedia` swallows
  // its own failures and returns null, and we fall back to the proxy
  // URL — a webhook that throws would have Meta retry the delivery and
  // re-run everything downstream, which is a far worse outcome than an
  // attachment that expires.
  const verifyAndBuildUrl = async (
    mediaId: string,
    fileName?: string | null
  ): Promise<string | null> => {
    try {
      const info = await getMediaUrl({ mediaId, accessToken })

      if (mirror) {
        const mirrored = await mirrorInboundMedia({
          storage: supabaseAdmin().storage,
          accountId: mirror.accountId,
          mediaId,
          downloadUrl: info.url,
          accessToken,
          mimeType: info.mimeType,
          fileSize: info.fileSize,
          fileName,
          messageTimestamp: message.timestamp,
        })
        if (mirrored) return mirrored
      }

      return `/api/whatsapp/media/${mediaId}`
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      )
      return null
    }
  }

  // Default shape — each case overrides only the fields it cares about.
  // Keeps the new `interactiveReplyId` field DRY across every return site.
  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return empty

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        }
      }
      return empty

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          // The sender's own filename becomes the mirrored object's
          // name, so saving the attachment yields `invoice.pdf` even
          // when a caption displaced the filename in content_text.
          mediaUrl: await verifyAndBuildUrl(
            message.document.id,
            message.document.filename
          ),
          mediaType: message.document.mime_type,
        }
      }
      return empty

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return empty

    case 'sticker':
      // Stickers are images under the hood. Treat them as such so the
      // MessageBubble renders the <img>. The caller maps the DB
      // content_type to 'image' for the CHECK constraint.
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return empty

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'interactive': {
      // The customer tapped a reply button or a list row on a message
      // we previously sent. Meta delivers `interactive.button_reply` for
      // 3-button messages and `interactive.list_reply` for list messages.
      // Use the human-readable title as contentText so the inbox bubble
      // renders the tap legibly ("Existing customer"), and stash the
      // stable id separately so the Flows engine can route on it.
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        }
      }
      return { ...empty, contentText: '[Interactive reply]' }
    }

    case 'button': {
      // Quick-reply tap on a TEMPLATE message. Meta delivers these under
      // their own `button` envelope rather than `interactive` above, so
      // without this case they fell through to `default` and landed in
      // the inbox as "[Unsupported message type: button]" with a null
      // interactiveReplyId — which also meant the Flows engine and the
      // `interactive_reply` automation trigger never saw the tap, so
      // nothing chained off a broadcast reply (issue #478).
      //
      // `payload` is the stable value (the analogue of
      // `button_reply.id`); `text` is the visible label. Prefer the
      // payload for routing and the label for display, each falling
      // back to the other since a template may carry only one.
      const payload = message.button?.payload || null
      const label = message.button?.text || null
      return {
        ...empty,
        contentText: label || payload,
        interactiveReplyId: payload || label,
      }
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  /** True when this call created the row; drives new_contact_created
   *  automation dispatch in processMessage. */
  wasCreated: boolean
}

/** Escolhe o contato canônico num merge: o mais antigo (created_at). */
function pickCanonical(a: ContactRow, b: ContactRow): ContactRow {
  const ta = new Date(a.created_at ?? 0).getTime()
  const tb = new Date(b.created_at ?? 0).getTime()
  return ta <= tb ? a : b
}

/**
 * Merge best-effort de dois contatos: move as conversas e reações do duplicado
 * para o canônico e apaga o duplicado. Nunca lança — em falha, loga e segue
 * (o pior caso é histórico dividido, nunca perda de mensagem).
 */
async function mergeContacts(
  admin: ReturnType<typeof supabaseAdmin>,
  canonicalId: string,
  duplicateId: string,
): Promise<void> {
  try {
    await admin
      .from('conversations')
      .update({ contact_id: canonicalId })
      .eq('contact_id', duplicateId)
    await admin
      .from('message_reactions')
      .update({ actor_id: canonicalId })
      .eq('actor_id', duplicateId)
      .eq('actor_type', 'customer')
    await admin.from('contacts').delete().eq('id', duplicateId)
  } catch (err) {
    console.error('[webhook] merge de contatos falhou (não-fatal):', err)
  }
}

async function findOrCreateContact(
  accountId: string,
  unitId: string,
  configOwnerUserId: string,
  identity: InboundIdentity
): Promise<ContactOutcome | null> {
  const admin = supabaseAdmin()
  const { phone, bsuid, username, name } = identity

  // Resolve por telefone (se houver) e por BSUID (se houver). Dedup por
  // telefone reusa o helper compartilhado (form/CSV/webhook concordam no que é
  // "mesmo número", issue #212); por BSUID casa a identidade estável da Meta.
  const byPhone = phone
    ? await findExistingContact(admin, accountId, phone, unitId)
    : null
  const byBsuid = bsuid
    ? await findContactByBsuid(admin, accountId, bsuid, unitId)
    : null

  // MERGE (decisão B2): telefone e BSUID apontam para contatos DIFERENTES — o
  // usuário (antes só-BSUID) revelou o telefone e já havia um contato por
  // telefone. Colapsa no mais antigo e move as conversas.
  if (byPhone && byBsuid && byPhone.id !== byBsuid.id) {
    const canonical = pickCanonical(byPhone, byBsuid)
    const duplicate = canonical.id === byPhone.id ? byBsuid : byPhone
    await mergeContacts(admin, canonical.id, duplicate.id)
    await admin
      .from('contacts')
      .update({
        phone: phone ?? canonical.phone ?? null,
        bsuid: bsuid ?? canonical.bsuid ?? null,
        ...(username ? { username } : {}),
        ...(name ? { name } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', canonical.id)
    const { data: merged } = await admin
      .from('contacts')
      .select('*')
      .eq('id', canonical.id)
      .single()
    return { contact: merged ?? canonical, wasCreated: false }
  }

  // Achou por um dos dois (ou o mesmo): atualiza/religa e retorna. É aqui que um
  // contato só-BSUID ganha o telefone quando ele finalmente aparece (e vice).
  const existing = byPhone ?? byBsuid
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (name && name !== existing.name) patch.name = name
    if (phone && !existing.phone) patch.phone = phone
    if (bsuid && !existing.bsuid) patch.bsuid = bsuid
    if (username && username !== existing.username) patch.username = username
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString()
      await admin.from('contacts').update(patch).eq('id', existing.id)
      return { contact: { ...existing, ...patch }, wasCreated: false }
    }
    return { contact: existing, wasCreated: false }
  }

  // Não achou. Precisa de pelo menos telefone OU bsuid pra criar.
  if (!phone && !bsuid) {
    console.error('[webhook] inbound sem telefone e sem BSUID — ignorado')
    return null
  }

  const { data: newContact, error: createError } = await admin
    .from('contacts')
    .insert({
      account_id: accountId,
      unit_id: unitId,
      user_id: configOwnerUserId,
      phone: phone ?? null,
      bsuid: bsuid ?? null,
      username: username ?? null,
      name: name || phone || (username ? `@${username}` : 'Usuário WhatsApp'),
    })
    .select()
    .single()

  if (createError) {
    // Corrida: outra entrega concorrente criou o contato entre a busca e o
    // insert; o índice unique (telefone per (account,unit) — migration 044 — ou
    // bsuid per (account,unit) — migration 050) rejeitou. Re-resolve.
    if (isUniqueViolation(createError)) {
      const raced =
        (phone ? await findExistingContact(admin, accountId, phone, unitId) : null) ??
        (bsuid ? await findContactByBsuid(admin, accountId, bsuid, unitId) : null)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('Error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  unitId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  // Look for an existing conversation in this account, oldest-first.
  //
  // We deliberately do NOT use `.single()` here. `.single()` errors on
  // *both* 0 rows and ≥2 rows, and the old code treated any error as
  // "none found" and inserted a new row. So once two conversations
  // existed for a contact (from a race — Meta retries a delivery, or a
  // batch fans out to concurrent runs), every subsequent inbound
  // message errored on the lookup and created yet another conversation,
  // snowballing into a wall of duplicate chats (issue #363).
  //
  // Ordering oldest-first and taking one row makes the lookup resolve to
  // the same canonical survivor the dedup migration (036) keeps, so any
  // pre-existing duplicates converge instead of compounding.
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('unit_id', unitId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('Error finding conversation:', findError)
    return null
  }

  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }

  // Create new conversation. Same tenancy + audit split as
  // findOrCreateContact above; a conversation is per (account, unit,
  // contact) now (migration 043).
  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      unit_id: unitId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select()
    .single()

  if (createError) {
    // Lost a race: a concurrent inbound delivery created the
    // conversation between our lookup and insert, and the unique index
    // (migration 036) rejected the duplicate. Re-resolve the winning
    // row instead of dropping the message — mirrors findOrCreateContact.
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('unit_id', unitId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) {
        return { conversation: raced[0], created: false }
      }
    }
    console.error('Error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}
