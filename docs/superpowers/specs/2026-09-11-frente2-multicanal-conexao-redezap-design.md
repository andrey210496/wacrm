# Frente 2 — Multi-canal + "Conexão redezap" (híbrido por custo)

Data: 2026-09-11
Status: DESIGN aprovado (aguardando build). Depende da Frente 1 (uazapi via Gestão USAI), já no ar.
Repos: `wacrm` (instância — roteamento/envio/UI) + `gestao-usai` (central — envio uazapi).

## 1. Objetivo

Dar ao RedeZap um **segundo canal de envio** (uazapi, não-oficial, R$0 Meta) e um **modo híbrido "Conexão redezap"**: **entrada sempre oficial (Coex/Cloud API)**; **saída dividida por %** entre uazapi e oficial, aplicada **só nas mensagens cobráveis**, para **economizar custo de mensageria**. Com **override por envio/automação** e **fail-safe** (se a uazapi cair, a fatia volta pro oficial, sem dropar mensagem).

## 2. Fundamento de cobrança (doc oficial da Meta — verificado na fonte)

Fonte: [Pricing — non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages) e [Pricing](https://developers.facebook.com/docs/whatsapp/pricing). (Regra permanente: Meta = sempre doc oficial, nunca memória.)

- **Até 30/09/2026:** cobrável = **template** (marketing/utility/auth entregues; utility dentro da janela ainda grátis até 01/10). Texto/mídia livre (*service*) = **grátis**.
- **A partir de 01/10/2026:** **service messages (não-template) passam a ser cobradas por mensagem**, à mesma tarifa de utility/auth do país, **sem franquia grátis e sem tiers de volume**. Ou seja: **praticamente toda saída oficial vira cobrável**.
- **Brasil:** entrega Meta ≈ **US$0,0068/msg (~R$0,037–0,04)** — bate com a base de R$0,04 do operador.
- 72h de free entry point (anúncios) continua, mas só para template.

**Implicação:** o "detector de cobrável" no envio é **date-aware** (vira sozinho em 01/10/2026) — e a economia da uazapi cresce muito a partir dessa data (texto/mídia livre também custam). A cobrança REAL continua vindo depois no webhook de status (`pricing.billable`) — o detector no envio é só heurística de roteamento; a fonte da verdade do custo é o webhook (Feature C / Frente 4).

## 3. Arquitetura (visão)

```
Envio (sendMessageToConversation)
      │
      ▼
[Roteador de saída]  ── decisão pura ──►  official | uazapi
      │  (híbrido? tipo elegível? cobrável(date-aware)? % intercalado? override?)
      │
      ├─ official ─► Meta Cloud API (fluxo atual)         → persiste channel='official'
      │
      └─ uazapi ──► central POST /api/instances/uazapi/send → persiste channel='uazapi'
                     (erro? → FAIL-SAFE: cai pro official)
```

- **Entrada nunca passa pelo roteador** — inbound é sempre oficial/Coex (nada muda no inbound).
- **Tokens da uazapi vivem só na central** — a instância NUNCA fala direto com a uazapi; envia via central (igual ao connect/status da Frente 1).

## 4. Componentes

### 4.1 Roteador de saída (puro/testável) — `wacrm/src/lib/whatsapp/outbound-router.ts`

Funções puras (sem I/O), 100% testáveis:

```ts
type BillableMode = 'auto' | 'always' | 'template_only';
type Channel = 'official' | 'uazapi';
type Override = 'auto' | 'official' | 'uazapi';

// Tipos que a uazapi consegue enviar (texto/mídia; template vira texto).
// Interativo/botões NUNCA (uazapi não tem interativo nativo).
function isUazapiEligibleType(messageType: string): boolean; // text|image|video|document|audio|template → true; interactive → false

// Detector de cobrável no ENVIO (date-aware + override de modo).
function isBillableAtSend(p: {
  messageType: string; windowOpen: boolean; now: Date; mode: BillableMode;
}): boolean;
// mode 'always'  → true
// mode 'template_only' → messageType === 'template'
// mode 'auto' (doc-fiel):
//   template → true (heurística segura; utility-in-window pré-01/10 é o único falso-positivo, tolerável p/ roteamento)
//   não-template → now >= 2026-10-01T00:00:00 (antes: grátis; depois: cobrável)

// Distribuição INTERCALADA (Bresenham) — exatamente `pct` a cada 100, espalhado.
function shouldUseUazapi(counter: number, pct: number): boolean;
// = Math.floor((counter+1)*pct/100) - Math.floor(counter*pct/100) === 1
// pct=0 → nunca; pct=100 → sempre; pct=30 → 30 espalhados a cada 100 (não um bloco).

// Decisão final (pura). `uazapiHealthy` é dica opcional; o fail-safe REAL é no executor.
function chooseChannel(p: {
  hybridEnabled: boolean; uazapiPct: number; billableMode: BillableMode;
  messageType: string; windowOpen: boolean; now: Date;
  hasPhone: boolean; counter: number; override: Override;
}): { channel: Channel; consumeCounter: boolean };
```

Regras de `chooseChannel`:
1. `override === 'official'` → official (não consome contador).
2. `override === 'uazapi'` → uazapi **se** `isUazapiEligibleType && hasPhone`, senão official.
3. `!hybridEnabled` → official.
4. `!isUazapiEligibleType(messageType)` (ex.: interactive) → official.
5. `!hasPhone` (contato só-BSUID/username — uazapi/WhatsApp-Web precisa de número) → official.
6. `!isBillableAtSend(...)` (mensagem grátis) → official (sem economia + menos risco no canal não-oficial).
7. Chegou aqui = cobrável+elegível+híbrido → **consome contador**; `shouldUseUazapi(counter, pct) ? uazapi : official`.

`consumeCounter=true` só no passo 7 (a distribuição é sobre a população cobrável-elegível).

### 4.2 Envio uazapi via central — `gestao-usai`

- **Rota nova** `POST /api/instances/uazapi/send` (auth `x-license-secret`):
  - body: `{ unitLabel, to (E.164), type: 'text'|'media', text?, mediaKind?, mediaUrl?, filename? }`.
  - resolve instância pelo segredo → `UazapiConnection(instanceId, unitLabel)` → decripta token → `sendText`/`sendMedia` (client da Frente 1).
  - devolve `{ ok, messageId }`. Erro (token morto/instância off) → 502 com mensagem (a instância cai pro fail-safe).
  - **NÃO** auto-cura aqui (auto-cura é do connect); no send, falha → fail-safe pro oficial.
- **`provision.ts`**: `sendUnit({ instanceId, unitLabel, to, type, text, mediaKind, mediaUrl, filename })`.

### 4.3 Cliente instância→central — `wacrm/src/lib/uazapi/central-client.ts`

- `sendUazapi(unitLabel, payload): Promise<{ messageId?: string }>` — reusa `centralFetch` (timeout ~15s). Lança em erro (o chamador faz fail-safe).

### 4.4 Integração no envio — `wacrm/src/lib/whatsapp/send-message.ts`

No `sendMessageToConversation`, **depois** de resolver config+contato+destinatário e **antes** do attempt Meta:

1. Carrega config híbrida da unidade + `windowOpen` (`now - conversations.last_inbound_at < 24h`) + contador.
2. `chooseChannel(...)`. Se `consumeCounter`, incrementa o contador **atomicamente** (Postgres `UPDATE ... SET interleave_counter = interleave_counter + 1 RETURNING`), usando o valor **pré-incremento** na decisão.
3. Se `channel === 'uazapi'`:
   - monta deliverable: `text` (ou template renderizado via `templateContentText`) / `media` (kind+url+caption+filename).
   - `sendUazapi(unitLabel, ...)`. **Sucesso** → persiste `messages` com `channel='uazapi'`, `message_id` = id da uazapi, `status='sent'`; pula a Meta.
   - **Falha** (throw) → `console.warn` + **FAIL-SAFE**: segue o fluxo Meta normal (com a lógica de janela: fora da janela, texto livre não passa na Meta → nesse caso o envio original já seria template; se o operador mandou texto fora da janela, a Meta rejeita e o erro sobe como hoje).
4. Se `channel === 'official'`: fluxo Meta atual, persiste `channel='official'`.

**Override** vem por parâmetro novo em `SendMessageParams`: `channelOverride?: Override` (default `'auto'`). Composer/manual pode mandar `official|uazapi`; automações (Frente 5) idem.

### 4.5 UI — `wacrm` Config → WhatsApp

Card **"Conexão redezap"** por unidade (reusa o padrão do painel uazapi da Frente 1):
- Toggle **Ativar Conexão redezap** (híbrido).
- Slider **% da saída via uazapi** (0–100) com leitura clara: "entrada sempre oficial; saída **X% uazapi / (100−X)% oficial**, só nas mensagens cobráveis".
- Select **Modo de cobrança**: `Automático (segue a Meta)` / `Tratar tudo como cobrável` / `Só templates`.
- **Aviso de risco**: misturar oficial+não-oficial no mesmo número tem risco de ban; a fatia % é só das cobráveis, com fail-safe.
- Mostra o **status da conexão uazapi** da unidade (se não conectada, avisa que a fatia cairá no oficial).
- (Opcional/nice-to-have) seletor de canal no composer manual (`auto/oficial/uazapi`).

## 5. Dados (migrations NOVAS — nunca editar migration commitada)

### 5.1 `wacrm` (Supabase) — migration `052_channel_hybrid.sql`
- Tabela `channel_hybrid_config`:
  - `unit_id uuid PRIMARY KEY REFERENCES unidades(id) ON DELETE CASCADE`
  - `account_id uuid NOT NULL`
  - `hybrid_enabled boolean NOT NULL DEFAULT false`
  - `uazapi_pct int NOT NULL DEFAULT 0 CHECK (uazapi_pct BETWEEN 0 AND 100)`
  - `billable_mode text NOT NULL DEFAULT 'auto' CHECK (billable_mode IN ('auto','always','template_only'))`
  - `interleave_counter bigint NOT NULL DEFAULT 0`
  - `updated_at timestamptz NOT NULL DEFAULT now()`
  - RLS: por `account_id` (padrão do projeto). Admin+ edita.
- `ALTER TABLE messages ADD COLUMN channel text NOT NULL DEFAULT 'official'` (`'official'|'uazapi'`), backfill default. Index leve opcional por (`conversation_id`).

Default **desligado** (`hybrid_enabled=false`) → comportamento atual intacto até o operador optar por unidade.

### 5.2 `gestao-usai` (Postgres) — sem migration
Nenhuma tabela nova na central (usa `UazapiConnection` da Frente 1). Só código (rota + `sendUnit`).

## 6. Fail-safe & consistência

- **Fail-safe de envio**: a decisão uazapi é otimista; o executor **tenta uazapi e, em qualquer erro, cai pro oficial** na hora — nunca dropa. (Sem pré-check de saúde por rede a cada envio.)
- **Contato só-BSUID**: uazapi não envia (precisa de número) → sempre oficial.
- **Interativo/template-com-botões**: sempre oficial.
- **Idempotência de contador**: incremento atômico no Postgres; corrida entre envios não fura a distribuição.
- **Fonte única**: config por unidade em uma tabela; `messages.channel` é a única marca de canal (sem denormalização divergente) — alimenta o painel de consumo (Frente 4).

## 7. Segurança

- Tokens uazapi **só na central**; instância envia via central autenticada por segredo de licença (Frente 1). Nenhum segredo novo na instância.
- Rota de envio da central: auth `x-license-secret`, valida `unitLabel` pertence à instância dona.
- Config híbrida é **admin+**, RLS por `account_id` (isolamento por conta, padrão do projeto).
- Texto de template renderizado enviado via uazapi é conteúdo próprio (sem injeção externa).
- Nada de PII em URL/query; envio via body.

## 8. Estratégia de testes (TDD — verde antes de deploy)

**Puros (`wacrm`):**
- `isUazapiEligibleType`: text/mídia/template → true; interactive → false.
- `isBillableAtSend`: fronteira **2026-10-01** (não-template grátis antes / cobrável depois); template sempre cobrável; modos `always`/`template_only`.
- `shouldUseUazapi`: exatamente `pct` por 100; **espalhado** (não bloco); bordas 0% e 100%; monotonicidade.
- `chooseChannel`: override official/uazapi; híbrido off; tipo inelegível; sem telefone; não-cobrável; e o passo do interleave (consumeCounter).

**Central (`gestao-usai`):**
- `sendUnit`: text e media (chama sendText/sendMedia certos); token morto/instância off → erro claro (sem auto-cura). Rota: 401 sem segredo, 200 com.

**Instância (`wacrm`):**
- `sendUazapi` (central-client): parse do messageId; erro propaga.
- Integração `sendMessageToConversation` (mock do central-client): roteia p/ uazapi e persiste `channel='uazapi'`; **erro uazapi → fail-safe** persiste via Meta com `channel='official'`; BSUID-only → oficial; interactive → oficial; incremento de contador.

**Verde obrigatório:** `vitest run` (ambos os repos), `tsc --noEmit` 0 erros, build da instância. Migrations aplicadas no Supabase.

## 9. Escopo / não-objetivos

- **Escopo:** roteador + config por unidade + envio uazapi via central + fail-safe + `messages.channel` + override por envio + card "Conexão redezap".
- **Fora (outras frentes):** UI de seleção de canal por automação (Frente 5), painel de consumo global (Frente 4), perfil Coex (Frente 3), agendamento/lembretes (Frente 5). A Frente 2 entrega o **mecanismo** de override que a 5 vai usar.

## 10. Rollout

- Migrations novas (Supabase da instância) + deploy central + deploy instância, **Zero Downtime OFF** (VPS 3,6 GB).
- **Opt-in por unidade** (default desligado) → zero impacto até o operador ativar.
- Pré-requisito operacional: a unidade precisa ter a **conexão uazapi** ativa (Frente 1) além do oficial. Sem uazapi conectada, o híbrido cai 100% no oficial (fail-safe) — seguro.
- Validação ao vivo: ativar em 1 estúdio com % baixo (ex.: 20%), enviar mensagens cobráveis, conferir no painel que a fatia saiu por uazapi (channel='uazapi', R$0) e que o inbound continua oficial.

## 11. Riscos

- **Ban do número** por misturar oficial+não-oficial: mitigado por % configurável (começar baixo), fail-safe, e só nas cobráveis. A partir de 01/10/2026 quase tudo é cobrável → mais volume possível na uazapi → o operador deve calibrar o % com cautela (o card avisa).
- **Semântica do template→texto**: ao desviar um template pra uazapi, o destinatário recebe o **texto renderizado** (sem cabeçalho/botão de template). Aceitável para lembretes/utility; interativo nunca desvia.
- **Divergência de rate**: a tarifa real (util/auth = service a partir de 01/10) fica na tabela de tarifas configurável (Frente 4); a Frente 2 não fixa número.
