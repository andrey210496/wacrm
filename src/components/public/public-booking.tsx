"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Svc = { id: string; name: string; duration_min: number };
type Res = { id: string; name: string };
type UnitInfo = { unitName: string; leadTimeMin: number; windowDays: number; services: Svc[]; resources: Res[] };
type Slot = { start: string; end: string; resourceId: string };

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PublicBooking({ slug }: { slug: string }) {
  const [unit, setUnit] = useState<UnitInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [resourceId, setResourceId] = useState("any");
  const [date, setDate] = useState(ymd(new Date()));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [hp, setHp] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/booking/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setUnit(d);
        setServiceId(d.services?.[0]?.id ?? "");
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  const maxDate = useMemo(() => {
    if (!unit) return undefined;
    const d = new Date();
    d.setDate(d.getDate() + unit.windowDays);
    return ymd(d);
  }, [unit]);

  const loadSlots = useCallback(async () => {
    if (!serviceId || !date) return;
    setLoadingSlots(true);
    setSlot(null);
    try {
      const r = await fetch(`/api/public/booking/${encodeURIComponent(slug)}/slots?serviceId=${serviceId}&resourceId=${resourceId}&date=${date}`);
      const d = await r.json();
      setSlots(r.ok ? (d.slots ?? []) : []);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [slug, serviceId, resourceId, date]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  async function submit() {
    if (!slot || !name.trim() || !phone.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/public/booking/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId, resourceId, startsAt: slot.start, name, phone, hp }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setDone(true);
      } else if (r.status === 429) {
        setError("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
      } else if (d.error === "conflict") {
        setError("Esse horário acabou de ser ocupado. Escolha outro.");
        loadSlots();
      } else {
        setError("Não foi possível agendar. Verifique os dados e tente novamente.");
      }
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  const wrap = "min-h-screen w-full bg-background text-foreground flex items-start justify-center p-4 sm:p-8";
  const card = "w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm";

  if (notFound) {
    return (
      <div className={wrap}>
        <div className={card}>
          <h1 className="text-lg font-semibold">Link indisponível</h1>
          <p className="mt-2 text-sm text-muted-foreground">Este link de agendamento não está ativo. Fale com o estabelecimento.</p>
        </div>
      </div>
    );
  }

  if (!unit) {
    return (
      <div className={wrap}>
        <div className={card}>
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (done) {
    const s = slot ? new Date(slot.start) : null;
    return (
      <div className={wrap}>
        <div className={card}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-2xl">✓</div>
          <h1 className="mt-4 text-center text-lg font-semibold">Agendamento confirmado!</h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            {unit.unitName}
            {s ? (
              <>
                {" "}·{" "}
                {s.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })} às{" "}
                {s.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </>
            ) : null}
          </p>
          <p className="mt-4 text-center text-xs text-muted-foreground">Você receberá um lembrete pelo WhatsApp.</p>
        </div>
      </div>
    );
  }

  const service = unit.services.find((s) => s.id === serviceId);

  return (
    <div className={wrap}>
      <div className={card}>
        <h1 className="text-lg font-semibold">{unit.unitName}</h1>
        <p className="text-sm text-muted-foreground">Agende seu horário</p>

        {unit.services.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">Nenhum serviço disponível no momento.</p>
        ) : (
          <div className="mt-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Serviço</label>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="input mt-1 w-full">
                {unit.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.duration_min}min)
                  </option>
                ))}
              </select>
            </div>

            {unit.resources.length > 1 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Profissional</label>
                <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} className="input mt-1 w-full">
                  <option value="any">Qualquer disponível</option>
                  {unit.resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground">Dia</label>
              <input type="date" value={date} min={ymd(new Date())} max={maxDate} onChange={(e) => setDate(e.target.value)} className="input mt-1 w-full" />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Horário</label>
              {loadingSlots ? (
                <p className="mt-1 text-xs text-muted-foreground">Buscando horários…</p>
              ) : slots.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">Sem horários livres nesse dia. Tente outro.</p>
              ) : (
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => setSlot(s)}
                      className={
                        "rounded-md border px-2 py-1.5 text-sm " +
                        (slot?.start === s.start ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted")
                      }
                    >
                      {new Date(s.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {slot && (
              <div className="space-y-3 border-t border-border pt-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Seu nome</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="input mt-1 w-full" placeholder="Nome completo" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">WhatsApp (com DDD)</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input mt-1 w-full" placeholder="+55 11 99999-9999" inputMode="tel" />
                </div>
                {/* Honeypot — invisível para humanos. */}
                <input
                  type="text"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="absolute left-[-9999px] h-0 w-0 opacity-0"
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting || !name.trim() || !phone.trim()}
                  className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting ? "Agendando…" : `Confirmar ${service ? service.name : ""}`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
