import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy, Plus } from "lucide-react";

import { requireRole } from "@/lib/auth/account";
import { supportListTickets } from "@/lib/support/central-support-client";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TicketRow } from "./ticket-row";

export const metadata: Metadata = {
  title: "Suporte",
};

// Aba de suporte do RedeZap: qualquer usuário logado (viewer+) pode abrir,
// acompanhar e responder chamados. Papel mínimo = "viewer" — não há
// restrição extra aqui, então deixamos `requireRole` lançar se não houver
// sessão (o middleware já bloqueia o não-autenticado antes de chegar aqui).
export default async function SupportPage() {
  await requireRole("viewer");
  const tickets = await supportListTickets();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
            Suporte
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Abra chamados e acompanhe o atendimento da nossa equipe.
          </p>
        </div>
        <Link
          href="/support/new"
          className={buttonVariants({
            className: "bg-primary text-primary-foreground hover:bg-primary/90",
          })}
        >
          <Plus className="h-4 w-4" />
          Novo chamado
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-4 text-center">
          <LifeBuoy className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            Você ainda não abriu nenhum chamado.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Precisa de ajuda? Abra um chamado e nossa equipe responde por aqui.
          </p>
          <Link
            href="/support/new"
            className={buttonVariants({
              className: "mt-4 bg-primary text-primary-foreground hover:bg-primary/90",
            })}
          >
            <Plus className="h-4 w-4" />
            Novo chamado
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Protocolo</TableHead>
                <TableHead className="text-muted-foreground">Título</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="hidden text-muted-foreground sm:table-cell">
                  Prazo
                </TableHead>
                <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                  Mensagens
                </TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">
                  Aberto em
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((ticket) => (
                <TicketRow key={ticket.id} ticket={ticket} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
