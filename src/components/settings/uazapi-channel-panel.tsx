'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseApiResponse } from '@/lib/http/api-response';

/** fetch com timeout: um proxy pode segurar a conexão; sem isto o botão fica preso. */
async function fetchWithTimeout(input: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Para o polling ao desmontar ou trocar de unidade.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setQrcode(null);
      setMsg(null);
      loadStatus(unitId);
    }
  }, [unitId, loadStatus]);

  // Polling de status INDEPENDENTE: o QR vem pelo /instance/status (padrão oficial
  // da uazapi — o /instance/connect é long-poll e fica pendente até escanear). Roda
  // sozinho, sem depender da resposta do POST /connect, que pode dar timeout/502.
  const startQrPolling = useCallback((uid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let tries = 0;
    let gotQr = false;
    pollRef.current = setInterval(async () => {
      tries++;
      const cur = await fetch(`/api/whatsapp/uazapi/status?unitId=${encodeURIComponent(uid)}`)
        .then((x) => parseApiResponse<{ status?: string; connected?: boolean; qrcode?: string }>(x))
        .catch(() => null);
      const data = cur?.ok ? cur.data ?? {} : {};
      if (data.status) setStatus(data.status);
      if (data.qrcode && !data.connected) {
        gotQr = true;
        setQrcode(data.qrcode);
        setMsg('Escaneie o QR no WhatsApp do estúdio (Aparelhos conectados).');
      }
      if (data.connected || tries >= 40) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        if (data.connected) {
          setQrcode(null);
          setMsg('Canal conectado! ✅');
        } else if (!gotQr) {
          setMsg('Não foi possível gerar o QR. Clique em Conectar novamente.');
        }
      }
    }, 3000);
  }, []);

  const connect = async () => {
    if (!unitId) return;
    setBusy(true);
    setMsg('Iniciando conexão…');
    setQrcode(null);
    // O poll cuida do QR de forma independente — começa já.
    startQrPolling(unitId);
    try {
      // Dispara o connect para INICIAR a conexão no servidor. A resposta é
      // best-effort: se vier o QR na hora, mostra; se 502/timeout (long-poll),
      // o polling de status cobre. Não bloqueia a UI nesse tempo todo.
      const r = await fetchWithTimeout(
        '/api/whatsapp/uazapi/connect',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ unitId }),
        },
        20_000,
      );
      const p = await parseApiResponse<{ status?: string; qrcode?: string }>(r);
      if (p.ok) {
        const d = p.data ?? {};
        if (d.status) setStatus(d.status);
        if (d.qrcode) {
          setQrcode(d.qrcode);
          setMsg('Escaneie o QR no WhatsApp do estúdio (Aparelhos conectados).');
        } else if (d.status === 'connected') {
          setMsg('Canal conectado! ✅');
        } else {
          setMsg('Gerando o QR… aguarde alguns segundos.');
        }
      }
      // Se !p.ok (ex.: 502 do long-poll), não sobrescreve: o poll está buscando o QR.
    } catch {
      // Timeout/rede no POST: silencioso — o polling de status assume.
    } finally {
      setBusy(false);
    }
  };

  const control = async (action: 'disconnect' | 'reset') => {
    if (!unitId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetchWithTimeout(
        '/api/whatsapp/uazapi/control',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ unitId, action }),
        },
        30_000,
      );
      const p = await parseApiResponse(r);
      if (!p.ok) setMsg(p.error);
      else {
        setMsg(action === 'disconnect' ? 'Desconectado.' : 'Reconectando…');
        loadStatus(unitId);
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      setMsg(aborted ? 'A operação demorou demais. Tente novamente.' : 'Falha de rede. Tente novamente.');
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
