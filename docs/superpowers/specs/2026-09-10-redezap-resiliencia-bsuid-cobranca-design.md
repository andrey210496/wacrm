# RedeZap — Resiliência de inbound, BSUID/usernames e consciência de cobrança

Data: 2026-09-10
Status: DESIGN (revisar antes de construir)
Escopo: instância RedeZap (wacrm). Três features independentes, entregáveis em sequência.
Origem: auditoria do `src/lib/whatsapp/process-webhook.ts` + regras atuais da Meta
(per-message pricing desde 01/07/2025; BSUID/usernames em rollout 2026).

## Contexto

O gateway está no ar e validado ponta a ponta. Ao auditar o processamento de webhook,
achamos que **mensagens inbound podem ser descartadas silenciosamente** e que o sistema
**não é ciente das regras novas de cobrança** nem do **BSUID** (identidade sem telefone).
Como o webhook/relay **sempre responde 200** pra Meta (de propósito, pra ela não re-tentar
em loop), **todo descarte é permanente** — não há retry da Meta nem fila interna.

Prioridade sugerida: **A (não perder mensagem) → B (BSUID) → C (cobrança)**.

---

## Feature A — Resiliência de inbound (dead-letter + retry)

### Problema
Em `process-webhook.ts`, cada `continue` abaixo descarta a mensagem de forma definitiva:
- `linha 120` `!value.messages || !value.contacts` (sem contato) — inclui o caso BSUID.
- `linha 134–140` erro transitório no banco ao buscar o config → **perda por soluço de DB**.
- `linha 143–145` **nenhum config** pro `phone_number_id` → número roteado mas não
  provisionado (ex.: provisão da Opção A falhou) → **inbound some**.
- `linha 148–156` config duplicado → drop.

### Design
1. **Tabela nova `whatsapp_inbound_deadletter`** (migration nova, aditiva):
   - `id`, `phone_number_id`, `raw_event` (jsonb — o `value`/mensagem cru), `reason`
     (enum: `no_contacts`, `db_error`, `no_config`, `multiple_configs`, `parse_error`),
     `status` (`pending` | `reprocessed` | `failed` | `ignored`), `attempts` (int),
     `last_error` (text), `created_at`, `updated_at`.
   - RLS: acesso só via service-role (o processamento e o worker usam admin client).
2. **Captura no ponto de drop:** antes de cada `continue`, gravar o evento na dead-letter
   com o motivo. O ack 200 pra Meta **continua igual** (correto). Nada de mudar o contrato
   externo — só deixar de jogar fora.
3. **Classificação transitório vs. semântico:**
   - `db_error` = **transitório** → o worker re-tenta (backoff).
   - `no_config` / `multiple_configs` = **semântico** → não adianta re-tentar sozinho;
     fica `pending` e **alerta o operador** (sinal de provisão quebrada). Vira `reprocessed`
     quando o config passa a existir e o worker roda de novo.
   - `no_contacts` = tratado pela Feature B (BSUID); até lá, fica registrado (não perdido).
4. **Worker de retry:** endpoint protegido `GET /api/whatsapp/deadletter/drain` (mesmo
   padrão do cron de automações, `AUTOMATION_CRON_SECRET`-like ou reuso), que pega
   `pending` elegíveis e **re-executa `processMessage`** (idempotente — o dedup por
   `message_id` já existe). Sucesso → `reprocessed`; falha após N tentativas → `failed`.
   Acionado por um pinger externo (cron do EasyPanel/n8n) ou botão no admin.
5. **Observabilidade:** contador de dead-letter por motivo no admin (banner "X mensagens
   não processadas") + no painel da central via licença (opcional, F2).

### Segurança / idempotência
- Reprocessar reusa o dedup existente (`onConflict message_id, ignoreDuplicates`) → sem
  duplicar mensagem. Worker autenticado (segredo), fail-closed. Nunca logar corpo sensível.

### Decisões em aberto (A)
1. Retry **automático** (pinger) desde já, ou **manual** (botão no admin) na v1?
   → recomendo: gravar sempre + botão manual na v1; pinger automático logo em seguida.
2. Alerta do `no_config`: só no painel, ou também e-mail/WhatsApp pro operador?

### Testes (A)
- Cada motivo de drop grava 1 linha de dead-letter (não perde).
- Reprocessar um `pending` idempotente não duplica; `no_config` que ganha config vira
  `reprocessed`.

---

## Feature B — BSUID / usernames (identidade sem telefone)

### Problema
Hoje o contato é identificado por telefone (`wa_id`) e o `linha 120` exige `value.contacts`.
Com os **usernames** da Meta (rollout 2026, `user_id` nos webhooks desde 31/03/2026), um
usuário com username e sem interação recente manda inbound **sem telefone — só com o BSUID**
(formato `US.134912086`, escopo por portfólio). Hoje isso é **descartado**.

### Design
1. **Schema `contacts`:** adicionar `bsuid` (text, nullable) + índice único por conta/escopo.
   Manter `phone` nullable-compatível (contato pode existir só com BSUID).
2. **Identidade no `process-webhook`:** afrouxar o guard — aceitar mensagens com `user_id`
   mesmo sem `contacts`/telefone. Resolver o contato por: **telefone se houver, senão BSUID**.
   Persistir os dois quando ambos aparecerem (liga BSUID↔telefone quando conhecido).
3. **Dedup/merge:** `findExistingContact` passa a casar por telefone OU bsuid. Quando um
   contato só-BSUID revelar telefone depois (ou vice-versa), **mesclar** (mover conversas/
   mensagens pro contato canônico) — reusar o padrão de dedupe que já existe.
4. **Envio:** para responder um contato só-BSUID, mandar pela **BSUID** como destinatário
   (a Meta aceita dentro do portfólio). Ajustar o send path para aceitar `bsuid` além de `to`.
5. **UI:** quando não há telefone, exibir o **username/identificador** no lugar do número
   (sem quebrar telas que assumem telefone). Rótulo claro de "sem telefone (username)".

### Decisões em aberto (B)
1. Exibição: mostrar o **username** (se a Meta enviar) ou um rótulo genérico "Usuário
   WhatsApp"? (a disponibilidade do username no payload precisa ser confirmada na Meta).
2. Estratégia de merge quando telefone aparece depois: automático vs. sugerir ao atendente.

### Testes (B)
- Inbound só-BSUID cria/acha contato e **não é descartado**; inbound com telefone segue igual;
  merge BSUID↔telefone não duplica nem perde histórico. Envio por BSUID monta o payload certo.

---

## Feature C — Consciência de cobrança (referral, pricing, janelas, painel)

### Problema
O sistema envia/recebe corretamente (a Meta cobra a empresa direto na WABA — nada quebra),
mas é **cego** às regras: não captura conversa vinda de **tráfego** (a grátis por 72h), não
lê o objeto **`pricing`** do status, não trava a **janela de 24h**, e não mostra **consumo**.

### Design
1. **Capturar `referral` (Click-to-WhatsApp):** no inbound vindo de anúncio, a Meta manda
   `referral` (source_type, source_id/ad_id, headline, source_url, ctwa_clid). Persistir na
   conversa/contato → marca a **janela grátis de 72h** e mostra "lead veio do anúncio X".
2. **Ler `pricing` do status:** em `statuses[].pricing` (category, billable, pricing_model),
   gravar por mensagem enviada (categoria + cobrável sim/não). Base do relatório de consumo.
3. **Janela de atendimento (funcional, não só custo):** rastrear o **último inbound** por
   conversa → a UI **avisa proativamente** "fora da janela de 24h, só template" antes de o
   atendente tentar free-form (em vez de a Meta rejeitar). Também sinalizar a janela de 72h
   do tráfego aberta.
4. **Painel de consumo (por estúdio/unidade):** mensagens por categoria (marketing/utility/
   authentication/service), **cobráveis vs. grátis**, contagem + (opcional) custo estimado.

### Decisões em aberto (C)
1. **Custo em R$**: estimar valor (exige tabela de tarifas da Meta, que muda — e muda de novo
   em 01/08/2026 e 01/10/2026), ou v1 só **categoriza + conta cobráveis** (sem R$)? →
   recomendo v1 sem R$ (categoria + contagem + grátis/cobrável), R$ como fase 2 com tabela
   versionada.
2. Escopo do painel: por unidade só, ou consolidado multi-unidade na conta?

### Testes (C)
- `referral` no inbound é persistido e marca 72h; `pricing` do status é gravado por categoria;
  janela de 24h calculada do último inbound; painel agrega por categoria/cobrável.

---

## Sequência e postura

1. **A (resiliência)** primeiro — para de perder mensagem AGORA (o risco #2/#3 pode já estar
   ativo). Migration aditiva + captura nos drops + worker/alerta.
2. **B (BSUID)** — deadline de mercado (rollout 2026). Depende de A (o `no_contacts` já cai
   na dead-letter, então nada se perde no intervalo).
3. **C (cobrança)** — valor de negócio; sem urgência de quebra.

Cada feature: branch própria, TDD, `npm run test`/`typecheck`/`lint`/`build` verdes antes de
push. Não tocar no contrato externo do webhook (ack 200 continua). Nada quebra o fluxo por
telefone existente. Migrations aditivas, nunca editar migration commitada.

## Decisões TRAVADAS (2026-09-10, pelo dono)
- **A1 → retry AUTOMÁTICO** (pinger/cron reprocessa a dead-letter; endpoint protegido).
- **A2 → alerta só no PAINEL** (sem e-mail/WhatsApp na v1).
- **B1 → exibir o USERNAME REAL** quando a Meta enviar (fallback a rótulo se ausente).
- **B2 → MERGE** automático BSUID↔telefone (move conversas/mensagens pro contato canônico).
- **C1 → CUSTO EM R$** (exige tabela de tarifas da Meta **versionada** — muda em 01/08/2026
  e 01/10/2026; guardar rate table com vigência e recalcular por período).
- **C2 → painel POR UNIDADE** (consumo por estúdio).
