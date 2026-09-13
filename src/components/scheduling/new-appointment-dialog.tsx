"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { generateSlots, type TimeRange } from "@/lib/scheduling/availability";
import type { Resource, Service, WorkingHour } from "@/lib/scheduling/types";

type Contact = { id: string; name: string | null; phone: string | null };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  unitId: string;
  accountId: string;
  services: Service[];
  resources: Resource[];
  defaultDate: string; // YYYY-MM-DD (local)
  onCreated: () => void;
};

/** Constrói faixas de trabalho (Date local) do recurso para a data. */
function workRangesFor(dateStr: string, hours: WorkingHour[]): TimeRange[] {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const weekday = new Date(y, m - 1, d).getDay();
  return hours
    .filter((h) => h.weekday === weekday)
    .map((h) => {
      const [sh, sm] = h.start_time.split(":").map((x) => parseInt(x, 10));
      const [eh, em] = h.end_time.split(":").map((x) => parseInt(x, 10));
      return { start: new Date(y, m - 1, d, sh, sm), end: new Date(y, m - 1, d, eh, em) };
    });
}

export function NewAppointmentDialog({
  open,
  onOpenChange,
  unitId,
  accountId,
  services,
  resources,
  defaultDate,
  onCreated,
}: Props) {
  const supabase = createClient();
  const [serviceId, setServiceId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [slots, setSlots] = useState<TimeRange[]>([]);
  const [slotIdx, setSlotIdx] = useState<number | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setServiceId(services[0]?.id ?? "");
      setResourceId(resources[0]?.id ?? "");
      setDate(defaultDate);
      setSlotIdx(null);
      setContact(null);
      setQuery("");
      setNotes("");
    }
  }, [open, defaultDate, services, resources]);

  const service = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);

  const loadSlots = useCallback(async () => {
    if (!serviceId || !resourceId || !date || !service) {
      setSlots([]);
      return;
    }
    setLoadingSlots(true);
    setSlotIdx(null);
    // Início/fim do dia local em ISO para filtrar.
    const [y, m, d] = date.split("-").map((x) => parseInt(x, 10));
    const dayStart = new Date(y, m - 1, d, 0, 0, 0);
    const dayEnd = new Date(y, m - 1, d + 1, 0, 0, 0);

    const [{ data: hours }, { data: appts }, { data: offs }] = await Promise.all([
      supabase.from("resource_working_hours").select("*").eq("resource_id", resourceId),
      supabase
        .from("appointments")
        .select("starts_at, ends_at, status")
        .eq("resource_id", resourceId)
        .gte("starts_at", dayStart.toISOString())
        .lt("starts_at", dayEnd.toISOString()),
      supabase
        .from("resource_time_off")
        .select("starts_at, ends_at")
        .eq("resource_id", resourceId)
        .lt("starts_at", dayEnd.toISOString())
        .gt("ends_at", dayStart.toISOString()),
    ]);

    const busy: TimeRange[] = [
      ...((appts ?? []) as { starts_at: string; ends_at: string; status: string }[])
        .filter((a) => a.status !== "canceled" && a.status !== "no_show")
        .map((a) => ({ start: new Date(a.starts_at), end: new Date(a.ends_at) })),
      ...((offs ?? []) as { starts_at: string; ends_at: string }[]).map((o) => ({
        start: new Date(o.starts_at),
        end: new Date(o.ends_at),
      })),
    ];

    const workRanges = workRangesFor(date, (hours ?? []) as WorkingHour[]);
    setSlots(generateSlots({ workRanges, busy, durationMin: service.duration_min }));
    setLoadingSlots(false);
  }, [supabase, serviceId, resourceId, date, service]);

  useEffect(() => {
    if (open) loadSlots();
  }, [open, loadSlots]);

  // Busca de contatos (debounce simples).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const t = setTimeout(async () => {
      let sel = supabase.from("contacts").select("id, name, phone").eq("unit_id", unitId).limit(8);
      if (q) sel = sel.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
      const { data } = await sel;
      setContacts((data ?? []) as Contact[]);
    }, 250);
    return () => clearTimeout(t);
  }, [supabase, query, unitId, open]);

  async function create() {
    if (slotIdx == null || !contact || !service) return;
    const slot = slots[slotIdx];
    setBusy(true);
    const { error } = await supabase.from("appointments").insert({
      account_id: accountId,
      unit_id: unitId,
      contact_id: contact.id,
      service_id: serviceId,
      resource_id: resourceId,
      starts_at: slot.start.toISOString(),
      ends_at: slot.end.toISOString(),
      status: "scheduled",
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) {
      // 23P01 = exclusion_violation (overbooking barrado pelo banco).
      const conflict = error.code === "23P01" || /overbook|exclusion/i.test(error.message);
      toast.error(conflict ? "Esse horário acabou de ser ocupado. Escolha outro." : "Falha ao agendar: " + error.message);
      if (conflict) loadSlots();
      return;
    }
    toast.success("Agendamento criado.");
    onCreated();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-popover border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Novo agendamento</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-muted-foreground">Serviço</Label>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="input mt-1 w-full">
                {services.length === 0 && <option value="">— cadastre um serviço —</option>}
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.duration_min}min)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-muted-foreground">Recurso</Label>
              <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} className="input mt-1 w-full">
                {resources.length === 0 && <option value="">— cadastre um recurso —</option>}
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label className="text-muted-foreground">Data</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label className="text-muted-foreground">Horário livre</Label>
            {loadingSlots ? (
              <p className="mt-1 text-xs text-muted-foreground">Calculando horários…</p>
            ) : slots.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Nenhum horário livre nesse dia (verifique o horário de trabalho do recurso).</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-2">
                {slots.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSlotIdx(i)}
                    className={
                      "rounded-md border px-2.5 py-1 text-xs " +
                      (slotIdx === i
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-foreground hover:bg-muted")
                    }
                  >
                    {s.start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="text-muted-foreground">Cliente</Label>
            {contact ? (
              <div className="mt-1 flex items-center justify-between rounded-md border border-border p-2 text-sm">
                <span className="text-foreground">
                  {contact.name || contact.phone || "Contato"}
                </span>
                <button type="button" onClick={() => setContact(null)} className="text-xs text-primary hover:underline">
                  trocar
                </button>
              </div>
            ) : (
              <>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou telefone…" className="mt-1" />
                {contacts.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border">
                    {contacts.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setContact(c)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                        >
                          <span>{c.name || "(sem nome)"}</span>
                          <span className="text-xs text-muted-foreground">{c.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div>
            <Label className="text-muted-foreground">Observações (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
            Cancelar
          </Button>
          <Button onClick={create} disabled={busy || slotIdx == null || !contact} className="bg-primary text-primary-foreground">
            {busy ? "…" : "Agendar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
