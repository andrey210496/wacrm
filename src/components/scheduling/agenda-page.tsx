"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { useUnitScope } from "@/components/units/unit-scope-provider";
import { GatedButton } from "@/components/ui/gated-button";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  STATUS_LABEL,
  type AppointmentStatus,
  type Appointment,
  type Resource,
  type Service,
} from "@/lib/scheduling/types";
import { CatalogDialog } from "@/components/scheduling/catalog-dialog";
import { NewAppointmentDialog } from "@/components/scheduling/new-appointment-dialog";
import { RemindersConfigDialog } from "@/components/scheduling/reminders-config-dialog";

type Unit = { id: string; name: string };

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  scheduled: "border-blue-500/40 bg-blue-500/10 text-blue-400",
  confirmed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  completed: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400",
  canceled: "border-red-500/40 bg-red-500/10 text-red-400 line-through",
  no_show: "border-amber-500/40 bg-amber-500/10 text-amber-400",
};

export function AgendaPage() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canBook = useCan("send-messages");
  const { selectedUnitId } = useUnitScope();

  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<string>("");
  const [date, setDate] = useState<string>(ymdLocal(new Date()));
  const [services, setServices] = useState<Service[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [remStatus, setRemStatus] = useState<Record<string, { state: string; error?: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);

  // Unidades (para admin que vê várias). Agente já vem preso à sua unidade.
  useEffect(() => {
    createClient()
      .from("unidades")
      .select("id, name")
      .eq("active", true)
      .order("created_at")
      .then(({ data }) => {
        const list = (data ?? []) as Unit[];
        setUnits(list);
        setUnitId((prev) => prev || selectedUnitId || list[0]?.id || "");
      });
  }, [selectedUnitId]);

  useEffect(() => {
    if (selectedUnitId) setUnitId(selectedUnitId);
  }, [selectedUnitId]);

  const loadCatalog = useCallback(async () => {
    if (!unitId) return;
    const [{ data: s }, { data: r }] = await Promise.all([
      supabase.from("services").select("*").eq("unit_id", unitId).eq("active", true).order("name"),
      supabase.from("resources").select("*").eq("unit_id", unitId).eq("active", true).order("name"),
    ]);
    setServices((s ?? []) as Service[]);
    setResources((r ?? []) as Resource[]);
  }, [supabase, unitId]);

  const loadAppointments = useCallback(async () => {
    if (!unitId) return;
    setLoading(true);
    const [y, m, d] = date.split("-").map((x) => parseInt(x, 10));
    const dayStart = new Date(y, m - 1, d, 0, 0, 0);
    const dayEnd = new Date(y, m - 1, d + 1, 0, 0, 0);
    const { data } = await supabase
      .from("appointments")
      .select("*, contact:contacts(id,name,phone), service:services(id,name,color,duration_min)")
      .eq("unit_id", unitId)
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString())
      .order("starts_at");
    const list = (data ?? []) as Appointment[];
    setAppointments(list);
    setLoading(false);
    // Status dos lembretes (selo no card) — via rota (a tabela é RLS deny-all).
    if (list.length > 0) {
      fetch("/api/appointments/reminder-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: list.map((a) => a.id) }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setRemStatus(d?.statuses ?? {}))
        .catch(() => setRemStatus({}));
    } else {
      setRemStatus({});
    }
  }, [supabase, unitId, date]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);
  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const shiftDay = (delta: number) => {
    const [y, m, d] = date.split("-").map((x) => parseInt(x, 10));
    setDate(ymdLocal(new Date(y, m - 1, d + delta)));
  };

  async function setStatus(id: string, status: AppointmentStatus) {
    // Otimista. Vai por rota (muda status + move o funil server-side).
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      const r = await fetch("/api/appointments/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!r.ok) throw new Error();
    } catch {
      toast.error("Falha ao atualizar status.");
      loadAppointments();
    }
  }

  const byResource = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const r of resources) map.set(r.id, []);
    for (const a of appointments) {
      if (!map.has(a.resource_id)) map.set(a.resource_id, []);
      map.get(a.resource_id)!.push(a);
    }
    return map;
  }, [resources, appointments]);

  const dateLabel = useMemo(() => {
    const [y, m, d] = date.split("-").map((x) => parseInt(x, 10));
    return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });
  }, [date]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => shiftDay(-1)} className="rounded-md border border-border p-2 hover:bg-muted" aria-label="Dia anterior">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          <button onClick={() => shiftDay(1)} className="rounded-md border border-border p-2 hover:bg-muted" aria-label="Próximo dia">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={() => setDate(ymdLocal(new Date()))} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Hoje
          </button>
          <span className="ml-2 hidden text-sm capitalize text-muted-foreground sm:inline">{dateLabel}</span>
        </div>

        <div className="flex items-center gap-2">
          {units.length > 1 && !selectedUnitId && (
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="input">
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
          <GatedButton
            variant="outline"
            canAct={canBook}
            gateReason="configurar lembretes"
            onClick={() => setRemindersOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Bell className="mr-1 h-4 w-4" />
            Lembretes
          </GatedButton>
          <GatedButton
            variant="outline"
            canAct={canBook}
            gateReason="editar catálogo"
            onClick={() => setCatalogOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Settings className="mr-1 h-4 w-4" />
            Catálogo
          </GatedButton>
          <GatedButton
            canAct={canBook}
            gateReason="criar agendamentos"
            disabled={!unitId || services.length === 0 || resources.length === 0}
            onClick={() => setNewOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Novo agendamento
          </GatedButton>
        </div>
      </div>

      {/* Board por recurso */}
      {resources.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
          <CalendarDays className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">Configure sua agenda</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Cadastre <b>serviços</b> e <b>recursos</b> (profissional, sala, equipamento) com seus horários de trabalho para começar a agendar.
          </p>
          <GatedButton canAct={canBook} gateReason="editar catálogo" onClick={() => setCatalogOpen(true)} className="mt-4 bg-primary text-primary-foreground">
            <Settings className="mr-1 h-4 w-4" />
            Abrir catálogo
          </GatedButton>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {resources.map((r) => {
            const items = (byResource.get(r.id) ?? []).slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
            return (
              <div key={r.id} className="w-72 shrink-0 rounded-xl border border-border bg-card">
                <div className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground">{r.name}</div>
                <div className="space-y-2 p-2">
                  {items.length === 0 && <p className="px-1 py-6 text-center text-xs text-muted-foreground">Sem agendamentos</p>}
                  {items.map((a) => (
                    <AppointmentCard key={a.id} a={a} onStatus={setStatus} canBook={canBook} rem={remStatus[a.id]} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {loading && <p className="text-xs text-muted-foreground">Carregando…</p>}

      {unitId && accountId && (
        <>
          <CatalogDialog open={catalogOpen} onOpenChange={setCatalogOpen} unitId={unitId} accountId={accountId} onChanged={loadCatalog} />
          <RemindersConfigDialog open={remindersOpen} onOpenChange={setRemindersOpen} unitId={unitId} />
          <NewAppointmentDialog
            open={newOpen}
            onOpenChange={setNewOpen}
            unitId={unitId}
            accountId={accountId}
            services={services}
            resources={resources}
            defaultDate={date}
            onCreated={loadAppointments}
          />
        </>
      )}
    </div>
  );
}

function ReminderBadge({ rem }: { rem?: { state: string; error?: string | null } }) {
  if (!rem) return null;
  if (rem.state === "sent") {
    return <span className="text-[10px] text-emerald-500" title="Lembrete enviado">🔔 lembrete enviado</span>;
  }
  if (rem.state === "failed") {
    return (
      <span className="text-[10px] text-red-500" title={rem.error ? `Falha: ${rem.error}` : "Lembrete falhou"}>
        ⚠️ lembrete falhou
      </span>
    );
  }
  return <span className="text-[10px] text-muted-foreground" title="Enviando…">🔔 enviando…</span>;
}

function AppointmentCard({
  a,
  onStatus,
  canBook,
  rem,
}: {
  a: Appointment;
  onStatus: (id: string, s: AppointmentStatus) => void;
  canBook: boolean;
  rem?: { state: string; error?: string | null };
}) {
  const time = new Date(a.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="rounded-lg border border-border bg-background p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{time}</span>
        <span className={"rounded-full border px-1.5 py-0.5 text-[10px] font-medium " + STATUS_BADGE[a.status]}>
          {STATUS_LABEL[a.status]}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-sm text-foreground">
        {a.service?.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.service.color }} />}
        <span className="truncate">{a.service?.name ?? "Serviço"}</span>
      </div>
      <div className="truncate text-xs text-muted-foreground">{a.contact?.name || a.contact?.phone || "Cliente"}</div>
      {rem && (
        <div className="mt-1">
          <ReminderBadge rem={rem} />
        </div>
      )}
      {canBook && a.status !== "canceled" && a.status !== "completed" && (
        <div className="mt-2">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onStatus(a.id, e.target.value as AppointmentStatus);
            }}
            className="input h-7 w-full text-xs"
          >
            <option value="">Ação…</option>
            {a.status === "scheduled" && <option value="confirmed">Confirmar</option>}
            <option value="completed">Concluir</option>
            <option value="no_show">Faltou</option>
            <option value="canceled">Cancelar</option>
          </select>
        </div>
      )}
    </div>
  );
}
