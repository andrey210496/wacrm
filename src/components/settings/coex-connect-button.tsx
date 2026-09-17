'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { parseApiResponse } from '@/lib/http/api-response';

// SDK do Facebook + origem de onde o popup do Embedded Signup posta.
const FB_SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
const FB_MESSAGE_ORIGIN = 'https://www.facebook.com';
const FB_SDK_SCRIPT_ID = 'facebook-jssdk';

interface FBLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}
declare global {
  interface Window {
    FB?: {
      init: (params: Record<string, unknown>) => void;
      login: (cb: (r: FBLoginResponse) => void, params: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type CoexConfig = { appId: string | null; configId: string | null; graphVersion: string; enabled: boolean };

type FinishInfo = { phoneNumberId: string | null; wabaId: string; mode: 'coex' | 'official' };

// Extrai o resultado do popup do Embedded Signup. O EVENTO diz qual caminho o
// usuário escolheu na tela de seleção da Meta:
//  - FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING = coex (conectar app existente);
//    traz só waba_id (phone_number_id é buscado no servidor pela WABA).
//  - FINISH = número novo (oficial); traz phone_number_id + waba_id.
// O modo decide, no servidor, se PULA o /register (coex) ou REGISTRA (oficial).
function parseFinish(data: unknown): FinishInfo | null {
  let obj: unknown = data;
  if (typeof data === 'string') {
    try {
      obj = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const m = obj as { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string } };
  const isCoex = m.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
  const isFinish = m.event === 'FINISH' || isCoex;
  if (m.type !== 'WA_EMBEDDED_SIGNUP' || !isFinish) return null;
  const wa = m.data?.waba_id;
  if (!wa) return null;
  return { phoneNumberId: m.data?.phone_number_id ?? null, wabaId: wa, mode: isCoex ? 'coex' : 'official' };
}

/**
 * Botão de conexão Coexistence (o próprio cliente conecta o número mantendo o
 * app WhatsApp Business). Carrega o FB SDK com o config_id de coex, escuta o
 * FINISH do popup (validando origem) e posta code+número em /api/whatsapp/coex/connect.
 */
export function CoexConnectButton({
  unitId,
  onConnected,
}: {
  unitId: string | null;
  onConnected?: () => void;
}) {
  const [config, setConfig] = useState<CoexConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sessionInfoRef = useRef<FinishInfo>({ phoneNumberId: null, wabaId: '', mode: 'official' });

  // Config pública (runtime) + SDK.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/whatsapp/coex/config')
      .then((r) => r.json())
      .then((c: CoexConfig) => {
        if (cancelled) return;
        setConfig(c);
        if (!c.enabled || !c.appId) return;
        const init = () => window.FB?.init({ appId: c.appId, version: c.graphVersion, xfbml: false, cookie: true });
        if (window.FB) init();
        else {
          window.fbAsyncInit = init;
          if (!document.getElementById(FB_SDK_SCRIPT_ID)) {
            const s = document.createElement('script');
            s.id = FB_SDK_SCRIPT_ID;
            s.src = FB_SDK_SRC;
            s.async = true;
            s.defer = true;
            s.crossOrigin = 'anonymous';
            document.body.appendChild(s);
          }
        }
      })
      .catch(() => {
        /* botão fica oculto se a config não vier */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ouve as mensagens do popup (só da origem do Facebook).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== FB_MESSAGE_ORIGIN) return;
      const fin = parseFinish(event.data);
      if (fin) sessionInfoRef.current = fin;
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleClick = useCallback(() => {
    if (!unitId) {
      toast.error('Selecione a unidade antes de conectar.');
      return;
    }
    if (!window.FB || !config?.configId) {
      toast.error('Conexão com o Facebook indisponível.');
      return;
    }
    sessionInfoRef.current = { phoneNumberId: null, wabaId: '', mode: 'official' };
    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          toast.message('Conexão cancelada.');
          return;
        }
        const { phoneNumberId, wabaId, mode } = sessionInfoRef.current;
        // No coex só vem o waba_id; o phone_number_id é resolvido no servidor.
        if (!wabaId) {
          toast.error('Não recebemos os dados da conta. Tente novamente.');
          return;
        }
        void (async () => {
          try {
            setSubmitting(true);
            const res = await fetch('/api/whatsapp/coex/connect', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code, phone_number_id: phoneNumberId ?? undefined, waba_id: wabaId, unitId, mode }),
            });
            const p = await parseApiResponse<{
              mode?: string;
              registerPin?: string | null;
              registrationError?: string | null;
            }>(res);
            if (p.ok) {
              if (p.data?.mode === 'official' && p.data?.registrationError) {
                // Credenciais salvas, mas o /register falhou → número fica pendente.
                toast.error(
                  `Número salvo, mas o registro na Meta falhou: ${p.data.registrationError}. Ele fica PENDENTE. Tente reconectar.`,
                  { duration: 14000 },
                );
              } else if (p.data?.mode === 'official' && p.data?.registerPin) {
                toast.success(
                  `Número conectado! Guarde o PIN de duas etapas deste número: ${p.data.registerPin} (não será exibido de novo).`,
                  { duration: 15000 },
                );
              } else if (p.data?.mode === 'official') {
                toast.success('Número conectado (oficial)!');
              } else {
                toast.success('Número conectado (coex)! Sincronizando contatos e histórico (pode levar minutos).');
              }
              onConnected?.();
            } else {
              toast.error(p.error);
            }
          } catch {
            toast.error('Erro de rede ao conectar.');
          } finally {
            setSubmitting(false);
          }
        })();
      },
      {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        // Coexistence: o VALOR correto do featureType é 'coexistence' (conectar
        // número existente) — NÃO 'whatsapp_business_app_onboarding' (valor que a
        // doc mostrava e não funciona). Confirmado num sistema em produção com o
        // mesmo app. sessionInfoVersion 3 = session logging (o listener pega o waba_id).
        extras: { setup: {}, featureType: 'coexistence', sessionInfoVersion: '3' },
      },
    );
  }, [unitId, config, onConnected]);

  // Sem config/flag → não renderiza (fica só o token manual).
  if (!config || !config.enabled) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={submitting || !unitId}
      className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      style={{ background: '#1877F2' }}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
        <path d="M24 12c0-6.627-5.373-12-12-12S0 5.373 0 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078V12h3.047V9.356c0-3.007 1.792-4.668 4.533-4.668 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.469h-2.796v8.385C19.612 22.954 24 17.99 24 12z" />
      </svg>
      {submitting ? 'Conectando…' : 'Conectar com o Facebook'}
    </button>
  );
}
