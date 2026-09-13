"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  KIND_LABEL,
  WEEKDAYS,
  type Resource,
  type ResourceKind,
  type Service,
  type WorkingHour,
} from "@/lib/scheduling/types";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  unitId: string;
  accountId: string;
  onChanged: () => void;
};

export function CatalogDialog({ open, onOpenChange, unitId, accountId, onChanged }: Props) {
  const supabase = createClient();
  const [tab, setTab] = useState<"services" | "resources">("services");
  const [services, setServices] = useState<Service[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);

  const load = useCallback(async () => {
    const [{ data: s }, { data: r }] = await Promise.all([
      supabase.from("services").select("*").eq("unit_id", unitId).order("name"),
      supabase.from("resources").select("*").eq("unit_id", unitId).order("name"),
    ]);
    setServices((s ?? []) as Service[]);
    setResources((r ?? []) as Resource[]);
  }, [supabase, unitId]);

  useEffect(() => {
    if (open && unitId) load();
  }, [open, unitId, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-popover border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Catálogo da agenda</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b border-border">
          {(["services", "resources"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={
                "px-3 py-2 text-sm font-medium -mb-px border-b-2 " +
                (tab === k
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {k === "services" ? "Serviços" : "Recursos"}
            </button>
          ))}
        </div>

        {tab === "services" ? (
          <ServicesTab
            services={services}
            onChanged={() => {
              load();
              onChanged();
            }}
            unitId={unitId}
            accountId={accountId}
          />
        ) : (
          <ResourcesTab
            resources={resources}
            onChanged={() => {
              load();
              onChanged();
            }}
            unitId={unitId}
            accountId={accountId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ServicesTab({
  services,
  onChanged,
  unitId,
  accountId,
}: {
  services: Service[];
  onChanged: () => void;
  unitId: string;
  accountId: string;
}) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim() || duration <= 0) return;
    setBusy(true);
    const { error } = await supabase.from("services").insert({
      account_id: accountId,
      unit_id: unitId,
      name: name.trim(),
      duration_min: duration,
      price: price ? Number(price) : null,
      color,
    });
    setBusy(false);
    if (error) {
      toast.error("Falha ao criar serviço: " + error.message);
      return;
    }
    setName("");
    setPrice("");
    onChanged();
    toast.success("Serviço criado.");
  }

  async function remove(id: string) {
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) toast.error("Não foi possível excluir (há agendamentos?).");
    else onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end">
        <div>
          <Label className="text-muted-foreground">Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Corte, Consulta…" className="mt-1" />
        </div>
        <div>
          <Label className="text-muted-foreground">Duração (min)</Label>
          <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-1 w-28" />
        </div>
        <div>
          <Label className="text-muted-foreground">Preço (opc.)</Label>
          <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-28" placeholder="—" />
        </div>
        <div>
          <Label className="text-muted-foreground">Cor</Label>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 h-9 w-12 rounded border border-border bg-transparent" />
        </div>
        <Button onClick={add} disabled={busy || !name.trim()} className="bg-primary text-primary-foreground">
          Adicionar
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {services.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nenhum serviço ainda.</li>}
        {services.map((s) => (
          <li key={s.id} className="flex items-center justify-between p-3">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color ?? "#888" }} />
              {s.name} · {s.duration_min}min{s.price != null ? ` · R$${s.price}` : ""}
            </span>
            <button type="button" onClick={() => remove(s.id)} className="text-muted-foreground hover:text-destructive" aria-label="Excluir">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResourcesTab({
  resources,
  onChanged,
  unitId,
  accountId,
}: {
  resources: Resource[];
  onChanged: () => void;
  unitId: string;
  accountId: string;
}) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("professional");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("resources").insert({
      account_id: accountId,
      unit_id: unitId,
      name: name.trim(),
      kind,
    });
    setBusy(false);
    if (error) {
      toast.error("Falha ao criar recurso: " + error.message);
      return;
    }
    setName("");
    onChanged();
    toast.success("Recurso criado.");
  }

  async function remove(id: string) {
    const { error } = await supabase.from("resources").delete().eq("id", id);
    if (error) toast.error("Não foi possível excluir (há agendamentos?).");
    else onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <Label className="text-muted-foreground">Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dra. Ana, Sala 2, Cadeira 1…" className="mt-1" />
        </div>
        <div>
          <Label className="text-muted-foreground">Tipo</Label>
          <select value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)} className="input mt-1">
            {(Object.keys(KIND_LABEL) as ResourceKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={add} disabled={busy || !name.trim()} className="bg-primary text-primary-foreground">
          Adicionar
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {resources.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nenhum recurso ainda.</li>}
        {resources.map((r) => (
          <li key={r.id} className="flex items-center justify-between p-3">
            <span className="text-sm text-foreground">
              {r.name} <span className="text-muted-foreground">· {KIND_LABEL[r.kind]}</span>
            </span>
            <span className="flex items-center gap-3">
              <button type="button" onClick={() => setEditing(r)} className="text-xs text-primary hover:underline">
                Horários
              </button>
              <button type="button" onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive" aria-label="Excluir">
                <Trash2 className="h-4 w-4" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      {editing && (
        <WorkingHoursEditor
          resource={editing}
          accountId={accountId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function WorkingHoursEditor({
  resource,
  accountId,
  onClose,
}: {
  resource: Resource;
  accountId: string;
  onClose: () => void;
}) {
  const supabase = createClient();
  // Uma faixa por dia da semana no v1 (start/end); vazio = não atende.
  const [rows, setRows] = useState<{ weekday: number; start: string; end: string; on: boolean }[]>(
    WEEKDAYS.map((_, i) => ({ weekday: i, start: "09:00", end: "18:00", on: i >= 1 && i <= 5 })),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("resource_working_hours")
      .select("*")
      .eq("resource_id", resource.id)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        setRows(
          WEEKDAYS.map((_, i) => {
            const wh = (data as WorkingHour[]).find((x) => x.weekday === i);
            return wh
              ? { weekday: i, start: wh.start_time.slice(0, 5), end: wh.end_time.slice(0, 5), on: true }
              : { weekday: i, start: "09:00", end: "18:00", on: false };
          }),
        );
      });
  }, [supabase, resource.id]);

  async function save() {
    setBusy(true);
    // Substitui as faixas do recurso (v1: uma por dia).
    await supabase.from("resource_working_hours").delete().eq("resource_id", resource.id);
    const payload = rows
      .filter((r) => r.on && r.end > r.start)
      .map((r) => ({
        account_id: accountId,
        resource_id: resource.id,
        weekday: r.weekday,
        start_time: r.start,
        end_time: r.end,
      }));
    let error = null;
    if (payload.length > 0) {
      const res = await supabase.from("resource_working_hours").insert(payload);
      error = res.error;
    }
    setBusy(false);
    if (error) toast.error("Falha ao salvar horários: " + error.message);
    else {
      toast.success("Horários salvos.");
      onClose();
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Horário de trabalho — {resource.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.weekday} className="flex items-center gap-2">
              <label className="flex w-16 items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={r.on}
                  onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                />
                {WEEKDAYS[r.weekday]}
              </label>
              <input
                type="time"
                value={r.start}
                disabled={!r.on}
                onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                className="input w-28 disabled:opacity-40"
              />
              <span className="text-muted-foreground">–</span>
              <input
                type="time"
                value={r.end}
                disabled={!r.on}
                onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                className="input w-28 disabled:opacity-40"
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} className="border-border">
            Cancelar
          </Button>
          <Button onClick={save} disabled={busy} className="bg-primary text-primary-foreground">
            {busy ? "…" : "Salvar horários"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
