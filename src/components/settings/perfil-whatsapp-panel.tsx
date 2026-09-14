'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseApiResponse } from '@/lib/http/api-response';
import { VERTICALS } from '@/lib/whatsapp/profile-validate';

type Unit = { id: string; name: string };

type Profile = {
  about?: string;
  description?: string;
  email?: string;
  address?: string;
  vertical?: string;
  websites?: string[];
  profile_picture_url?: string;
};

// Rótulos PT-BR das verticais da Meta (o value é o enum cru enviado à API).
const VERTICAL_LABEL: Record<string, string> = {
  UNDEFINED: 'Não definida',
  OTHER: 'Outra',
  AUTO: 'Automotivo',
  BEAUTY: 'Beleza / estética',
  APPAREL: 'Moda / vestuário',
  EDU: 'Educação',
  ENTERTAIN: 'Entretenimento',
  EVENT_PLAN: 'Eventos',
  FINANCE: 'Finanças',
  GROCERY: 'Mercado / alimentos',
  GOVT: 'Governo',
  HOTEL: 'Hotelaria',
  HEALTH: 'Saúde / bem-estar',
  NONPROFIT: 'ONG / sem fins lucrativos',
  PROF_SERVICES: 'Serviços profissionais',
  RETAIL: 'Varejo',
  TRAVEL: 'Viagens',
  RESTAURANT: 'Restaurante',
  NOT_A_BIZ: 'Não é empresa',
};

/**
 * Painel "Perfil do WhatsApp Business" (Frente 3), por unidade. Só ADMIN+ (a
 * rota devolve 403 aos demais → o painel se esconde). Lê/edita o perfil direto
 * na Meta: foto, sobre, descrição, email, sites, endereço, categoria. Bloco de
 * username aparece só quando a flag PROFILE_USERNAME_ENABLED está ligada.
 */
export function PerfilWhatsappPanel() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [hidden, setHidden] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Aviso quando a unidade não tem número conectado / token / erro Meta.
  const [notice, setNotice] = useState<string | null>(null);
  // Só habilita salvar/foto/username quando o perfil carregou de fato — evita
  // que um save com campos vazios (por falha de leitura) LIMPE o perfil na Meta.
  const [loadedOk, setLoadedOk] = useState(false);

  // Campos editáveis.
  const [about, setAbout] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [vertical, setVertical] = useState('');
  const [site1, setSite1] = useState('');
  const [site2, setSite2] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // Foto.
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Username (atrás de flag).
  const [usernameEnabled, setUsernameEnabled] = useState(false);
  const [username, setUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState<string | null>(null);

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

  const applyProfile = useCallback((p: Profile) => {
    setAbout(p.about ?? '');
    setDescription(p.description ?? '');
    setEmail(p.email ?? '');
    setAddress(p.address ?? '');
    setVertical(p.vertical ?? '');
    const ws = p.websites ?? [];
    setSite1(ws[0] ?? '');
    setSite2(ws[1] ?? '');
    setPhotoUrl(p.profile_picture_url ?? null);
  }, []);

  const load = useCallback(
    async (uid: string) => {
      if (!uid) return;
      setLoading(true);
      setMsg(null);
      setNotice(null);
      setLoadedOk(false);
      try {
        const r = await fetch(`/api/whatsapp/profile?unitId=${encodeURIComponent(uid)}`);
        if (r.status === 403) {
          setHidden(true);
          return;
        }
        const p = await parseApiResponse<{
          connected?: boolean;
          profile?: Profile;
          message?: string;
          username_enabled?: boolean;
          username?: string | null;
          username_status?: string | null;
        }>(r);
        const d = p.data ?? {};
        setUsernameEnabled(!!d.username_enabled);
        setCurrentUsername(d.username ?? null);
        setUsernameStatus(d.username_status ?? null);
        setUsername(d.username ?? '');
        if (p.ok && d.connected && d.profile) {
          applyProfile(d.profile);
          setLoadedOk(true);
        } else {
          // 200 com connected:false (sem número / token / erro Meta) traz message.
          applyProfile({});
          setNotice(d.message ?? p.error ?? 'Não foi possível carregar o perfil.');
        }
      } catch {
        setNotice('Falha de rede ao carregar o perfil.');
      } finally {
        setLoading(false);
      }
    },
    [applyProfile],
  );

  useEffect(() => {
    if (unitId) load(unitId);
  }, [unitId, load]);

  // Junta os dois sites, descartando vazios (a Meta aceita até 2).
  function websitesPayload(): string[] {
    return [site1.trim(), site2.trim()].filter(Boolean);
  }

  const save = async () => {
    if (!unitId) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch('/api/whatsapp/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          unitId,
          fields: {
            about: about.trim(),
            description: description.trim(),
            email: email.trim(),
            address: address.trim(),
            vertical: vertical || '',
            websites: websitesPayload(),
          },
        }),
      });
      const p = await parseApiResponse(r);
      setMsg(p.ok ? 'Perfil salvo. ✅' : p.error);
      if (p.ok) await load(unitId);
    } catch {
      setMsg('Falha de rede ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const onPickPhoto = async (file: File) => {
    if (!unitId) return;
    setUploadingPhoto(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('unitId', unitId);
      fd.append('file', file);
      const r = await fetch('/api/whatsapp/profile/photo', { method: 'POST', body: fd });
      const p = await parseApiResponse(r);
      setMsg(p.ok ? 'Foto atualizada. ✅' : p.error);
      if (p.ok) await load(unitId);
    } catch {
      setMsg('Falha de rede ao enviar a foto.');
    } finally {
      setUploadingPhoto(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveUsername = async () => {
    if (!unitId) return;
    setSavingUsername(true);
    setUsernameMsg(null);
    try {
      const r = await fetch('/api/whatsapp/profile/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unitId, username: username.trim() }),
      });
      const p = await parseApiResponse(r);
      setUsernameMsg(p.ok ? 'Username definido. ✅' : p.error);
      if (p.ok) await load(unitId);
    } catch {
      setUsernameMsg('Falha de rede ao definir o username.');
    } finally {
      setSavingUsername(false);
    }
  };

  if (hidden) return null;

  return (
    <div className="mt-8 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Perfil do WhatsApp Business</h3>
        <span className="text-xs text-muted-foreground">por unidade</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Foto, sobre, descrição, e-mail, sites, endereço e categoria — editados direto na
        Meta, sem abrir o Meta Business. As mudanças aparecem para os clientes no
        WhatsApp.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="" disabled>
            Selecione a unidade
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
          {notice && (
            <p className="rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              {notice}
            </p>
          )}

          {loading ? (
            <p className="text-xs text-muted-foreground">Carregando perfil…</p>
          ) : (
            <>
              {/* Foto */}
              <div className="flex items-center gap-4">
                <div className="size-16 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt="Foto do perfil" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                      sem foto
                    </div>
                  )}
                </div>
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onPickPhoto(f);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploadingPhoto || !loadedOk}
                  >
                    {uploadingPhoto ? 'Enviando…' : 'Trocar foto'}
                  </button>
                  <p className="mt-1 text-[11px] text-muted-foreground">JPEG ou PNG, até 5 MB.</p>
                </div>
              </div>

              {/* Campos */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-foreground">Sobre</label>
                  <input
                    className="input mt-1"
                    value={about}
                    maxLength={139}
                    onChange={(e) => setAbout(e.target.value)}
                    placeholder="Frase curta que aparece no topo do perfil"
                  />
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{about.length}/139</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground">Descrição</label>
                  <textarea
                    className="input mt-1 min-h-[72px]"
                    value={description}
                    maxLength={512}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrição do negócio"
                  />
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{description.length}/512</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-foreground">E-mail</label>
                    <input
                      className="input mt-1"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="contato@empresa.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground">Categoria</label>
                    <select className="input mt-1" value={vertical} onChange={(e) => setVertical(e.target.value)}>
                      <option value="">Selecione…</option>
                      {VERTICALS.map((v) => (
                        <option key={v} value={v}>
                          {VERTICAL_LABEL[v] ?? v}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground">Endereço</label>
                  <input
                    className="input mt-1"
                    value={address}
                    maxLength={256}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Rua, número, cidade"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-foreground">Site 1</label>
                    <input
                      className="input mt-1"
                      value={site1}
                      onChange={(e) => setSite1(e.target.value)}
                      placeholder="https://…"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground">Site 2</label>
                    <input
                      className="input mt-1"
                      value={site2}
                      onChange={(e) => setSite2(e.target.value)}
                      placeholder="https://…"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button type="button" className="btn btn-brand text-xs" onClick={save} disabled={saving || !loadedOk}>
                  {saving ? '…' : 'Salvar perfil'}
                </button>
                {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
              </div>

              {/* Username (só com a flag ligada) */}
              {usernameEnabled && (
                <div className="mt-2 rounded-lg border border-border bg-muted/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xs font-semibold text-foreground">Username do WhatsApp</h4>
                    {currentUsername && (
                      <span
                        className={
                          'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ' +
                          (usernameStatus === 'approved'
                            ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300'
                            : 'border-amber-700/50 bg-amber-950/30 text-amber-300')
                        }
                      >
                        @{currentUsername}
                        {usernameStatus ? ` · ${usernameStatus === 'approved' ? 'ativo' : 'reservado'}` : ''}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Letras minúsculas (a-z), números, ponto e underscore; de 3 a 30 caracteres.
                    &quot;Reservado&quot; fica visível aos clientes quando a Meta liberar o recurso.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      className="input max-w-xs"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="ex.: pure.pilates_sp"
                    />
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      onClick={saveUsername}
                      disabled={savingUsername || !loadedOk}
                    >
                      {savingUsername ? '…' : 'Reservar / definir'}
                    </button>
                  </div>
                  {usernameMsg && <p className="mt-2 text-xs text-muted-foreground">{usernameMsg}</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
