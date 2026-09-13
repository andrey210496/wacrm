# Frente 3 — Perfil do WhatsApp Business (Coex) no RedeZap

Data: 2026-09-13
Status: CONSTRUÍDO — tsc 0, build verde, 28 testes passando (meta-profile 8 + profile-validate 10 + resumable reaproveitado). Falta deploy. Repo: `wacrm` (instância). Escopo: COMPLETO (foto + campos) + username atrás de flag.

## O que foi entregue
- `src/lib/whatsapp/meta-profile.ts` — cliente Graph API (convenção do meta-api.ts, erro cru), reaproveita `uploadResumableMedia` pra foto. + `meta-profile.test.ts` (8).
- `src/lib/whatsapp/profile-validate.ts` — validação pura (limites, email, URL, vertical do enum, username regex). + `profile-validate.test.ts` (10).
- Rotas ADMIN+ (`requireRole("admin")` + token da unidade decriptado no server):
  - `GET/POST /api/whatsapp/profile` — lê/atualiza campos; valida antes; devolve erro cru da Meta (POST 502); expõe `username_enabled`.
  - `POST /api/whatsapp/profile/photo` — multipart (`file`+`unitId`), sem fetch de URL (sem SSRF), JPEG/PNG ≤5MB, upload resumable → handle → aplica.
  - `POST /api/whatsapp/profile/username` — atrás da flag `PROFILE_USERNAME_ENABLED` (default OFF → 501); valida; erro cru da Meta.
- UI `src/components/settings/perfil-whatsapp-panel.tsx` — painel por unidade, esconde no 403, seletor de unidade, foto (preview+troca), campos, categoria (select PT), bloco username só com a flag. **Trava salvar/foto/username se o perfil não carregou** (evita limpar o perfil na Meta com save vazio). Plugado no `whatsapp-config.tsx`.

## Deploy / operação
- Sem migration (usa `whatsapp_config` já existente).
- Foto precisa de `META_APP_ID` no env da instância (mesma var do header de template).
- Username: manter `PROFILE_USERNAME_ENABLED` **desligado** até confirmar endpoint na doc da Meta.
- Todos os nomes de campo/endpoint/limite estão marcados `// CONFIRMAR NA META` e centralizados; erro cru da Meta sobe pra UI, correção num ponto só.

## Objetivo
Painel em Config → WhatsApp, por unidade, pra ver/editar o **perfil do WhatsApp
Business** direto na Meta (sem abrir o Meta Business): **foto**, **sobre**,
**descrição**, **email**, **sites**, **endereço**, **categoria (vertical)**. E,
atrás de flag, **reservar/definir o username** (recurso novo, rollout 2026).

## Fonte / regra Meta
Meta = sempre doc oficial. As páginas de referência estavam com HTTP 500/JS na
hora do build — então: os nomes de campos ficam CENTRALIZADOS em um módulo, e as
rotas devolvem o **erro cru da Meta** pra UI (se um campo divergir, aparece o que
a Meta disse, e a correção é num só ponto). Perfil = API estável
(`/{phone_number_id}/whatsapp_business_profile`). Username = Username API (novo,
rollout gradual desde 29/06/2026) — endpoint marcado `// CONFIRMAR NA META`,
**flag default OFF**, falha graciosa. Refs: business profile (Cloud API reference),
[Business-scoped user IDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/).

## Arquitetura
Tudo na **instância** (token + phone_number_id da unidade já vivem lá, como no
envio). Nada na central. Server routes (admin+) chamam a Graph API com o token da
unidade decriptado.

- `src/lib/whatsapp/meta-profile.ts` (novo): cliente puro-ish da Graph API:
  - `getBusinessProfile(phoneNumberId, token)` → GET `.../whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,vertical,websites`.
  - `updateBusinessProfile(phoneNumberId, token, fields)` → POST com os campos editáveis (`messaging_product:"whatsapp"` + campos).
  - `uploadProfilePhoto(appId, token, bytes, mimeType)` → Resumable Upload API (cria sessão em `/{app_id}/uploads`, sobe o arquivo, retorna o `handle` `h`).
  - Campos/limites CENTRALIZADOS aqui (uma constante) — `// CONFIRMAR NA META` onde houver dúvida.
  - `setUsername(...)` → Username API (flag; `// CONFIRMAR NA META`).
- Validação pura (testável): `validateProfileFields` (limites de tamanho, email, URLs, vertical de um enum) + `validateUsername` (regex `^[a-z0-9._]+$`, tamanho).

## Rotas (instância, ADMIN+)
- `GET /api/whatsapp/profile?unitId` → lê o perfil da unidade (via Meta).
- `POST /api/whatsapp/profile` → atualiza campos (valida antes; erro da Meta cru no 502).
- `POST /api/whatsapp/profile/photo` → recebe a imagem (multipart/base64), faz o upload resumable, seta `profile_picture_handle`.
- `POST /api/whatsapp/profile/username` → (flag `PROFILE_USERNAME_ENABLED`) reserva/define; se flag off → 501 "em breve".

## UI
Card **"Perfil do WhatsApp Business"** em Config → WhatsApp (por unidade, admin):
- Preview + upload da **foto**.
- Campos: **sobre** (limite), **descrição**, **email**, **sites** (até 2), **endereço**, **categoria** (select do enum de verticals).
- Bloco **Username** (só aparece se a flag estiver on): input com validação + "reservar/definir"; aviso de que é recurso em rollout.
- Mostra erros da Meta de forma legível.

## Segurança
- ADMIN+; token da unidade decriptado no server, nunca no cliente.
- Foto: validar mimetype/tamanho antes do upload; sem PII em URL.
- App ID/secret já no env (`META_APP_ID`/`META_APP_SECRET`).

## Testes (TDD)
Puros: `validateProfileFields` (email inválido, URL inválida, texto > limite, vertical
fora do enum) e `validateUsername` (maiúscula/acentо/caractere inválido/tamanho).
Cliente: montagem de payload do update (mock fetch). tsc 0 + build.

## Não-objetivos v1
- Editar nome verificado (display name) — fluxo separado da Meta, com revisão.
- Username ativo garantido (depende do rollout da Meta) — entra atrás de flag.
