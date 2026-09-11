'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Unit = { id: string; name: string };

const STATUS_LABEL: Record<string, string> = {
  connected: 'Conectado',
  connecting: 'Conectando…',
  disconnected: 'Desconectado',
  hibernated: 'Hibernado',
  not_provisioned: 'Não conectado',
  unknown: '—',
};

/**
 * Painel do canal uazapi (não-oficial), por unidade. Self-service: o admin
 * escolhe o estúdio, clica Conectar, escaneia o QR (a central cria a instância
 * uazapi + seta o webhook sozinha), e acompanha o status. Reconectar/desconectar
 * também. Só ADMIN+ (as rotas devolvem 403 aos demais → o painel se esconde).
 */
export function UazapiChannelPanel() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [status, setStatus] = useState<string>('unknown');
  const [qrcode, setQrcode] = useState<string | null>(null);
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

  const loadStatus = useCallback(async (uid: string) => {
    if (!uid) return;
    try {
      const r = await fetch(`/api/whatsapp/uazapi/status?unitId=${encodeURIComponent(uid)}`);
      if (r.status === 403) {
        setHidden(true);
        return;
      }
      const d = await r.json();
      if (r.ok) setStatus(d.status ?? 'unknown');
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    if (unitId) {
      setQrcode(null);
      setMsg(null);
      loadStatus(unitId);
    }
  }, [unitId, loadStatus]);

  const connect = async () => {
    if (!unitId) return;
    setBusy(true);
    setMsg(null);
    setQrcode(null);
    try {
      const r = await fetch('/api/whatsapp/uazapi/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unitId }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error || 'Falha ao conectar.');
        return;
      }
      setStatus(d.status ?? 'connecting');
      if (d.qrcode) {
        setQrcode(d.qrcode);
        setMsg('Escaneie o QR no WhatsApp do estúdio (Aparelhos conectados).');
      } else {
        setMsg('Conectado (sem QR — já estava pareado).');
      }
      // Poll de status por até ~60s.
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        await loadStatus(unitId);
        const cur = await fetch(`/api/whatsapp/uazapi/status?unitId=${encodeURIComponent(unitId)}`)
          .then((x) => x.json())
          .catch(() => ({}));
        if (cur.connected || tries >= 20) {
          clearInterval(poll);
          if (cur.connected) {
            setQrcode(null);
            setMsg('Canal conectado! ✅');
          }
        }
      }, 3000);
    } catch {
      setMsg('Erro de rede ao conectar.');
    } finally {
      setBusy(false);
    }
  };

  const control = async (action: 'disconnect' | 'reset') => {
    if (!unitId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/whatsapp/uazapi/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unitId, action }),
      });
      const d = await r.json();
      if (!r.ok) setMsg(d.error || 'Falha.');
      else {
        setMsg(action === 'disconnect' ? 'Desconectado.' : 'Reconectando…');
        loadStatus(unitId);
      }
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;

  return (
    <div className="mt-8 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Canal RedeZap (uazapi) — por unidade
        </h3>
        <span className="text-xs text-muted-foreground">
          Status: <span className="font-medium text-foreground">{STATUS_LABEL[status] ?? status}</span>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Canal não-oficial (envio livre, sem template). Use com parcimônia — há
        risco de bloqueio do número pela Meta. A conexão é criada e gerenciada
        aqui mesmo.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <select
          className="input"
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
        >
          <option value="" disabled>
            Selecione o estúdio
          </option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-brand text-xs"
            onClick={connect}
            disabled={busy || !unitId}
          >
            {busy ? '…' : status === 'connected' ? 'Reconectar (QR)' : 'Conectar'}
          </button>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => control('reset')}
            disabled={busy || !unitId}
          >
            Reiniciar
          </button>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => control('disconnect')}
            disabled={busy || !unitId}
          >
            Desconectar
          </button>
        </div>
      </div>

      {qrcode && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {/* QR em data: URL (permitido pela CSP img-src data:). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrcode} alt="QR de conexão" className="h-56 w-56 rounded-lg border border-border bg-white p-2" />
          <p className="text-[11px] text-muted-foreground">
            WhatsApp do estúdio → Aparelhos conectados → Conectar aparelho.
          </p>
        </div>
      )}

      {msg && <p className="mt-3 text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
