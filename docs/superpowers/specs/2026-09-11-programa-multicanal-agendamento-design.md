# Programa: Multi-canal, Conexão redezap, Agendamento de aulas e Perfil Coex

Data: 2026-09-11
Status: DESIGN GUARDA-CHUVA (visão do programa + decisões travadas). Cada frente terá
seu próprio design detalhado antes de codar.
Contexto: nasceu da conversa sobre o fluxo real da Pure Pilates (aula experimental →
lembretes → funil) e da estratégia de custo com canal não-oficial. A Pure Pilates já
está no ar com o gateway oficial (Coex/Cloud API) + Features A/B/C.

## Objetivo

Dar ao RedeZap (1) um segundo canal de envio não-oficial (uazapi) provisionado pela
Gestão USAI, (2) um modo híbrido por custo ("Conexão redezap"), (3) gestão do perfil
do WhatsApp Business por dentro do sistema, e (4) o fluxo de agendamento de aulas com
lembretes automáticos amarrados ao funil.

## As 5 frentes (entregáveis independentes, cada uma com design próprio)

1. **Integração uazapi (via Gestão USAI).** A central provisiona/gerencia a conexão
   uazapi (baseado na **doc oficial da uazapi**), com painel completo na central e um
   painel no RedeZap (QR, reconectar, status, desconectar). Inbound da uazapi entra pelo
   MESMO `processWebhook`. É a **base** das frentes 2 e 5. Repos: gestao-usai + wacrm.
2. **Multi-canal + "Conexão redezap" (híbrida por custo).** Abstração de canal
   Coex/uazapi no envio; modo híbrido: entrada sempre Coex, saída **X% uazapi /
   (100−X)% oficial**, aplicado **só nas mensagens cobráveis**; seletor de canal por
   automação (override); fail-safe (uazapi cai → fatia volta pro oficial). Depende de 1.
3. **Perfil WhatsApp Business (Coex) no RedeZap.** Editar foto, "sobre", e (se a API
   permitir) o username — direto na Meta, sem abrir o Meta Business. Independente.
4. **Consumo: por unidade + global.** Pequeno acréscimo à Feature C (já tem por-unidade;
   falta o consolidado da conta). Marca envios uazapi como "não-oficial (R$0 Meta)".
5. **Agendamento de aulas + lembretes + funil.** Entidade de agendamento (fonte única),
   lembretes disparados pelo canal escolhido (template no oficial / free-form na uazapi),
   confirmação por botão que move o funil, tela de acompanhamento (editar/confirmar/
   cancelar), e (opcional) a IA agendando via tool. Depende de 1/2.

## Decisões TRAVADAS (nesta conversa)

- **Coex NÃO burla a janela de 24h** para envio via Cloud API (fora da janela = template).
  Free-form fora da janela só existe (a) manual, pelo app do celular, ou (b) via uazapi.
- **uazapi é não-oficial** (risco de ban documentado; usar com parcimônia). Provisionada
  **pela Gestão USAI**, igual ao oficial — não direto no RedeZap.
- **Híbrido "Conexão redezap":** entrada Coex; saída split por %; **% só sobre as
  cobráveis** (maximiza economia, minimiza volume/risco no canal não-oficial);
  distribuição **intercalada a cada 100**; **fail-safe** pro oficial se a uazapi cair.
- **Seleção de canal:** global (o % da Conexão redezap) + **override por automação/envio**.
- **Painel de consumo:** **por unidade E um global**; envios uazapi = R$0 Meta.
- **Tarifa** (ex.: R$0,04/msg cobrável a partir de 01/10/2026) entra na **tabela de
  tarifas configurável** da Feature C (o operador mantém; hoje é estimativa).
- **Lembretes automáticos:** template utility (oficial) OU free-form (uazapi), conforme o
  canal escolhido na automação. Coexistence é o caminho **manual** livre, não automático.
- **Consistência:** tudo em fonte única (como já garantido nas etiquetas) — sem cópia
  denormalizada; agendamento é a fonte que alimenta lembretes E funil ao mesmo tempo.

## Sequência recomendada

**1 → 2 → 5**, com **3 e 4 em paralelo** (independentes; 4 é rápido). Cada frente:
branch própria, TDD, build/test/lint verdes, deploy no ritmo atual (migrations no
Supabase + redeploy com Zero Downtime OFF no VPS de 3,6 GB).

## A verificar na fonte (antes dos designs detalhados)

- **uazapi (frente 1):** endpoints de envio, webhook de inbound, ciclo de sessão/QR,
  reconexão, status — tudo pela **doc oficial da uazapi**.
- **Username via API (frente 3):** confirmar se a Cloud API já permite DEFINIR o username
  (feature nova 2026) ou se é só leitura/app. Foto/"sobre"/perfil são editáveis por API.

## Riscos / não-objetivos

- Misturar oficial + não-oficial no mesmo número tem risco de ban que atinge o número
  inteiro. Mitigação: uazapi só na fatia % das cobráveis, com fail-safe, e monitorada.
- Não é objetivo substituir o oficial pela uazapi; a uazapi é alavanca de custo/manual.
