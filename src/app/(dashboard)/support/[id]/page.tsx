import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Paperclip } from "lucide-react";

import { requireRole } from "@/lib/auth/account";
import { supportGetTicket } from "@/lib/support/central-support-client";
import { STATUS_LABEL_PT } from "@/lib/support/status-labels";
import { cn } from "@/lib/utils";
import { ReplyForm } from "./reply-form";

export const metadata: Metadata = {
  title: "Chamado · Suporte",
};

function AttachmentLink({ id, fileName }: { id: string; fileName: string }) {
  return (
    <a
      href={`/api/support/attachments/${id}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1 text-xs text-foreground hover:bg-muted/70"
    >
      <Paperclip className="h-3 w-3 shrink-0" />
      <span className="max-w-[16rem] truncate">{fileName}</span>
    </a>
  );
}

export default async function SupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("viewer");
  const { id } = await params;
  const ticket = await supportGetTicket(id);
  if (!ticket) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para Suporte
        </Link>
      </div>

      {/* Cabeçalho do chamado */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              Protocolo {ticket.protocolo ?? "—"}
            </p>
            <h1 className="mt-0.5 font-heading text-xl font-bold tracking-tight text-foreground">
              {ticket.title}
            </h1>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
            {STATUS_LABEL_PT[ticket.status] ?? ticket.status}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <dt className="uppercase tracking-wide">Aberto em</dt>
            <dd className="mt-0.5 text-foreground">
              {new Date(ticket.createdAt).toLocaleString("pt-BR")}
            </dd>
          </div>
          {ticket.slaDueAt && (
            <div>
              <dt className="uppercase tracking-wide">Prazo</dt>
              <dd className="mt-0.5 text-foreground">
                {new Date(ticket.slaDueAt).toLocaleString("pt-BR")}
              </dd>
            </div>
          )}
          {ticket.priorityName && (
            <div>
              <dt className="uppercase tracking-wide">Prioridade</dt>
              <dd className="mt-0.5 text-foreground">{ticket.priorityName}</dd>
            </div>
          )}
        </dl>

        {ticket.body && (
          <p className="mt-4 whitespace-pre-wrap text-sm text-foreground">{ticket.body}</p>
        )}

        {ticket.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {ticket.attachments.map((a) => (
              <AttachmentLink key={a.id} id={a.id} fileName={a.fileName} />
            ))}
          </div>
        )}
      </div>

      {/* Thread de mensagens */}
      <div className="space-y-3">
        {ticket.messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            Nenhuma mensagem ainda. Envie uma resposta para dar continuidade.
          </p>
        ) : (
          ticket.messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex", m.fromTeam ? "justify-start" : "justify-end")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-xl border px-4 py-3",
                  m.fromTeam
                    ? "border-border bg-card"
                    : "border-primary/30 bg-primary/10",
                )}
              >
                <p className="text-xs font-medium text-muted-foreground">
                  {m.authorLabel ?? (m.fromTeam ? "Equipe" : "Você")}
                  <span className="ml-2 font-normal">
                    {new Date(m.createdAt).toLocaleString("pt-BR")}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{m.body}</p>
                {m.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.attachments.map((a) => (
                      <AttachmentLink key={a.id} id={a.id} fileName={a.fileName} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <ReplyForm ticketId={ticket.id} />
    </div>
  );
}
