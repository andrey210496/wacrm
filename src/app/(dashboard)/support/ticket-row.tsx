"use client";

import { useRouter } from "next/navigation";

import { TableCell, TableRow } from "@/components/ui/table";
import { STATUS_LABEL_PT } from "@/lib/support/status-labels";
import type { SupportTicketListItem } from "@/lib/support/central-support-client";

/**
 * One clickable row in the ticket list. A plain server-rendered `<tr>`
 * can't carry an onClick (functions aren't serializable across the
 * server/client boundary) — this thin client component owns the
 * navigation instead, mirroring the `broadcasts` list's row-click
 * pattern.
 */
export function TicketRow({ ticket }: { ticket: SupportTicketListItem }) {
  const router = useRouter();

  return (
    <TableRow
      className="cursor-pointer border-border hover:bg-muted/50"
      onClick={() => router.push(`/support/${ticket.id}`)}
    >
      <TableCell className="font-medium text-foreground">
        {ticket.protocolo ?? "—"}
      </TableCell>
      <TableCell className="max-w-xs truncate text-foreground">
        {ticket.title}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
          {STATUS_LABEL_PT[ticket.status] ?? ticket.status}
        </span>
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {ticket.slaDueAt ? new Date(ticket.slaDueAt).toLocaleString("pt-BR") : "—"}
      </TableCell>
      <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
        {ticket.messageCount}
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {new Date(ticket.createdAt).toLocaleString("pt-BR")}
      </TableCell>
    </TableRow>
  );
}
