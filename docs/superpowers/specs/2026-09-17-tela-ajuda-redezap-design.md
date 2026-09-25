# Tela de Ajuda (RedeZap) — Central de Ajuda embutida

Data: 2026-09-17
Status: CONSTRUÍDO — tsc 0, build verde, rota /ajuda presente. Repo: `wacrm`.

## Objetivo
Uma central de ajuda no sidebar do RedeZap, completa e buscável, cobrindo todas
as features do sistema, de forma que o usuário resolva sozinho sem acionar
suporte. Bonita, moderna, dinâmica.

## Arquitetura
- **Conteúdo estruturado e puro** em `src/lib/help/content.ts`: `HELP_CATEGORIES`
  (14 categorias → artigos). Cada artigo tem a MESMA estrutura, sem resumos:
  `what` (O que é), `why` (Para que serve), `how[]` (passo a passo), `connects[]`
  (conecta com), `tips[]`, `problems[]` (Q&A), `keywords[]`. Badge por artigo
  (admin/agent/beta). Ampliar a ajuda = editar este arquivo; a UI se adapta.
- **Tela** `src/app/(dashboard)/ajuda/page.tsx` (client): busca no topo (filtra
  todos os campos + keywords em tempo real), rail de categorias (desktop) /
  select (mobile), artigos em accordion, deep-link `/ajuda#slug` + "copiar link".
  Ícones lucide por categoria; tokens do tema (dark/light).
- **Nav**: item no `bottomNavItems` do `sidebar.tsx` (ícone HelpCircle, labelKey
  `ajuda`) + chave i18n `ajuda` nos namespaces `Sidebar` e `Header` (pt/en/ko).
  Título do header via `pageTitles["/ajuda"]`.
- **pt-BR fixo** (coerente com as features RedeZap e APP_LOCALE=pt).

## Acessibilidade
- Accordions com `aria-expanded`/`aria-controls`, `<button>` nativo (teclado),
  `focus-visible:ring`. Rail com `aria-current`. Busca com `aria-live` no contador.
  Chevron com `motion-reduce:transition-none`. Alvos de toque adequados.

## Categorias (14)
Primeiros passos · Atendimento (Inbox) · Contatos · Funis · Transmissões &
Templates · Automações · Fluxos (Beta) · Agenda e Serviços · Conexão do WhatsApp ·
Configurações & Equipe · Painéis · Inteligência (IA) · API & Integrações · Conta
& Licença. Conteúdo derivado do inventário completo do sistema.

## Não-objetivos v1
- Vídeos/GIFs embutidos (pode entrar depois).
- i18n do conteúdo dos artigos (pt-BR fixo por ora).
