"use client";

import { useActionState } from "react";
import { Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitNewSupportTicket } from "./actions";

const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif,application/pdf";

export function NewTicketForm() {
  const [error, formAction, pending] = useActionState(submitNewSupportTicket, undefined);

  return (
    <form action={formAction} className="space-y-5 rounded-xl border border-border bg-card p-5">
      <div className="space-y-1.5">
        <Label htmlFor="title">Título</Label>
        <Input
          id="title"
          name="title"
          placeholder="Resuma o problema em poucas palavras"
          required
          minLength={3}
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="body">Descrição</Label>
        <Textarea
          id="body"
          name="body"
          placeholder="Descreva com detalhes o que está acontecendo…"
          rows={6}
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="files" className="flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" />
          Anexos (opcional)
        </Label>
        <input
          id="files"
          name="files"
          type="file"
          multiple
          accept={ACCEPTED_TYPES}
          disabled={pending}
          className="block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border file:border-input file:bg-transparent file:px-2.5 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
        />
        <p className="text-xs text-muted-foreground">
          Até 5 arquivos, 10 MB cada. Formatos aceitos: imagens (PNG, JPG, WEBP, GIF) e PDF.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {pending ? "Enviando…" : "Abrir chamado"}
        </Button>
      </div>
    </form>
  );
}
