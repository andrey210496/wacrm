"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { parseApiResponse } from "@/lib/http/api-response";

type Pipeline = { id: string; name: string };
type Stage = { id: string; name: string; pipeline_id: string };
type RemItem = { offset_min: number; text: string; enabled: boolean };
type Cfg = {
  reminders_enabled: boolean;
  reminder_offsets_min: number[];
  reminder_channel: "auto" | "official" | "uazapi";
  reminder_text: string;
  reminders: RemItem[] | null;
  confirm_enabled: boolean;
  confirm_keywords: string[];
  funnel_pipeline_id: string | null;
  stage_scheduled: string | null;
  stage_confirmed: string | null;
  stage_completed: string | null;
  stage_no_show: string | null;
  public_booking_enabled: boolean;
  public_slug: string | null;
  public_lead_time_min: number;
  public_window_days: number;
};

type Props = { open: boolean; onOpenChange: (v: boolean) => void; unitId: string };

export function RemindersConfigDialog({ open, onOpenChange, unitId }: Props) {
  const supabase = createClient();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [remList, setRemList] = useState<RemItem[]>([]);
  const [keywordsText, setKeywordsText] = useState("sim, confirmar, ok, 1");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const cr = await fetch(`/api/scheduling/config?unitId=${encodeURIComponent(unitId)}`);
    const p = await parseApiResponse<{ config: Cfg }>(cr);
    if (p.ok && p.data?.config) {
      const c = p.data.config;
      setCfg(c);
      // Semente da lista: usa `reminders` se houver; senão monta a partir dos
      // offsets antigos + texto único (1 item por antecedência).
      const seeded: RemItem[] =
        Array.isArray(c.reminders) && c.reminders.length > 0
          ? c.reminders.map((r) => ({ offset_min: r.offset_min, text: r.text, enabled: r.enabled !== false }))
          : (c.reminder_offsets_min ?? []).map((o) => ({ offset_min: o, text: c.reminder_text ?? "", enabled: true }));
      setRemList(seeded.length > 0 ? seeded : [{ offset_min: 180, text: c.reminder_text ?? "", enabled: true }]);
      setKeywordsText((c.confirm_keywords ?? []).join(", "));
    }
    const [{ data: pl }, { data: st }] = await Promise.all([
      supabase.from("pipelines").select("id, name").order("created_at"),
      supabase.from("pipeline_stages").select("id, name, pipeline_id").order("position"),
    ]);
    setPipelines((pl ?? []) as Pipeline[]);
    setStages((st ?? []) as Stage[]);
  }, [supabase, unitId]);

  useEffect(() => {
    if (open && unitId) load();
  }, [open, unitId, load]);

  const set = <K extends keyof Cfg>(k: K, v: Cfg[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  async function save() {
    if (!cfg) return;
    setBusy(true);
    const reminders = remList
      .map((r) => ({ offset_min: Math.max(1, Math.round(Number(r.offset_min) || 0)), text: r.text, enabled: r.enabled }))
      .filter((r) => r.offset_min > 0 && r.text.trim() !== "");
    const keywords = keywordsText.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const r = await fetch("/api/scheduling/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId,
        ...cfg,
        reminders,
        reminder_offsets_min: reminders.map((x) => x.offset_min),
        confirm_keywords: keywords,
      }),
    });
    const p = await parseApiResponse(r);
    setBusy(false);
    toast[p.ok ? "success" : "error"](p.ok ? "Configuração salva." : p.error);
    if (p.ok) onOpenChange(false);
  }

  const pipelineStages = stages.filter((s) => s.pipeline_id === cfg?.funnel_pipeline_id);
  const StageSelect = ({ label, k }: { label: string; k: keyof Cfg }) => (
    <div>
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <select
        value={(cfg?.[k] as string) ?? ""}
        onChange={(e) => set(k, (e.target.value || null) as never)}
        disabled={!cfg?.funnel_pipeline_id}
        className="input mt-1 w-full disabled:opacity-40"
      >
        <option value="">— não mover —</option>
        {pipelineStages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-popover border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Lembretes & Funil</DialogTitle>
        </DialogHeader>

        {!cfg ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={cfg.reminders_enabled} onChange={(e) => set("reminders_enabled", e.target.checked)} />
              Enviar lembretes automáticos
            </label>

            <div className={cfg.reminders_enabled ? "space-y-3" : "space-y-3 pointer-events-none opacity-50"}>
              <div>
                <Label className="text-muted-foreground text-xs">Canal de envio</Label>
                <select value={cfg.reminder_channel} onChange={(e) => set("reminder_channel", e.target.value as Cfg["reminder_channel"])} className="input mt-1 w-full">
                  <option value="auto">Automático (Conexão redezap)</option>
                  <option value="official">Sempre oficial</option>
                  <option value="uazapi">Sempre uazapi</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Lembretes (cada um com antecedência e texto próprios)</Label>
                {remList.map((r, i) => (
                  <div key={i} className="rounded-md border border-border p-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={r.enabled}
                          onChange={(e) => setRemList((p) => p.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
                        />
                        ativo
                      </label>
                      <Input
                        type="number"
                        min={1}
                        value={r.offset_min}
                        onChange={(e) => setRemList((p) => p.map((x, j) => (j === i ? { ...x, offset_min: Number(e.target.value) } : x)))}
                        className="h-8 w-24"
                      />
                      <span className="text-[11px] text-muted-foreground">min antes</span>
                      <button
                        type="button"
                        onClick={() => setRemList((p) => p.filter((_, j) => j !== i))}
                        className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                      >
                        remover
                      </button>
                    </div>
                    <textarea
                      value={r.text}
                      onChange={(e) => setRemList((p) => p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                      rows={2}
                      placeholder="Olá {cliente}! Seu {servico} é em {data} às {hora}. Responda SIM para confirmar."
                      className="input w-full text-xs"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setRemList((p) => [...p, { offset_min: 60, text: "", enabled: true }])}
                  className="text-xs text-primary hover:underline"
                >
                  + adicionar lembrete
                </button>
                <p className="text-[11px] text-muted-foreground">
                  Placeholders: {"{cliente} {servico} {recurso} {data} {hora}"} · Ex.: 1440 = 24h antes, 180 = 3h antes.
                </p>
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={cfg.confirm_enabled} onChange={(e) => set("confirm_enabled", e.target.checked)} />
                Confirmar por resposta do cliente
              </label>
              <div className={cfg.confirm_enabled ? "" : "pointer-events-none opacity-50"}>
                <Label className="text-muted-foreground text-xs">Palavras que confirmam (vírgula)</Label>
                <Input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} className="mt-1" placeholder="sim, confirmar, ok" />
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <Label className="text-muted-foreground text-xs">Mover funil ao mudar de status</Label>
              <select
                value={cfg.funnel_pipeline_id ?? ""}
                onChange={(e) => set("funnel_pipeline_id", (e.target.value || null) as never)}
                className="input w-full"
              >
                <option value="">— não usar funil —</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <StageSelect label="Ao agendar →" k="stage_scheduled" />
                <StageSelect label="Ao confirmar →" k="stage_confirmed" />
                <StageSelect label="Ao concluir →" k="stage_completed" />
                <StageSelect label="Ao faltar →" k="stage_no_show" />
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={cfg.public_booking_enabled}
                  onChange={(e) => set("public_booking_enabled", e.target.checked)}
                />
                Autoagendamento público (link para o cliente marcar sozinho)
              </label>
              <div className={cfg.public_booking_enabled ? "space-y-2" : "space-y-2 pointer-events-none opacity-50"}>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-muted-foreground text-xs">Antecedência mínima (min)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={cfg.public_lead_time_min}
                      onChange={(e) => set("public_lead_time_min", Number(e.target.value))}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Janela (dias à frente)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={cfg.public_window_days}
                      onChange={(e) => set("public_window_days", Number(e.target.value))}
                      className="mt-1"
                    />
                  </div>
                </div>
                {cfg.public_slug ? (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
                    <code className="flex-1 truncate text-xs text-foreground">
                      {typeof window !== "undefined" ? window.location.origin : ""}/agendar/{cfg.public_slug}
                    </code>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => {
                        navigator.clipboard?.writeText(`${window.location.origin}/agendar/${cfg.public_slug}`);
                        toast.success("Link copiado.");
                      }}
                    >
                      Copiar
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">O link é gerado ao salvar com o autoagendamento ligado.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
                Cancelar
              </Button>
              <Button onClick={save} disabled={busy} className="bg-primary text-primary-foreground">
                {busy ? "…" : "Salvar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
