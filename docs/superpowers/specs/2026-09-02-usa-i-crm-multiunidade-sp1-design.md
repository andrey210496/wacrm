# SP1 — USA.i CRM Multiunidade (base wacrm) · Design

- **Documento:** design/spec do Sub-Projeto 1
- **Data:** 2026-09-02
- **Autor:** Andrey Castro (USA.i) + Claude
- **Base:** fork `andrey210496/wacrm` (Next.js 16 + Supabase Postgres)
- **Branch:** `feature/usa-i-multiunidade-sp1`

---

## 1. Contexto e objetivo

A USA.i vendeu o mesmo produto — um **CRM de Gestão de Leads Multiunidade** — para dois
clientes: **X Calotas** (4 hamburguerias) e **Pure Pilates** (5 estúdios). Cada unidade tem
seu próprio número de WhatsApp (API oficial Meta) e sua própria carteira de leads, mas a
**gestão enxerga tudo consolidado num painel só**.

O núcleo do wacrm já entrega ~80% do escopo (inbox WhatsApp Cloud API, contatos, funil
kanban, broadcasts, automações, RBAC owner/admin/agent/viewer, RLS por `account_id`). O
que falta é uma **camada de "unidade"** e o empacotamento **SILO** para deploy no EasyPanel,
mais o **contrato de licença** que o control plane (SP2) vai acionar.

Objetivo do SP1: entregar o produto pronto para subir **uma instância por cliente**, com
multiunidade completo, e deixá-lo capaz de "conversar" com o control plane via um contrato
de licença embutido (stubado inicialmente).

## 2. Escopo do SP1

**Dentro:**
1. Camada de dados de **unidade** (tabela `unidades`, multi-número, `unit_id` nas tabelas operacionais).
2. **RBAC Opção 2**: atendente (`agent`) travado na sua unidade; `owner`/`admin` veem o consolidado.
3. **Roteamento do webhook** número → unidade; carimbo de `unit_id` em conversa/contato/deal.
4. **Painel consolidado** (gestão) + **filtro/seletor de unidade** em toda a operação.
5. **Gestão de unidades** (CRUD nas configurações: criar unidade, conectar número, atribuir atendentes).
6. **Empacote SILO/EasyPanel** (Dockerfile de produção + compose + signup fechado + envs).
7. **Contrato de licença** (gate fail-open + endpoints), stubado/manual até o SP2 existir.

**Fora (vai pro SP2 — control plane):**
- Cadastro de clientes, financeiro/cobrança (Asaas), provisionamento automático de instância,
  bloqueio remoto centralizado, impersonação/suporte central. O SP1 só **expõe** o contrato.

## 3. Decisões travadas (brainstorming)

| Decisão | Escolha |
|---|---|
| Caminho | **A** — adaptar o wacrm (não reescrever) |
| Modelo de unidade | **A2** — unidade = número + carteira DENTRO de uma conta do cliente |
| Permissão | **Opção 2** — atendente travado na unidade; gestão vê consolidado |
| Deploy | **SILO** — 1 instância + 1 DB por cliente, EasyPanel |
| Control plane | App **separado** (SP2), fala via contrato HTTP |

## 4. Modelo de dados

Princípio: a "unidade" é um novo nível **entre** a conta e as linhas operacionais. Uma conta
(o cliente) tem N unidades; cada unidade tem 1 número e sua carteira.

### 4.1 Nova tabela `unidades`
```
unidades (
  id UUID PK,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- "Unidade Centro", "Pinheiros"...
  slug TEXT NOT NULL,               -- único por conta
  active BOOLEAN NOT NULL DEFAULT true,
  created_at, updated_at
)
UNIQUE(account_id, slug)
RLS: SELECT is_account_member(account_id); write admin+
```

### 4.2 `whatsapp_config` ganha `unit_id` (multi-número)
- Adiciona `unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE`.
- **Dropar** `whatsapp_config_account_id_key` (UNIQUE account) → **adicionar** `UNIQUE(unit_id)`
  (um número por unidade). Mantém o `UNIQUE(phone_number_id)` global (webhook usa `.single()`).
- Backfill: instância nova não tem dados; instância existente cria 1 unidade "Matriz" por conta
  e vincula a config atual a ela.

### 4.3 `unit_id` nas tabelas operacionais
Adiciona `unit_id UUID REFERENCES unidades(id)` (NOT NULL após backfill) em:
`contacts`, `conversations`, `deals`, `broadcasts`, `automations`, `flows`.
(Tabelas-filhas herdam pelo join com o pai — não recebem coluna.)

- **Contatos** passam a deduplicar por **`UNIQUE(account_id, unit_id, phone_normalized)`**
  (dropar o índice `(account_id, phone_normalized)` da migração 022 e recriar com `unit_id`).
  Assim o mesmo telefone pode ser lead em duas unidades, cada uma com carteira própria.

### 4.4 RBAC Opção 2 — `profiles.unit_id`
- Adiciona `profiles.unit_id UUID REFERENCES unidades(id)` **nullable**:
  - `owner`/`admin`: `unit_id = NULL` → enxergam **todas** as unidades (consolidado).
  - `agent`/`viewer`: `unit_id = <unidade>` → enxergam **só** aquela unidade.
- Helper novo `can_see_unit(target_account_id, target_unit_id)` (SECURITY DEFINER), composto
  com `is_account_member`:
  ```sql
  -- true se: membro admin+ (vê tudo) OU o unit_id do perfil == target_unit_id
  ```

## 5. RLS

Cada tabela operacional passa de `is_account_member(account_id[, role])` para
`is_account_member(account_id[, role]) AND can_see_unit(account_id, unit_id)`.

- `SELECT`: membro + unidade visível.
- `INSERT/UPDATE/DELETE`: papel mínimo atual **+** unidade visível (agent não escreve fora da sua unidade).
- Tabelas de configuração (tags, pipelines, templates) seguem admin+ e ficam **por conta**
  (compartilhadas entre unidades) — decisão: config é da conta, dados são da unidade.
- Toda mudança de RLS entra como **migration nova** (nunca editar migração já commitada).

## 6. Roteamento do webhook (número → unidade)

`src/app/api/whatsapp/webhook/route.ts` já acha a `whatsapp_config` por `phone_number_id`
via `.single()`. Com `unit_id` na config, o handler:
1. resolve `phone_number_id` → `whatsapp_config` → `unit_id` + `account_id`;
2. faz upsert de contato **escopado por (account_id, unit_id)**;
3. cria/atualiza a conversa carimbando `unit_id`;
4. dispara automações/flows daquela unidade.

Inserts do webhook rodam via service-role (bypassa RLS, como hoje) — o carimbo de `unit_id`
é responsabilidade do código do handler, coberto por teste.

## 7. Painel consolidado + seletor de unidade

- **Seletor de unidade** global (topbar): "Todas as unidades" (só gestão) | unidade X.
  Persistido por sessão; para `agent` é fixo na sua unidade (sem seletor).
- **Dashboard consolidado** (gestão): leads por unidade, funil por unidade, taxa de conversão,
  origem do lead, comparativo entre unidades — robusto (gráficos, drill-down, CSV), não tabela mínima.
- Inbox / contatos / funil / broadcasts respeitam o seletor: "Todas" agrega, unidade filtra.

## 8. Gestão de unidades (configurações)

Nova área em Settings (admin+):
- CRUD de unidade (nome, slug, ativa).
- Conectar número WhatsApp **por unidade** (reusa o fluxo de `whatsapp-config`, agora por unidade).
- Atribuir atendentes a uma unidade (setar `profiles.unit_id`).

## 9. Empacote SILO / EasyPanel

- **1 instância + 1 Postgres por cliente.** Sem `tenant_id` compartilhado (SILO puro).
- **Dockerfile de produção** (reusa/ajusta o existente) + **compose** para EasyPanel (app + envs;
  Postgres é o Supabase/Postgres do cliente).
- **Signup fechado**: registro público desativado; o dono é provisionado (a 1ª conta é o cliente).
  Convites internos (owner→admin/agent) continuam via o fluxo de invitations existente.
- **Envs** documentadas por instância (Supabase URL/keys, ENCRYPTION_KEY, META_APP_SECRET, LICENSE_*).
- Referência de operação: EasyPanel publica em lotes; healthcheck; Let's Encrypt no domínio do cliente.

## 10. Contrato de licença (fail-open, stub)

Objetivo: a instância já nasce "conversável" pelo control plane (SP2), **sem** depender dele para rodar.

- **Gate** `requireLicense()` no boundary admin/servidor: consulta status de licença com **cache**
  e **fail-open** (se a fonte estiver indisponível, mantém ativo com o último valor bom).
- **Fonte de verdade (stub v1):** env/registro local `LICENSE_MODE=manual` + status default `active`.
  Endpoint interno `GET /api/license/status` (estado atual) e `POST /api/license/apply`
  (control plane → instância, autenticado por segredo compartilhado) para setar `active|suspended`.
- **Heartbeat (stub):** `POST` de saúde/uso para o control plane, no-op se `CONTROL_PLANE_URL` ausente.
- Contrato v1 documentado em `docs/contracts/license-v1.md` (consumido pelo SP2).

## 11. Migrations (deltas novos — nunca editar as antigas)

Sequência a partir de `039`:
1. `040_unidades.sql` — tabela `unidades` + RLS + helper `can_see_unit`.
2. `041_whatsapp_config_unit.sql` — `unit_id` na config, troca de UNIQUE, backfill "Matriz".
3. `042_operational_unit_id.sql` — `unit_id` em contacts/conversations/deals/broadcasts/automations/flows + backfill + NOT NULL + índices.
4. `043_contacts_unit_dedup.sql` — troca do índice de dedup para `(account_id, unit_id, phone_normalized)`.
5. `044_profiles_unit_scope.sql` — `profiles.unit_id`.
6. `045_rls_unit_scoping.sql` — reescrita das policies operacionais com `can_see_unit`.
7. `046_license_state.sql` — estado local de licença (se precisar de tabela).

Cada migration idempotente (padrão do repo). Um `ALL_MIGRATIONS`-like não é necessário (o
cliente roda via CLI/Supabase no provisionamento).

## 12. Estratégia de testes

O repo já é fortemente testado (Vitest). Para cada bloco:
- **Migrations/RLS:** teste que um `agent` da unidade A **não** lê linhas da unidade B, e que
  `admin` lê ambas (via cliente Supabase com JWT de cada papel).
- **Webhook:** inbound no número da unidade A cria contato/conversa com `unit_id = A`; dedup
  por unidade (mesmo telefone vira 2 contatos em unidades diferentes).
- **Dashboard consolidado:** agregações por unidade corretas; agent não acessa "Todas".
- **Licença:** gate fail-open (fonte indisponível → mantém último status); `apply` muda status.
- **Build:** `next build` deve passar (tsc não pega tudo — ver histórico de RSC/pg leak).
- Meta de "validado e testado": `npm run test` verde + `next build` verde + smoke manual no dev (3100).

## 13. Premissas (decididas sem consulta, conforme diretriz)

- Config (tags/pipelines/templates) é **por conta**, compartilhada entre unidades; só os **dados**
  (leads/conversas/deals/broadcasts) são por unidade. (Simplicidade; revisável no SP2.)
- `viewer` segue a mesma regra de unidade do `agent` (travado se tiver `unit_id`).
- Backfill em instância existente cria unidade "Matriz" e não perde dados; instância nova nasce vazia.
- Signup público desativado por env; não removemos o código de multi-conta do wacrm (YAGNI reverso),
  apenas operamos 1 conta por instância.
- Contrato de licença v1 é stub (manual); automação real é SP2.

## 14. Saída (o que vem depois)

- `writing-plans` → plano de implementação em fases pequenas (migrations → RLS → webhook →
  UI seletor → dashboard → settings de unidade → SILO/Docker → licença), cada uma com testes.
- `subagent-driven-development` → execução com verificação por fase.
- SP2 (control plane) entra em ciclo próprio depois do SP1 no ar.
