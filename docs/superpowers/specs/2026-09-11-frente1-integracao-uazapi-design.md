# Frente 1 — Integração uazapi (via Gestão USAI)

Data: 2026-09-11
Status: DESIGN (revisar antes de codar). Parte do programa
`2026-09-11-programa-multicanal-agendamento-design.md`.
Base: doc oficial uazapiGO v2.1.1 (docs.uazapi.com, spec `openapi-bundled.json`).

## Objetivo

Dar ao RedeZap um 2º canal (uazapi, não-oficial) **provisionado e gerenciado pela
Gestão USAI**, espelhando o padrão do gateway oficial: a central detém as credenciais e
controla o ciclo de vida; o RedeZap consome (envia/recebe) e mostra um painel de conexão
(QR, reconectar, status). É a base das frentes 2 (híbrida) e 5 (agendamento).

## Fatos da API uazapi (confirmados na doc oficial)

- **Auth:** header `token` (por instância) nos endpoints normais; `admintoken` nos de
  admin (criar/listar/deletar instância). Base: `https://{subdomain}.uazapi.com`.
- **Ciclo:** `POST /instance/create` (admin) → `POST /instance/connect` (retorna QR/
  pareamento) → `GET /instance/status` → `POST /instance/disconnect` / `POST
  /instance/reset` (reinicia runtime) → `DELETE /instance`. Estados: `disconnected`,
  `connecting`, `connected`, `hibernated` (pausada, credenciais preservadas).
- **Envio:** `POST /send/text`, `/send/media`, `/send/menu` (botões/lista/enquete),
  `/send/contact`, `/send/location`. Fila async com delay (`updateDelaySettings`).
- **Inbound/webhook:** `POST /webhook` (por instância) com eventos: mensagem recebida,
  status de mensagem, status de conexão, QR. `GET /webhook/errors` p/ diagnóstico.
- **Perfil:** `/profile/name`, `/profile/image`, `/business/update/profile` (usados na
  frente 3 quando o canal é uazapi).
- **Limites:** servidor tem teto de instâncias conectadas (erro 429); recomendam conta
  **WhatsApp Business** (o WhatsApp normal dá inconsistência/desconexão).

## Modelo na Gestão USAI (central)

Espelha `RelayTarget`/`Instance` do gateway. Novo modelo **`UazapiConnection`**:
- `id`, `instanceId` (FK → Instance SILO dona), `unitLabel` (a unidade/estúdio no
  RedeZap — o canal é por unidade), `baseUrl` (`https://{subdomain}.uazapi.com`),
  `instanceTokenEnc` (AES-256-GCM), `adminTokenEnc` (AES-256-GCM, se a central criar a
  instância), `status` (espelho do último status uazapi), `lastStatusAt`, `createdAt`.
- Segredos **só na central**, criptografados; nunca vão pro browser.

## Provisionamento (central → uazapi)

Painel `/whatsapp` (ou nova aba `/uazapi`) na central, ADMIN+:
1. **Criar instância:** `POST {baseUrl}/instance/create` (com `admintoken`) → guarda o
   `token` da instância criptografado. (Ou registrar uma instância já existente colando
   o token.)
2. **Conectar:** `POST /instance/connect` → devolve o **QR**; a central expõe o QR pro
   RedeZap renderizar (ou renderiza na própria central).
3. **Status/Reconectar/Desconectar:** `GET /instance/status`, `POST /instance/reset`,
   `POST /instance/disconnect` — a central intermedia (o token nunca sai dela).
4. **Webhook:** `POST /webhook` aponta o inbound da uazapi para a instância RedeZap
   (`https://<instância>/api/whatsapp/relay-uazapi`) — ver abaixo.

## Consumo no RedeZap (instância)

- **Painel de conexão (por unidade), ADMIN+:** mostra status (connected/hibernated/…),
  botão **Conectar/Reconectar** (chama a central → uazapi → devolve QR pra escanear),
  **Desconectar**, e diagnóstico (últimos erros do webhook). O RedeZap **nunca** fala
  direto com a uazapi com o token — sempre via central (autenticado pelo segredo de
  licença, como os endpoints `/api/gateway/*`).
- **Inbound:** nova rota `POST /api/whatsapp/relay-uazapi` (pública, autenticada por um
  segredo próprio do canal, fail-closed timing-safe — igual ao relay oficial). Ela
  **normaliza** o payload uazapi pro formato que o `processWebhook` espera (metadata +
  contacts + messages) e chama o MESMO `processWebhook` — então mensagem da uazapi cai no
  inbox igual à oficial, no estúdio certo. (Normalização isolada num módulo
  `uazapi/normalize.ts`, testável.)
- **Envio:** o roteador de canal (frente 2) chama `POST /send/text|media|menu` via central
  (que injeta o token). Na frente 1, deixamos o **cliente de envio** pronto e testado.

## Segurança

- Tokens (instância/admin) só na central, AES-256-GCM. RedeZap fala com a central por
  segredo de licença; o inbound relay-uazapi é autenticado por HMAC próprio (fail-closed).
- Nunca logar token nem QR bruto. Rate limit/429 tratado com mensagem clara + retry.
- **Risco de ban documentado** (canal não-oficial): status monitorado; a frente 2 tem o
  fail-safe pro oficial.

## Testes (Vitest)

- `uazapi/normalize.ts`: payload uazapi → formato processWebhook (texto, mídia, sem
  telefone). Puro.
- Auth do relay-uazapi: fail-closed (sem/errado → 401), timing-safe.
- Cliente uazapi (mock fetch): create/connect/status/disconnect/send montam a request
  certa (headers token/admintoken, corpo).

## Decisões TRAVADAS (frente 1)

1. **Full self-service no RedeZap.** O operador faz TUDO pela tela do RedeZap: clica
   "Conectar canal uazapi" numa unidade → RedeZap chama a central → a central, com o
   `admintoken` do servidor uazapi (config uma vez), **cria a instância**
   (`/instance/create`), **seta o webhook** (`/webhook` → a rota relay-uazapi da
   instância + segredo), **conecta** (`/instance/connect`) e devolve o **QR** → o RedeZap
   mostra o QR → operador escaneia → status vira `connected`. Tudo auto-ligado, sem sair
   do sistema. (Requer o `admintoken` do servidor configurado na central — segredo, uma vez.)
2. **Servidor uazapi COMPARTILHADO** (um `{subdomain}` pra todos). Distribuir depois se
   bater no limite de instâncias (429).
3. **Inbound DIRETO na instância** (`POST /webhook` da uazapi → `https://<instância>/api/
   whatsapp/relay-uazapi`), autenticado por HMAC próprio. A central não fica no caminho do
   inbound não-oficial.

## Config na central (uma vez)
`UazapiServerConfig` (ou env): `baseUrl` (`https://{subdomain}.uazapi.com`) +
`adminTokenEnc` (AES-256-GCM). É a conta uazapi do dono (já existe). A partir daí, todo o
provisionamento por-unidade é self-service pelo RedeZap.

## DoD

Migration da `UazapiConnection` (central). Cliente uazapi + normalizador (instância) com
testes. Painel de conexão na central + no RedeZap. Build/test/lint verdes. Branch própria.
Não toca no fluxo oficial. Deploy no ritmo atual.
