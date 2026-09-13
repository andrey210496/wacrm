# Frente 5 — Fase C — Autoagendamento público

Data: 2026-09-13
Status: DESIGN aprovado (build). Depende da Fase A. Repo: `wacrm`.

## Objetivo
Página pública (sem login) para o cliente marcar sozinho, reusando o motor de
disponibilidade. Cliente escolhe serviço → recurso (ou "qualquer disponível") →
data → horário → nome+telefone. Security-first (endpoint público de escrita).

## Config (migration 055, estende scheduling_config)
- `public_booking_enabled BOOLEAN=false`
- `public_slug TEXT UNIQUE` (token aleatório global, não enumerável; gerado ao ligar)
- `public_lead_time_min INT=120` (antecedência mínima)
- `public_window_days INT=30` (janela futura máxima)
Todos os serviços/recursos ATIVOS da unidade são agendáveis no v1.

## Puro (testável)
- `rate-limit.ts`: `allow(key, max, windowMs, now)` janela deslizante em memória. Testável.
- `combineResourceSlots(perResource)`: dado slots livres por recurso, para "qualquer
  disponível" devolve slots únicos por horário com o 1º recurso livre atribuído.
- Reusa `generateSlots`/`buildWorkRanges` da Fase A.

## Rotas públicas (sem sessão; validam slug; service-role escopado ao slug; rate-limited)
- `GET /api/public/booking/[slug]` → { unitName, services[], resources[], leadTimeMin, windowDays } (só se enabled).
- `GET /api/public/booking/[slug]/slots?serviceId&resourceId?&date` → slots livres (por recurso,
  ou união se "any"); respeita lead-time e janela; nunca antes de agora+lead.
- `POST /api/public/booking/[slug]` → { serviceId, resourceId?|"any", startsAt, name, phone, hp? }:
  rate-limit (IP+slug) + honeypot + E.164/nome + janela/lead; **revalida o slot no servidor**
  (recompute e confere que startsAt está livre); se "any" resolve o 1º recurso livre; acha/cria
  contato por telefone (owner padrão da conta, service-role); insere appointment `scheduled`
  (overbooking barrado pelo EXCLUDE do banco → 409 amigável). Devolve confirmação mínima.

## Segurança
- Slug aleatório (crypto) → sem enumerar unidades; account/unit SEMPRE derivados do slug (nunca do cliente).
- Rate-limit por IP+slug (ex.: 8/10min) + honeypot (campo oculto; preenchido → 200 falso, não grava).
- Validação: E.164, nome 2..80, serviço/recurso pertencem à unidade, startsAt dentro de [agora+lead, agora+window].
- Revalidação server-side do slot (não confia no cliente) + trava DB.
- Sem PII em URL. Erros genéricos (não vaza estrutura). Rotas fora do gate de sessão (públicas).

## Página `/agendar/[slug]`
Client component público (sem sidebar/auth): fluxo em passos, chama as rotas públicas.
Sucesso na tela. Responsiva.

## UI de config (admin)
No dialog "Lembretes & Funil" (ou seção nova): ligar autoagendamento, mostrar/copiar o link
(`/agendar/<slug>`), lead-time e janela. Slug gerado ao ligar (se vazio).

## Testes
Puros: rate-limit (permite/bloqueia/expira), combineResourceSlots (união/atribuição/vazio).
Server: validação de janela/lead, revalidação de slot, escopo por slug (mock). tsc 0 + build.

## Não-objetivos v1
OTP, pagamento, reagendamento/cancelamento pelo cliente pela página, escolher quais serviços
são públicos (todos ativos), envio proativo de confirmação (lembrete da Fase B cobre).
