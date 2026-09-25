"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag, PipelineStage } from "@/types";
import { DealForm } from "@/components/pipelines/deal-form";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewAppointmentDialog } from "@/components/scheduling/new-appointment-dialog";
import { RemindersConfigDialog } from "@/components/scheduling/reminders-config-dialog";
import { useCan } from "@/hooks/use-can";
import { Bell } from "lucide-react";
import type { Service, Resource } from "@/lib/scheduling/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
// MESMO caminho de escrita que a tela de contato (grava em contact_tags e
// dispara as automações de tag) — editar etiqueta na conversa fica consistente
// em todo lugar, sem duplicar nem divergir.
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  // Lembretes: liberado para atendentes (agent+), não só admin.
  const canManageReminders = useCan("send-messages");
  const [copied, setCopied] = useState(false);
  const [copiedBsuid, setCopiedBsuid] = useState(false);
  const bsuid = (contact as { bsuid?: string | null } | null)?.bsuid ?? null;
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [savingTag, setSavingTag] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  // Agendar de dentro do chat.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [svcList, setSvcList] = useState<Service[]>([]);
  const [resList, setResList] = useState<Resource[]>([]);
  // Criar negócio no pipeline de dentro do chat (reusa o DealForm).
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [dealPipelineId, setDealPipelineId] = useState<string | null>(null);
  const [dealStages, setDealStages] = useState<PipelineStage[]>([]);
  // null = ainda carregando; false = a conta não tem pipeline (botão desabilitado).
  const [hasPipeline, setHasPipeline] = useState<boolean | null>(null);
  const [openingDeal, setOpeningDeal] = useState(false);

  const openSchedule = useCallback(async () => {
    if (!contact?.unit_id) return;
    const supabase = createClient();
    const [{ data: s }, { data: r }] = await Promise.all([
      supabase.from("services").select("*").eq("unit_id", contact.unit_id).eq("active", true).order("name"),
      supabase.from("resources").select("*").eq("unit_id", contact.unit_id).eq("active", true).order("name"),
    ]);
    setSvcList((s ?? []) as Service[]);
    setResList((r ?? []) as Resource[]);
    setScheduleOpen(true);
  }, [contact?.unit_id]);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags (do contato) e todas as tags da conta em paralelo.
    const [dealsRes, notesRes, tagsRes, allTagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase.from("tags").select("*").order("name"),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (allTagsRes.data) setAllTags(allTagsRes.data as Tag[]);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Re-lê só as etiquetas do contato (após add/remove) — a fonte é contact_tags,
  // então a sidebar volta a bater com a tela de contato e a lista de conversas.
  const refetchContactTags = useCallback(async () => {
    if (!contact) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("contact_tags")
      .select("id, tag_id, tags(*)")
      .eq("contact_id", contact.id);
    if (data) {
      setTags(
        data
          .filter((ct: Record<string, unknown>) => ct.tags)
          .map((ct: Record<string, unknown>) => ({
            ...(ct.tags as Tag),
            contact_tag_id: ct.id as string,
          })),
      );
    }
  }, [contact]);

  const handleAddTag = useCallback(
    async (tagId: string) => {
      if (!contact) return;
      setSavingTag(true);
      try {
        await addContactTag(contact.id, tagId);
        await refetchContactTags();
        setShowTagPicker(false);
      } catch {
        // silencioso — a etiqueta simplesmente não é adicionada
      } finally {
        setSavingTag(false);
      }
    },
    [contact, refetchContactTags],
  );

  const handleRemoveTag = useCallback(
    async (tagId: string) => {
      if (!contact) return;
      setSavingTag(true);
      try {
        await deleteContactTag(contact.id, tagId);
        await refetchContactTags();
      } catch {
        // silencioso
      } finally {
        setSavingTag(false);
      }
    },
    [contact, refetchContactTags],
  );

  // Re-lê só os negócios do contato após criar um pelo chat.
  const refetchDeals = useCallback(async () => {
    if (!contact) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("deals")
      .select("*, stage:pipeline_stages(*)")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false });
    if (data) setDeals(data);
  }, [contact]);

  // Abre o form de negócio já vinculado ao contato da conversa: carrega o
  // primeiro pipeline da conta + suas etapas e abre o DealForm.
  const openDealForm = useCallback(async () => {
    if (!contact) return;
    setOpeningDeal(true);
    try {
      const supabase = createClient();
      const { data: pipes } = await supabase
        .from("pipelines")
        .select("id")
        .order("created_at")
        .limit(1);
      const pipelineId = pipes?.[0]?.id as string | undefined;
      if (!pipelineId) {
        setHasPipeline(false);
        return;
      }
      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      setDealPipelineId(pipelineId);
      setDealStages((stages ?? []) as PipelineStage[]);
      setDealFormOpen(true);
    } finally {
      setOpeningDeal(false);
    }
  }, [contact]);

  // Descobre (uma vez) se a conta tem algum pipeline — pra habilitar o botão.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("pipelines").select("id").limit(1);
      if (!cancelled) setHasPipeline((data?.length ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Agendar direto do chat — cliente já preenchido, unidade da conversa. */}
          {contact.phone && (
            <Button
              onClick={openSchedule}
              className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <CalendarDays className="mr-1 h-4 w-4" />
              Agendar
            </Button>
          )}
          {/* Configurar lembretes da unidade — só admin. */}
          {canManageReminders && contact.unit_id && (
            <Button
              variant="outline"
              onClick={() => setRemindersOpen(true)}
              className="mt-2 w-full border-border text-foreground hover:bg-muted"
            >
              <Bell className="mr-1 h-4 w-4" />
              Lembretes
            </Button>
          )}

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">
                {contact.phone ||
                  ((contact as { username?: string }).username
                    ? `@${(contact as { username?: string }).username}`
                    : "Sem número (username)")}
              </span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {/* BSUID (ID WhatsApp) — identidade da Meta por par usuário-empresa.
                Aparece pra todos quando o contato tem um, útil como referência. */}
            {bsuid && (
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(bsuid);
                  setCopiedBsuid(true);
                  setTimeout(() => setCopiedBsuid(false), 2000);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
                title="ID WhatsApp (BSUID)"
              >
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate text-left font-mono text-xs">{bsuid}</span>
                {copiedBsuid ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            )}

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {tags.length === 0 && (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              )}
              {tags.map((tag) => (
                <span
                  key={tag.contact_tag_id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                >
                  {tag.name}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag.id)}
                    disabled={savingTag}
                    aria-label={`Remover etiqueta ${tag.name}`}
                    className="ml-0.5 rounded-full leading-none opacity-70 hover:opacity-100"
                  >
                    ×
                  </button>
                </span>
              ))}

              {/* Adicionar etiqueta — mesma fonte (contact_tags) das outras telas. */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTagPicker((v) => !v)}
                  disabled={savingTag || allTags.length === 0}
                  className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                >
                  <Plus className="h-3 w-3" />
                  Etiqueta
                </button>
                {showTagPicker && (
                  <div className="absolute z-10 mt-1 max-h-48 w-44 overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg">
                    {allTags.filter((t) => !tags.some((ct) => ct.id === t.id)).length === 0 ? (
                      <p className="px-2 py-1 text-[11px] text-muted-foreground">
                        Todas já aplicadas
                      </p>
                    ) : (
                      allTags
                        .filter((t) => !tags.some((ct) => ct.id === t.id))
                        .map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => handleAddTag(t.id)}
                            disabled={savingTag}
                            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-muted"
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: t.color }}
                            />
                            <span className="truncate">{t.name}</span>
                          </button>
                        ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <DollarSign className="h-3 w-3" />
                {tSidebar("deals")}
              </div>
              {/* Criar negócio no pipeline — vinculado a este contato (reusa DealForm). */}
              <button
                type="button"
                onClick={openDealForm}
                disabled={openingDeal || hasPipeline === false}
                title={
                  hasPipeline === false
                    ? "Crie um pipeline em Pipelines primeiro"
                    : undefined
                }
                className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                Negócio
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {contact.unit_id && accountId && (
        <NewAppointmentDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          unitId={contact.unit_id}
          accountId={accountId}
          services={svcList}
          resources={resList}
          defaultDate={new Date().toLocaleDateString("en-CA")}
          onCreated={() => {}}
          presetContact={{ id: contact.id, name: contact.name ?? null, phone: contact.phone }}
        />
      )}

      {canManageReminders && contact.unit_id && (
        <RemindersConfigDialog open={remindersOpen} onOpenChange={setRemindersOpen} unitId={contact.unit_id} />
      )}

      {/* Criar negócio — contato da conversa já preenchido. */}
      {dealPipelineId && (
        <DealForm
          open={dealFormOpen}
          onOpenChange={setDealFormOpen}
          pipelineId={dealPipelineId}
          stages={dealStages}
          presetContact={{
            id: contact.id,
            name: contact.name ?? null,
            phone: contact.phone ?? null,
            unit_id: contact.unit_id ?? null,
          }}
          onSaved={() => {
            setDealFormOpen(false);
            refetchDeals();
          }}
        />
      )}
    </div>
  );
}
