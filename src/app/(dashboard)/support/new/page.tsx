import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth/account";
import { NewTicketForm } from "./new-ticket-form";

export const metadata: Metadata = {
  title: "Novo chamado · Suporte",
};

export default async function NewSupportTicketPage() {
  await requireRole("viewer");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para Suporte
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight text-foreground">
          Novo chamado
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conte o que está acontecendo e nossa equipe responde por aqui.
        </p>
      </div>

      <NewTicketForm />
    </div>
  );
}
