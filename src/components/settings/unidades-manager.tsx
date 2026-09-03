'use client';

// ============================================================
// UnidadesManager — Settings → Unidades
//
// Manage the account's units ("unidades"). One account has N units;
// each owns its own WhatsApp number and lead pool (migrations 040-046).
//
// Role-gating (mirrors ApiKeysSettings / MembersTab)
//   Any member can READ the list (RLS `unidades_select`). Create /
//   rename / toggle / delete are admin+ only — gated here by
//   `canEditSettings` and by the API routes + RLS on the server. A
//   non-admin sees the roster read-only with no mutation controls.
//
// Guards surfaced from the API
//   POST 409 → duplicate slug (shown inline under the create field).
//   DELETE 409 → last unit / connected number (shown as a toast with
//   the server's own message, e.g. "disconnect the number first").
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Building2,
  Check,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { SettingsPanelHead } from './settings-panel-head';

interface Unit {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  created_at?: string;
}

/** phone_number_id + registration state for a unit's connected number. */
interface UnitNumber {
  phone_number_id: string;
  registered: boolean;
}

export function UnidadesManager() {
  const { accountId, canEditSettings } = useAuth();
  const supabase = createClient();

  const [units, setUnits] = useState<Unit[]>([]);
  const [numberByUnit, setNumberByUnit] = useState<Record<string, UnitNumber>>(
    {},
  );
  const [loading, setLoading] = useState(true);

  // Create
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Inline rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  // Active toggle
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Delete
  const [deleting, setDeleting] = useState<Unit | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/unidades', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Falha ao carregar unidades');
        return;
      }
      const data = (await res.json()) as { units: Unit[] };
      setUnits(data.units ?? []);

      // Which units have a WhatsApp number connected? Read straight off
      // the table (RLS scopes admins to their account's rows). Powers the
      // "connected number" indicator + the disconnect-before-delete hint.
      if (accountId) {
        const { data: rows, error } = await supabase
          .from('whatsapp_config')
          .select('unit_id, phone_number_id, registered_at')
          .eq('account_id', accountId);
        if (error) {
          console.error('[UnidadesManager] config rows load error:', error);
        }
        const map: Record<string, UnitNumber> = {};
        for (const r of (rows ?? []) as {
          unit_id: string | null;
          phone_number_id: string | null;
          registered_at: string | null;
        }[]) {
          if (r.unit_id && r.phone_number_id) {
            map[r.unit_id] = {
              phone_number_id: r.phone_number_id,
              registered: Boolean(r.registered_at),
            };
          }
        }
        setNumberByUnit(map);
      }
    } catch (err) {
      console.error('[UnidadesManager] load error:', err);
      toast.error('Não foi possível carregar as unidades');
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    const name = newName.trim();
    setCreateError(null);
    if (!name) {
      setCreateError('Informe um nome para a unidade.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/unidades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 = duplicate slug — surface inline under the field rather
        // than a transient toast so the admin can just fix the name.
        setCreateError(data.error || 'Falha ao criar a unidade');
        return;
      }
      setNewName('');
      setUnits((prev) => [...prev, data.unit as Unit]);
      toast.success(`Unidade "${(data.unit as Unit).name}" criada.`);
    } catch (err) {
      console.error('[UnidadesManager] create error:', err);
      setCreateError('Não foi possível criar a unidade');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(u: Unit) {
    setEditingId(u.id);
    setEditName(u.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
  }

  async function handleRename(u: Unit) {
    const name = editName.trim();
    if (!name || name === u.name) {
      cancelEdit();
      return;
    }
    setSavingId(u.id);
    try {
      const res = await fetch(`/api/unidades/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Falha ao renomear a unidade');
        return;
      }
      setUnits((prev) =>
        prev.map((x) => (x.id === u.id ? (data.unit as Unit) : x)),
      );
      cancelEdit();
      toast.success('Unidade renomeada.');
    } catch (err) {
      console.error('[UnidadesManager] rename error:', err);
      toast.error('Não foi possível renomear a unidade');
    } finally {
      setSavingId(null);
    }
  }

  async function handleToggleActive(u: Unit, next: boolean) {
    setTogglingId(u.id);
    // Optimistic — flip immediately, revert on failure.
    setUnits((prev) =>
      prev.map((x) => (x.id === u.id ? { ...x, active: next } : x)),
    );
    try {
      const res = await fetch(`/api/unidades/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUnits((prev) =>
          prev.map((x) => (x.id === u.id ? { ...x, active: u.active } : x)),
        );
        toast.error(data.error || 'Falha ao atualizar a unidade');
        return;
      }
      setUnits((prev) =>
        prev.map((x) => (x.id === u.id ? (data.unit as Unit) : x)),
      );
    } catch (err) {
      console.error('[UnidadesManager] toggle error:', err);
      setUnits((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, active: u.active } : x)),
      );
      toast.error('Não foi possível atualizar a unidade');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeletePending(true);
    try {
      const res = await fetch(`/api/unidades/${deleting.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 guards: last unit / connected number. Surface the server's
        // own message so the admin knows exactly what to do first.
        toast.error(data.error || 'Falha ao excluir a unidade', {
          duration: 8000,
        });
        setDeleting(null);
        return;
      }
      setUnits((prev) => prev.filter((x) => x.id !== deleting.id));
      toast.success(`Unidade "${deleting.name}" excluída.`);
      setDeleting(null);
    } catch (err) {
      console.error('[UnidadesManager] delete error:', err);
      toast.error('Não foi possível excluir a unidade');
    } finally {
      setDeletePending(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="Unidades"
          description="Gerencie as unidades da sua conta. Cada unidade tem o seu próprio número de WhatsApp e carteira de leads."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Unidades"
        description="Gerencie as unidades da sua conta. Cada unidade tem o seu próprio número de WhatsApp e carteira de leads."
      />

      {/* Create — admin+ only */}
      {canEditSettings && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Label className="text-muted-foreground">Nova unidade</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={newName}
                placeholder="Ex.: Unidade Centro"
                maxLength={80}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (createError) setCreateError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !creating) handleCreate();
                }}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <Button onClick={handleCreate} disabled={creating} className="shrink-0">
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Criar unidade
              </Button>
            </div>
            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Roster */}
      <Card>
        <CardContent className="p-0">
          {units.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Building2 className="size-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhuma unidade ainda.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {units.map((u) => {
                const number = numberByUnit[u.id];
                const isEditing = editingId === u.id;
                const isSaving = savingId === u.id;
                return (
                  <li
                    key={u.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editName}
                            autoFocus
                            maxLength={80}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(u);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            className="h-8 max-w-xs bg-muted border-border text-foreground"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRename(u)}
                            disabled={isSaving}
                            className="border-border"
                          >
                            {isSaving ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelEdit}
                            disabled={isSaving}
                            className="border-border"
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {u.name}
                          </span>
                          {!u.active && (
                            <Badge className="border-border bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
                              Inativa
                            </Badge>
                          )}
                        </div>
                      )}
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        <code>{u.slug}</code>
                        {' · '}
                        {number ? (
                          <span
                            className={
                              number.registered
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                            }
                          >
                            Número {number.phone_number_id}
                            {number.registered ? '' : ' (não registrado)'}
                          </span>
                        ) : (
                          'Sem número conectado'
                        )}
                      </p>
                    </div>

                    {/* Actions — admin+ only. Read-only for everyone else. */}
                    {canEditSettings && !isEditing && (
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={u.active}
                            onCheckedChange={(v) => handleToggleActive(u, v)}
                            disabled={togglingId === u.id}
                            aria-label="Unidade ativa"
                          />
                          <span className="text-xs text-muted-foreground">
                            Ativa
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(u)}
                          className="border-border text-muted-foreground hover:text-foreground"
                          aria-label="Renomear unidade"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleting(u)}
                          className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                          aria-label="Excluir unidade"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-amber-400" />
              Excluir unidade
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Excluir <strong>{deleting?.name}</strong> remove todos os
              dados vinculados a ela (contatos, conversas, negócios).
              Desative/desconecte o número antes de excluir. Não é possível
              excluir a única unidade.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deletePending}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deletePending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Excluindo
                </>
              ) : (
                'Excluir'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
