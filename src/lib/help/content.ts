/**
 * Conteúdo da Central de Ajuda (rota /ajuda). Dados estruturados e PUROS — a
 * tela busca, filtra e faz deep-link em cima disto. pt-BR fixo (coerente com o
 * resto das features RedeZap e com APP_LOCALE=pt). Para ampliar a ajuda, basta
 * adicionar categorias/artigos aqui — a UI se adapta sozinha.
 *
 * Cada artigo segue a mesma estrutura (sem resumos): O que é · Para que serve ·
 * Como usar (passo a passo) · Conecta com · Dicas · Problemas comuns.
 */

export type HelpBadge = "admin" | "agent" | "beta";

export interface HelpProblem {
  /** Sintoma/pergunta comum. */
  q: string;
  /** Como resolver. */
  a: string;
}

export interface HelpArticle {
  slug: string;
  title: string;
  /** Quem usa/vê (badge no card). admin = só admin/dono; agent = atendente+; beta. */
  badge?: HelpBadge;
  /** O que é (linguagem de usuário). */
  what: string;
  /** Para que serve (o valor). */
  why: string;
  /** Passo a passo do fluxo principal. */
  how: string[];
  /** Com o que se conecta dentro do RedeZap. */
  connects?: string[];
  /** Dicas práticas. */
  tips?: string[];
  /** Problemas comuns e como resolver. */
  problems?: HelpProblem[];
  /** Termos extras de busca (sinônimos). */
  keywords?: string[];
}

export interface HelpCategory {
  slug: string;
  title: string;
  /** Nome do ícone lucide (mapeado na página). */
  icon: string;
  /** Uma linha explicando a categoria. */
  description: string;
  articles: HelpArticle[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  // ============================================================
  {
    slug: "primeiros-passos",
    title: "Primeiros passos",
    icon: "Rocket",
    description: "O essencial para começar a usar o RedeZap do zero.",
    articles: [
      {
        slug: "visao-geral",
        title: "Visão geral do RedeZap",
        what: "O RedeZap é um CRM de WhatsApp: junta o atendimento da sua equipe, os contatos, o funil de vendas, campanhas, automações, agenda de serviços e inteligência artificial — tudo ligado ao seu número de WhatsApp.",
        why: "Centraliza tudo o que acontece no WhatsApp da empresa num lugar só, com histórico, permissões por pessoa e visão por unidade.",
        how: [
          "Conecte o número de WhatsApp da unidade em Configurações → WhatsApp.",
          "Crie suas unidades (se tiver mais de um ponto/estúdio/loja) e convide a equipe.",
          "Comece a atender pela Caixa de entrada; organize clientes em Contatos e oportunidades em Funis.",
          "Automatize respostas com Automações/Fluxos e faça campanhas com Transmissões.",
        ],
        connects: ["Conexão do WhatsApp", "Unidades", "Caixa de entrada", "Permissões"],
        tips: [
          "O seletor de unidade no topo define o que você está vendo (conversas, agenda, métricas).",
          "Quase toda funcionalidade depende de um número de WhatsApp conectado — comece por aí.",
        ],
        keywords: ["inicio", "começar", "onboarding", "introdução"],
      },
      {
        slug: "papeis-permissoes",
        title: "Papéis e permissões da equipe",
        what: "Cada pessoa da conta tem um papel: Dono, Administrador, Atendente ou Visualizador. O papel define o que ela pode ver e fazer.",
        why: "Protege configurações sensíveis (conexão, cobrança, membros) e mantém o atendente focado na sua unidade.",
        how: [
          "Dono: controle total, incluindo transferir a propriedade e excluir a conta.",
          "Administrador: gerencia membros, configurações, conexão do WhatsApp, unidades e cobrança.",
          "Atendente: atende conversas, envia mensagens, cria agendamentos e lembretes — preso à sua unidade.",
          "Visualizador: só leitura.",
        ],
        connects: ["Membros", "Unidades", "Configurações"],
        tips: [
          "Botões e telas exclusivos de admin ficam ocultos para atendentes — não é bug, é permissão.",
          "Atribua a unidade certa a cada atendente em Configurações → Membros.",
        ],
        problems: [
          {
            q: "Não vejo um botão/tela que outra pessoa vê.",
            a: "Provavelmente é uma ação de admin/dono. Peça a um administrador ou verifique seu papel em Configurações → Membros.",
          },
        ],
        keywords: ["cargo", "role", "admin", "atendente", "viewer", "dono", "owner"],
      },
      {
        slug: "unidades",
        title: "Unidades (multiunidade)",
        badge: "admin",
        what: "Unidades são os pontos do seu negócio (estúdios, lojas, filiais). Cada unidade tem o seu próprio número de WhatsApp, agenda e métricas.",
        why: "Permite operar vários pontos na mesma conta, com dados separados e atendentes presos à sua unidade.",
        how: [
          "Vá em Configurações → Unidades e crie uma unidade (nome + slug).",
          "Conecte o número de WhatsApp daquela unidade em Configurações → WhatsApp.",
          "Atribua os atendentes às suas unidades em Configurações → Membros.",
          "Use o seletor de unidade no topo para alternar o que você está vendo.",
        ],
        connects: ["Conexão do WhatsApp", "Membros", "Agenda", "Painéis", "Consolidado"],
        tips: [
          "Admins veem todas as unidades; atendentes veem só a sua.",
          "O painel Consolidado (só admin) soma as métricas de todas as unidades.",
        ],
        keywords: ["multiunidade", "filial", "estúdio", "loja", "escopo"],
      },
    ],
  },

  // ============================================================
  {
    slug: "atendimento",
    title: "Atendimento (Caixa de entrada)",
    icon: "MessageSquare",
    description: "Onde a equipe conversa com os clientes no WhatsApp.",
    articles: [
      {
        slug: "inbox",
        title: "Caixa de entrada",
        badge: "agent",
        what: "A caixa de entrada compartilhada: lista de conversas à esquerda, histórico da conversa no centro e o painel do contato à direita.",
        why: "Centraliza todo o atendimento do WhatsApp da equipe, com contexto do cliente e histórico completo.",
        how: [
          "Abra a Caixa de entrada e selecione uma conversa na lista (o contador mostra as não-lidas).",
          "Leia o histórico; as bolhas mostram o status de entrega (enviado, entregue, lido).",
          "Responda pelo compositor: texto, mídia, áudio, template, resposta rápida ou mensagem com botões.",
          "Use o painel do contato à direita para ver/editar dados, tags e criar um negócio no funil.",
        ],
        connects: ["Contatos", "Templates", "Respostas rápidas", "Funis", "IA", "Automações e Fluxos"],
        tips: [
          "Você pode citar/responder uma mensagem específica para dar contexto.",
          "Atendimentos aparecem em tempo real; não precisa recarregar a página.",
        ],
        problems: [
          {
            q: "Não consigo enviar mensagem.",
            a: "Enviar exige papel Atendente ou acima. Confirme também que o número da unidade está conectado em Configurações → WhatsApp.",
          },
        ],
        keywords: ["conversa", "chat", "mensagens", "atender", "inbox"],
      },
      {
        slug: "enviar-mensagens",
        title: "Enviar texto, mídia, áudio e mensagens interativas",
        badge: "agent",
        what: "O compositor envia vários tipos de mensagem: texto, imagem/vídeo/documento, áudio (gravado na hora), templates aprovados, respostas rápidas e mensagens interativas (botões e listas).",
        why: "Dá agilidade e recursos ricos no atendimento, tudo dentro das regras do WhatsApp.",
        how: [
          "Texto: digite e envie.",
          "Mídia: anexe imagem, vídeo ou documento; ou grave um áudio pelo microfone.",
          "Template: use o seletor de templates quando estiver fora da janela de 24h (obrigatório para iniciar conversa).",
          "Respostas rápidas: insira textos prontos reutilizáveis.",
          "Interativas: monte uma mensagem com botões ou lista de opções (útil para menus).",
        ],
        connects: ["Templates", "Respostas rápidas", "Automações e Fluxos", "Conexão do WhatsApp"],
        tips: [
          "Dentro da janela de 24h (cliente falou por último) você envia texto livre; fora dela, só template.",
          "Mensagens interativas com botões/listas casam com Fluxos e com o gatilho de automação 'resposta interativa'.",
        ],
        keywords: ["composer", "anexo", "foto", "documento", "botões", "lista", "voz"],
      },
      {
        slug: "reacoes-respostas",
        title: "Reações e responder mensagens",
        badge: "agent",
        what: "Você pode reagir a uma mensagem com emoji e responder/citar uma mensagem específica.",
        why: "Deixa a conversa mais clara e humana, e dá contexto ao responder um ponto específico.",
        how: [
          "Passe o mouse sobre a mensagem e use as ações para reagir ou citar.",
          "Ao citar, a sua resposta aparece com a prévia da mensagem original.",
        ],
        connects: ["Caixa de entrada"],
        keywords: ["emoji", "reagir", "citar", "quote", "reply"],
      },
      {
        slug: "rascunho-ia",
        title: "Rascunho de IA no atendimento",
        badge: "agent",
        what: "Um botão que gera um rascunho de resposta com a IA da conta, para você revisar e enviar.",
        why: "Acelera respostas mantendo o controle humano (você edita antes de mandar).",
        how: [
          "Com a IA configurada (Agentes de IA), use o botão de rascunho no compositor.",
          "Revise o texto sugerido, ajuste e envie.",
        ],
        connects: ["Inteligência (IA)", "Caixa de entrada"],
        tips: ["Precisa da IA configurada com uma chave (BYO key) em Agentes de IA → Configuração."],
        keywords: ["ai", "sugestão", "draft", "sparkles"],
      },
    ],
  },

  // ============================================================
  {
    slug: "contatos",
    title: "Contatos",
    icon: "Users",
    description: "O cadastro único dos seus clientes, sem duplicatas.",
    articles: [
      {
        slug: "gerenciar-contatos",
        title: "Cadastrar e organizar contatos",
        what: "A agenda de clientes: nome, telefone, tags e campos personalizados. Tem lista, ficha detalhada e o painel do contato dentro do inbox.",
        why: "Mantém um cadastro único e limpo de cada cliente, com dados extras e segmentação por tags.",
        how: [
          "Crie um contato manualmente pelo formulário, ou deixe o sistema criar sozinho quando o cliente manda mensagem.",
          "Adicione tags para segmentar e campos personalizados para dados extras.",
          "Importe em massa por CSV pelo modal de importação (as tags do arquivo são resolvidas/criadas).",
        ],
        connects: ["Caixa de entrada", "Funis", "Agenda", "Transmissões", "Automações", "API"],
        tips: [
          "Tags são a base para audiência de transmissões e para gatilhos de automação.",
          "Campos personalizados e tags também são geridos em Configurações → Campos e tags.",
        ],
        keywords: ["clientes", "cadastro", "csv", "importar", "tags", "campos"],
      },
      {
        slug: "dedupe-telefone",
        title: "Deduplicação por telefone",
        what: "O sistema evita contatos duplicados usando o telefone normalizado (só os dígitos) como chave única por conta.",
        why: "Impede que o mesmo cliente vire dois cadastros — seja por webhook, formulário ou CSV.",
        how: [
          "Ao chegar um contato (de qualquer origem), o telefone é normalizado e comparado com os existentes.",
          "Se bater, o cadastro é reaproveitado; se for parecido (últimos dígitos), é sinalizado como possível duplicata.",
        ],
        connects: ["Contatos", "Caixa de entrada", "Agenda (autoagendamento)"],
        tips: ["A mesma regra vale para todas as entradas — webhook, cadastro manual e importação CSV concordam no que é 'o mesmo número'."],
        keywords: ["duplicado", "duplicata", "merge", "normalizar", "telefone"],
      },
      {
        slug: "bsuid-username",
        title: "Contatos sem telefone (BSUID e username)",
        what: "Desde 2026 o WhatsApp pode não enviar o telefone do cliente (privacidade por username). Nesses casos, o sistema usa um identificador estável da Meta (BSUID) e guarda o @username quando o cliente o ativa.",
        why: "Garante que você não perca a identidade do cliente mesmo quando o telefone não vem.",
        how: [
          "O contato pode existir só com BSUID (telefone nulo).",
          "Quando o telefone aparecer depois, o sistema religa/mescla a identidade automaticamente.",
        ],
        connects: ["Contatos", "Caixa de entrada"],
        keywords: ["privacidade", "sem telefone", "arroba", "identidade"],
      },
    ],
  },

  // ============================================================
  {
    slug: "funis",
    title: "Funis (Pipelines)",
    icon: "GitBranch",
    description: "Acompanhe oportunidades de venda por etapa, em kanban.",
    articles: [
      {
        slug: "funis-negocios",
        title: "Funis, etapas e negócios",
        what: "Funis de vendas em formato kanban. Cada funil tem etapas (colunas) e cada negócio é um card arrastável ligado a um contato, com valor e moeda.",
        why: "Acompanhar oportunidades por estágio e medir conversão.",
        how: [
          "Crie funis e etapas em Configurações → Funis (ou pelas configurações do quadro).",
          "Adicione um negócio a partir do contato ou pelo próprio quadro.",
          "Arraste os cards entre as etapas conforme a venda avança.",
          "Veja métricas por funil na aba de análise.",
        ],
        connects: ["Contatos", "Automações (criar negócio)", "Agenda (funil de agenda)", "Painéis (donut)"],
        tips: [
          "A moeda padrão é definida em Configurações → Negócios.",
          "A Agenda pode mover automaticamente o negócio do contato entre etapas conforme o status do agendamento.",
        ],
        keywords: ["pipeline", "kanban", "deal", "negócio", "venda", "etapa"],
      },
    ],
  },

  // ============================================================
  {
    slug: "transmissoes",
    title: "Transmissões e Templates",
    icon: "Radio",
    description: "Campanhas em massa com templates aprovados pela Meta.",
    articles: [
      {
        slug: "templates",
        title: "Templates de mensagem (Meta)",
        badge: "admin",
        what: "Templates são mensagens pré-aprovadas pela Meta, exigidas para iniciar conversa (fora da janela de 24h) e para transmissões.",
        why: "É a única forma permitida pela Meta de mandar a primeira mensagem ou disparar em massa.",
        how: [
          "Crie o template em Configurações → Templates.",
          "Submeta à Meta para aprovação (pode ter cabeçalho de mídia, corpo com variáveis e botões).",
          "Acompanhe o status (aprovado, rejeitado, pausado) — sincroniza com a Meta automaticamente.",
        ],
        connects: ["Transmissões", "Automações (enviar template)", "Caixa de entrada", "Conexão do WhatsApp"],
        tips: [
          "Template com variáveis ({{1}}, {{2}}...) é preenchido por contato na hora do envio.",
          "A Meta limita quantos templates você cria por hora — se der erro de limite, tente mais tarde.",
        ],
        problems: [
          {
            q: "Meu template foi rejeitado.",
            a: "A Meta rejeita por conteúdo/categoria. Ajuste o texto seguindo o motivo informado e submeta de novo (o status volta para pendente).",
          },
        ],
        keywords: ["template", "modelo", "hsm", "aprovação", "meta"],
      },
      {
        slug: "broadcasts",
        title: "Transmissões (envio em massa)",
        badge: "agent",
        what: "Envio de um template aprovado para muitos contatos de uma vez, por um assistente de 4 passos.",
        why: "Campanhas e avisos (promoções, lembretes) dentro das regras da Meta.",
        how: [
          "Passo 1: escolha o template aprovado.",
          "Passo 2: selecione a audiência (por tags/contatos ou CSV).",
          "Passo 3: personalize as variáveis do template.",
          "Passo 4: agende ou envie; acompanhe o progresso e o status de cada envio.",
        ],
        connects: ["Templates", "Contatos e tags", "Conexão do WhatsApp", "Tarifas/Consumo"],
        tips: [
          "Se um lote for interrompido, dá para retomar/retentar de onde parou.",
          "Transmissões podem consumir tarifa — acompanhe em Configurações → WhatsApp → Consumo.",
        ],
        keywords: ["broadcast", "campanha", "massa", "disparo", "lote"],
      },
    ],
  },

  // ============================================================
  {
    slug: "automacoes",
    title: "Automações",
    icon: "Zap",
    description: "Regras 'quando acontece X, faça Y' — sem código.",
    articles: [
      {
        slug: "automacoes",
        title: "Criar automações",
        badge: "admin",
        what: "Um construtor visual de regras: um gatilho dispara uma sequência de passos, com condições e ramificações (sim/não).",
        why: "Responder, etiquetar, criar negócios, atribuir conversas e chamar sistemas externos automaticamente.",
        how: [
          "Escolha um gatilho: nova mensagem, primeira mensagem, palavra-chave, novo contato, conversa atribuída, tag adicionada, por horário ou resposta interativa.",
          "Monte os passos: enviar mensagem/botões/lista/template, adicionar/remover tag, atribuir conversa, atualizar campo, criar negócio, esperar, condição, webhook, fechar conversa.",
          "Ative a automação e acompanhe as execuções nos logs.",
        ],
        connects: ["Caixa de entrada", "Contatos e tags", "Funis", "Templates", "Webhooks", "Fluxos"],
        tips: [
          "Há modelos prontos (boas-vindas, fora do expediente, qualificação de lead, follow-up).",
          "Precedência: se um Fluxo ativo já 'consumiu' a mensagem, as automações de conteúdo não rodam para ela.",
        ],
        problems: [
          {
            q: "Minha automação não disparou.",
            a: "Verifique se ela está ativa, se o gatilho corresponde ao que aconteceu e se um Fluxo não consumiu a mensagem antes. Os logs da automação mostram o que rodou.",
          },
        ],
        keywords: ["automation", "gatilho", "trigger", "regra", "palavra-chave"],
      },
    ],
  },

  // ============================================================
  {
    slug: "fluxos",
    title: "Fluxos (chatbot)",
    icon: "Workflow",
    description: "Chatbot no-code em grafo, com menus e ramificações.",
    articles: [
      {
        slug: "fluxos",
        title: "Fluxos / chatbot",
        badge: "beta",
        what: "Um chatbot montado como um grafo de nós: o cliente é guiado por menus, perguntas e ramificações. Está em Beta.",
        why: "Automação conversacional multi-passo (um menu/URA de WhatsApp) que espera a resposta do cliente e avança.",
        how: [
          "Monte o fluxo no editor visual (canvas), ligando nós: início, enviar mensagem/botões/lista/mídia, coletar resposta, condição, marcar tag, passar para humano (handoff) e fim.",
          "Valide o fluxo pelo painel de validação e ative.",
          "Acompanhe as execuções (runs) por contato.",
        ],
        connects: ["Caixa de entrada", "Contatos e tags", "Automações", "IA"],
        tips: [
          "Fluxos têm precedência sobre automações e sobre a IA: se um Fluxo consumiu a mensagem, os outros não rodam.",
          "Só um fluxo ativo por contato de cada vez; o nó de handoff passa a conversa para um humano.",
        ],
        problems: [
          {
            q: "O Fluxo não aparece para ativar.",
            a: "Fluxos é uma feature Beta e pode exigir que a conta esteja habilitada. Fale com o administrador/suporte se não vir a opção.",
          },
        ],
        keywords: ["flow", "chatbot", "bot", "menu", "ura", "nó", "canvas"],
      },
    ],
  },

  // ============================================================
  {
    slug: "agenda",
    title: "Agenda e Serviços",
    icon: "CalendarDays",
    description: "Marque horários, lembre e confirme — com link público de autoagendamento.",
    articles: [
      {
        slug: "agenda-interna",
        title: "Agenda de serviços",
        badge: "agent",
        what: "Uma agenda por unidade: catálogo de serviços e recursos (profissionais/salas/equipamentos), marcação de horários com status (agendado, confirmado, concluído, cancelado, faltou).",
        why: "Negócios de serviço (clínicas, salões, estúdios) marcarem e gerenciarem horários num lugar só.",
        how: [
          "Monte o catálogo (serviços com duração, preço e cor; e os recursos) no diálogo de catálogo.",
          "Crie um agendamento escolhendo serviço, recurso, cliente e horário livre.",
          "Navegue por dia e acompanhe os status; a disponibilidade considera horário de trabalho, folgas e a duração do serviço.",
        ],
        connects: ["Contatos", "Funis (funil de agenda)", "Conexão do WhatsApp (lembretes)", "Unidades"],
        tips: [
          "Tudo é escopado por unidade; o atendente já fica preso à sua unidade.",
          "O fuso é fixo em horário de Brasília (America/Sao_Paulo).",
        ],
        keywords: ["agendamento", "horário", "serviço", "recurso", "catálogo", "calendário"],
      },
      {
        slug: "lembretes-confirmacao",
        title: "Lembretes e confirmação por resposta",
        badge: "agent",
        what: "Lembretes automáticos por antecedência (ex.: 1 dia e 3h antes) e confirmação: quando o cliente responde uma palavra-chave (ex.: SIM), o agendamento é confirmado sozinho.",
        why: "Reduz faltas (no-show) e o trabalho manual de confirmar horários.",
        how: [
          "Configure os lembretes por unidade (antecedências, texto por lembrete com variáveis {cliente}, {servico}, {data}, {hora}, e o canal: automático/oficial/uazapi).",
          "Defina as palavras-chave de confirmação (ex.: sim, confirmar, ok).",
          "Quando o cliente responde uma delas, o agendamento das próximas 48h é confirmado e o funil de agenda se move.",
        ],
        connects: ["Agenda", "Caixa de entrada", "Funis", "Conexão do WhatsApp (canal híbrido)"],
        tips: [
          "O status dos lembretes fica visível na agenda (enviado/pendente/falhou).",
          "O canal pode ser híbrido: parte pela uazapi (R$0) e o resto pelo oficial.",
        ],
        problems: [
          {
            q: "O lembrete não chegou.",
            a: "Confira se a unidade do agendamento tem WhatsApp conectado, se os lembretes estão ativos e o horário/antecedência. O status na agenda mostra 'falhou' e o motivo.",
          },
        ],
        keywords: ["lembrete", "reminder", "confirmar", "no-show", "falta"],
      },
      {
        slug: "autoagendamento",
        title: "Autoagendamento público",
        badge: "admin",
        what: "Uma página pública (link) onde o próprio cliente escolhe serviço, recurso e horário, e informa nome e telefone — sem login.",
        why: "Captar marcações 24/7 sem a equipe precisar intermediar.",
        how: [
          "Ative o autoagendamento na configuração da agenda da unidade (gera um link com slug).",
          "Compartilhe o link público (/agendar/seu-slug).",
          "O cliente escolhe o horário livre e confirma; o sistema cria/reaproveita o contato (dedupe por telefone) e o agendamento, com trava contra overbooking.",
        ],
        connects: ["Agenda", "Contatos", "Funis"],
        tips: [
          "Dá para configurar antecedência mínima (lead time) e janela de dias disponíveis.",
          "Tem proteção anti-bot (honeypot + limite de tentativas) e revalidação do horário no servidor.",
        ],
        keywords: ["público", "link", "booking", "self-service", "slug", "agendar"],
      },
    ],
  },

  // ============================================================
  {
    slug: "conexao-whatsapp",
    title: "Conexão do WhatsApp",
    icon: "Smartphone",
    description: "Ligue o número da unidade e escolha o modo de envio e cobrança.",
    articles: [
      {
        slug: "conectar-numero",
        title: "Conectar o número (oficial e coex)",
        badge: "admin",
        what: "Onde o admin liga o número de WhatsApp de cada unidade à Cloud API oficial. Pela 'Conexão rápida' (Facebook) você escolhe: número novo (oficial) ou conectar o WhatsApp Business existente (coexistência). Também há o modo por token manual.",
        why: "É o que liga o CRM ao WhatsApp da empresa — sem isso, nada envia/recebe.",
        how: [
          "Selecione a unidade em Configurações → WhatsApp.",
          "Conexão rápida: clique em 'Conectar com o Facebook' e, na tela da Meta, escolha 'inserir número novo' (verifica por SMS/voz, sem celular) ou 'conectar seu WhatsApp Business existente' (coex, exige o número ativo num app num aparelho).",
          "Token manual (alternativa): informe Phone Number ID, WABA ID, Access Token e o PIN de 2 etapas; o token é criptografado no servidor.",
        ],
        connects: ["Unidades", "Perfil do WhatsApp Business", "Tarifas/Consumo", "Todas as features que enviam mensagem"],
        tips: [
          "Coexistência (coex) mantém o número também no app do celular e sincroniza histórico/contatos — mas exige um aparelho (físico ou emulador) com o app.",
          "Para números virtuais sem aparelho, use 'inserir número novo' (oficial): ele registra por SMS/voz, sem device.",
        ],
        problems: [
          {
            q: "Conectei mas fica 'pendente' e o RedeZap não mostra conectado.",
            a: "No coex, 'pendente' significa que a integração não foi finalizada no app do número (é preciso completar 'Conectar → Confirmar → colar código' dentro do WhatsApp Business, num aparelho). Para número sem aparelho, use o caminho oficial (número novo).",
          },
        ],
        keywords: ["coex", "coexistência", "oficial", "cloud api", "token", "conectar", "número"],
      },
      {
        slug: "status-registro",
        title: "Status de conexão e registro",
        badge: "admin",
        what: "Dois indicadores diferentes: 'conectado' (credenciais válidas) e 'registrado' (o número realmente recebe mensagens). Um número pode ter credencial válida mas não estar registrado.",
        why: "Evita confiar num 'verde' enganoso: sem registro, o número não recebe as mensagens dos clientes.",
        how: [
          "Use 'Testar conexão' para validar as credenciais com a Meta.",
          "Use 'Verificar com a Meta' (status de registro) para o diagnóstico completo de webhook/registro.",
          "Se aparecer 'não registrado', complete o registro (PIN de 2 etapas) ou reconecte.",
        ],
        connects: ["Conectar o número", "Dead-letter"],
        tips: ["Copie a URL de webhook exibida se precisar configurar do lado da Meta."],
        keywords: ["registro", "webhook", "pendente", "verificar", "diagnóstico"],
      },
      {
        slug: "perfil-whatsapp",
        title: "Perfil do WhatsApp Business",
        badge: "admin",
        what: "Painel para editar o perfil do negócio direto na Meta: foto, sobre, descrição, e-mail, sites, endereço e categoria. Há também o username (atrás de uma opção).",
        why: "Deixar o perfil do WhatsApp do cliente completo e profissional, sem abrir o Meta Business.",
        how: [
          "Em Configurações → WhatsApp, abra 'Perfil do WhatsApp Business' e escolha a unidade.",
          "Edite os campos e a foto e salve — as mudanças vão direto para a Meta.",
        ],
        connects: ["Conectar o número"],
        tips: ["A troca de foto exige uma configuração de app no servidor; se a foto falhar, o erro da Meta aparece na tela."],
        keywords: ["perfil", "foto", "bio", "sobre", "categoria", "username"],
      },
      {
        slug: "uazapi-hibrido",
        title: "Canal uazapi e Conexão redezap (híbrido)",
        badge: "admin",
        what: "Um canal não-oficial (uazapi, conecta por QR) por unidade, e o modo híbrido 'Conexão redezap' que mistura oficial + uazapi: uma % das mensagens cobráveis vai pela uazapi (custo R$0 na Meta), com retorno automático ao oficial se a uazapi cair.",
        why: "Reduzir custo de mensagens cobráveis, mantendo a robustez do oficial como rede de segurança.",
        how: [
          "Ative o canal uazapi da unidade (conexão self-service por QR) — o RedeZap fala com a uazapi pela central (Gestão USAI).",
          "Em 'Conexão redezap', ligue o híbrido e escolha a % da saída cobrável que vai pela uazapi e o modo de cobrança.",
        ],
        connects: ["Conectar o número", "Tarifas/Consumo", "Central (Gestão USAI)"],
        tips: [
          "Entrada é sempre pelo oficial; só uma fatia da saída cobrável vai pela uazapi.",
          "A partir de 01/10/2026 as mensagens de serviço passam a ser cobradas pela Meta — o detector já é ciente da data.",
        ],
        problems: [
          {
            q: "⚠️ Risco de bloqueio.",
            a: "Misturar oficial + não-oficial no mesmo número tem risco de bloqueio pela Meta. Comece com uma % baixa.",
          },
        ],
        keywords: ["uazapi", "híbrido", "qr", "baileys", "custo", "economia", "não-oficial"],
      },
      {
        slug: "tarifas-consumo",
        title: "Tarifas e consumo",
        badge: "admin",
        what: "Painel de consumo de mensagens por unidade, com custo estimado em R$ a partir de uma tabela de tarifas configurável.",
        why: "Enxergar quanto o WhatsApp está custando e por qual unidade.",
        how: [
          "Configure as tarifas por categoria de mensagem.",
          "Acompanhe o consumo por unidade e o custo estimado no período.",
        ],
        connects: ["Transmissões", "Conexão do WhatsApp", "Central (Consumo da frota)"],
        keywords: ["tarifa", "custo", "billing", "consumo", "cobrança"],
      },
      {
        slug: "dead-letter",
        title: "Mensagens não processadas (dead-letter)",
        badge: "admin",
        what: "Uma 'caixa de mensagens perdidas': todo evento inbound que o sistema não conseguiu processar é guardado com o motivo, para não se perder e poder ser reprocessado.",
        why: "Garante que nenhuma mensagem de cliente suma por erro de configuração ou parsing.",
        how: [
          "Um alerta aparece (no painel e em Configurações → WhatsApp) quando há pendências.",
          "Reprocesse pelo botão de 'drenar' quando a causa (ex.: número sem config) estiver resolvida.",
        ],
        connects: ["Conexão do WhatsApp", "Painéis"],
        tips: ["Fica silencioso quando não há nada pendente — se apareceu, vale investigar o motivo mostrado."],
        keywords: ["dead-letter", "perdidas", "não processadas", "reprocessar"],
      },
    ],
  },

  // ============================================================
  {
    slug: "configuracoes",
    title: "Configurações e Equipe",
    icon: "Settings",
    description: "Membros, unidades, campos, moeda, respostas rápidas e conta.",
    articles: [
      {
        slug: "membros",
        title: "Membros e convites",
        badge: "admin",
        what: "Onde você convida pessoas para a conta, define o papel de cada uma e a unidade a que pertencem.",
        why: "Montar a equipe com as permissões certas e o escopo de unidade correto.",
        how: [
          "Em Configurações → Membros, convide por e-mail e escolha o papel.",
          "A pessoa aceita o convite por um link e entra na conta.",
          "Atribua a unidade do membro; o dono pode transferir a propriedade.",
        ],
        connects: ["Papéis e permissões", "Unidades"],
        keywords: ["membro", "convite", "equipe", "convidar", "time"],
      },
      {
        slug: "respostas-rapidas",
        title: "Respostas rápidas",
        badge: "admin",
        what: "Textos prontos reutilizáveis que o atendente insere no compositor com poucos cliques.",
        why: "Padroniza e acelera respostas comuns.",
        how: [
          "Cadastre as respostas rápidas em Configurações → Respostas rápidas.",
          "No atendimento, insira-as pelo seletor de respostas rápidas do compositor.",
        ],
        connects: ["Caixa de entrada"],
        keywords: ["quick reply", "atalho", "canned", "resposta pronta"],
      },
      {
        slug: "campos-tags",
        title: "Campos personalizados e tags",
        badge: "admin",
        what: "Campos extras nos contatos e etiquetas (tags) para segmentar.",
        why: "Guardar informações específicas do seu negócio e criar segmentos para campanhas e automações.",
        how: [
          "Gerencie campos e tags em Configurações → Campos e tags.",
          "Use tags como audiência em Transmissões e como gatilho/ação em Automações.",
        ],
        connects: ["Contatos", "Transmissões", "Automações"],
        keywords: ["tag", "etiqueta", "campo", "custom field", "segmento"],
      },
      {
        slug: "aparencia-seguranca",
        title: "Perfil, segurança e aparência",
        what: "Seu perfil e senha, sessões ativas/segurança e o tema (claro/escuro) da interface.",
        why: "Manter sua conta segura e a interface do seu jeito.",
        how: [
          "Perfil: edite seus dados e troque a senha.",
          "Segurança: veja e encerre sessões ativas.",
          "Aparência: alterne entre tema claro e escuro.",
        ],
        connects: ["Conta"],
        keywords: ["senha", "sessão", "tema", "dark", "claro", "perfil"],
      },
    ],
  },

  // ============================================================
  {
    slug: "paineis",
    title: "Painéis",
    icon: "LayoutDashboard",
    description: "Métricas da unidade e visão consolidada da conta.",
    articles: [
      {
        slug: "dashboard",
        title: "Painel e Consolidado",
        what: "O Painel mostra as métricas da unidade ativa (volume de conversas, tempo de resposta, funil, atividade). O Consolidado (só admin) soma todas as unidades.",
        why: "Acompanhar a operação num olhar e comparar unidades.",
        how: [
          "Abra o Painel para ver os KPIs e gráficos da unidade ativa.",
          "Admins acessam o Consolidado para a tabela por unidade e os totais da conta.",
        ],
        connects: ["Caixa de entrada", "Funis", "Unidades", "Dead-letter"],
        tips: ["Troque a unidade no topo para ver o painel de outra unidade."],
        keywords: ["dashboard", "métricas", "kpi", "gráfico", "consolidado", "relatório"],
      },
    ],
  },

  // ============================================================
  {
    slug: "ia",
    title: "Inteligência (IA)",
    icon: "Bot",
    description: "Um agente de IA que responde clientes com sua própria chave.",
    articles: [
      {
        slug: "agente-ia",
        title: "Agente de IA (auto-resposta)",
        badge: "admin",
        what: "Um agente de IA 'traga sua própria chave' (BYO key OpenAI/Anthropic) que responde clientes automaticamente no inbox, com base de conhecimento e passagem para humano (handoff).",
        why: "Responder dúvidas comuns 24/7 e escalar para um atendente quando necessário.",
        how: [
          "Em Agentes de IA → Configuração, informe o provedor e a chave, o prompt e ative a auto-resposta.",
          "Alimente a base de conhecimento com documentos (são fatiados e indexados).",
          "Teste no Playground antes de ligar; acompanhe o consumo em Uso (só admin).",
        ],
        connects: ["Caixa de entrada", "Fluxos", "Base de conhecimento", "Conexão do WhatsApp"],
        tips: [
          "A IA só responde quando nenhum Fluxo consumiu a mensagem (Fluxos têm precedência).",
          "Após algumas respostas ou por intenção do cliente, a IA passa para um humano e mostra o banner na conversa.",
        ],
        problems: [
          {
            q: "A IA não responde.",
            a: "Confirme que a IA está ligada com uma chave válida, que a auto-resposta está habilitada e que não há um Fluxo ativo consumindo a mensagem. Veja o consumo/erros em Uso.",
          },
        ],
        keywords: ["ia", "ai", "gpt", "openai", "anthropic", "chatbot", "auto-reply", "conhecimento"],
      },
    ],
  },

  // ============================================================
  {
    slug: "api",
    title: "API e Integrações",
    icon: "Webhook",
    description: "Integre o RedeZap a outros sistemas por API e webhooks.",
    articles: [
      {
        slug: "api-webhooks",
        title: "API pública e webhooks",
        badge: "admin",
        what: "Uma API REST versionada (v1) autenticada por chave de API com escopos, e webhooks de saída para notificar sistemas externos de eventos.",
        why: "Integrar o RedeZap a outros sistemas — enviar/ler mensagens, gerir contatos, disparar transmissões e receber eventos.",
        how: [
          "Gere uma chave de API em Configurações → API, definindo os escopos (contatos, conversas, mensagens, transmissões, webhooks).",
          "Use os endpoints v1 (contatos, conversas, mensagens, transmissões) com a chave.",
          "Cadastre webhooks de saída para receber eventos (mensagem recebida, status atualizado, conversa criada) — a entrega é assinada (HMAC).",
        ],
        connects: ["Contatos", "Caixa de entrada", "Transmissões", "Automações (passo webhook)"],
        tips: [
          "As entregas de webhook têm proteção contra SSRF (bloqueiam URLs internas).",
          "A documentação da API fica em docs/public-api.md do projeto.",
        ],
        keywords: ["api", "rest", "webhook", "chave", "integração", "escopo", "token"],
      },
    ],
  },

  // ============================================================
  {
    slug: "conta-licenca",
    title: "Conta e Licença",
    icon: "ShieldCheck",
    description: "Acesso, licença/suspensão e notificações.",
    articles: [
      {
        slug: "licenca",
        title: "Licença e suspensão",
        what: "O RedeZap opera sob uma licença gerenciada pela central (Gestão USAI). Se a conta é suspensa (ex.: inadimplência), o acesso é redirecionado para uma tela de conta suspensa.",
        why: "Explica por que o acesso pode ser bloqueado e como voltar ao normal.",
        how: [
          "Se cair na tela 'conta suspensa', a licença está inativa — regularize com o responsável/central.",
          "Em instabilidade da verificação, o sistema mantém o acesso liberado (fail-open) para não travar por falso positivo.",
        ],
        connects: ["Central (Gestão USAI)"],
        keywords: ["licença", "suspenso", "bloqueado", "pagamento", "inadimplência"],
      },
      {
        slug: "notificacoes",
        title: "Notificações",
        what: "Avisos dentro do sistema — hoje, principalmente quando uma conversa é atribuída a você.",
        why: "Não perder atendimentos que passaram a ser sua responsabilidade.",
        how: [
          "O sino no menu mostra o contador de não-lidas.",
          "Abra Notificações para ver e marcar todas como lidas.",
        ],
        connects: ["Caixa de entrada"],
        keywords: ["notificação", "aviso", "sino", "atribuição"],
      },
    ],
  },
];
