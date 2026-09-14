'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseApiResponse } from '@/lib/http/api-response';

type Unit = { id: string; name: string };
type Mode = 'auto' | 'always' | 'template_only';

const MODE_LABEL: Record<Mode, string> = {
  auto: 'Automático (segue a Meta)',
  always: 'Tratar tudo como cobrável',
  template_only: 'Só templates',
};

/**
 * Painel da "Conexão redezap" (canal híbrido por custo), por unidade. Só ADMIN+
 * (a rota devolve 403 aos demais → o painel se esconde). Entrada é sempre
 * oficial; uma % da SAÍDA cobrável vai pela uazapi (R$0 Meta), com fail-safe.
 */
export function ConexaoRedezapPanel() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [pct, setPct] = useState(0);
  const [mode, setMode] = useState<Mode>('auto');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    createClient()
      .from('unidades')
      .select('id, name')
      .eq('active', true)
      .order('created_at')
      .then(({ data }) => {
        if (data) setUnits(data as Unit[]);
      });
  }, []);

  const load = useCallback(async (uid: string) => {
    if (!uid) return;
    setMsg(null);
    try {
      const r = await fetch(`/api/channels/hybrid?unitId=${encodeURIComponent(uid)}`);
      if (r.status === 403) {
        setHidden(true);
        return;
      }
      const p = await parseApiResponse<{ hybridEnabled?: boolean; uazapiPct?: number; billableMode?: Mode }>(r);
      if (p.ok) {
        const d = p.data ?? {};
        setEnabled(!!d.hybridEnabled);
        setPct(typeof d.uazapiPct === 'number' ? d.uazapiPct : 0);
        setMode((d.billableMode as Mode) ?? 'auto');
      }
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    if (unitId) load(unitId);
  }, [unitId, load]);

  const save = async () => {
    if (!unitId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/channels/hybrid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unitId, hybridEnabled: enabled, uazapiPct: pct, billableMode: mode }),
      });
      const p = await parseApiResponse(r);
      setMsg(p.ok ? 'Salvo. ✅' : p.error);
    } catch {
      setMsg('Falha de rede ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;

  return (
    <div className="mt-8 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Conexão redezap — híbrido por custo</h3>
        <span className="text-xs text-muted-foreground">por unidade</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Entrada sempre pelo oficial. Uma <b>% da saída cobrável</b> sai pela uazapi
        (R$0 Meta), intercalada. Se a uazapi cair, a fatia volta pro oficial
        automaticamente (fail-safe). ⚠️ Misturar oficial + não-oficial no mesmo número
        tem risco de bloqueio pela Meta — comece com % baixo.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="" disabled>
            Selecione o estúdio
          </option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {unitId && (
        <div className="mt-4 space-y-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Ativar Conexão redezap para esta unidade
          </label>

          <div className={enabled ? '' : 'pointer-events-none opacity-50'}>
            <label className="block text-xs font-medium text-foreground">
              % da saída cobrável via uazapi: <span className="font-semibold">{pct}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="mt-2 w-full"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Saída: <b>{pct}% uazapi</b> / <b>{100 - pct}% oficial</b> (só nas cobráveis).
            </p>

            <label className="mt-4 block text-xs font-medium text-foreground">Modo de cobrança</label>
            <select className="input mt-1" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              {(Object.keys(MODE_LABEL) as Mode[]).map((k) => (
                <option key={k} value={k}>
                  {MODE_LABEL[k]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Automático segue a doc da Meta (service messages viram cobráveis em 01/10/2026).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" className="btn btn-brand text-xs" onClick={save} disabled={busy}>
              {busy ? '…' : 'Salvar'}
            </button>
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
