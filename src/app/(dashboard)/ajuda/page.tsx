"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Search,
  ChevronDown,
  Link2,
  Check,
  Lightbulb,
  AlertTriangle,
  HelpCircle,
  ListChecks,
  Info,
  Rocket,
  MessageSquare,
  Users,
  GitBranch,
  Radio,
  Zap,
  Workflow,
  CalendarDays,
  Smartphone,
  Settings,
  LayoutDashboard,
  Bot,
  Webhook,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HELP_CATEGORIES, type HelpArticle, type HelpBadge } from "@/lib/help/content";

const ICONS: Record<string, LucideIcon> = {
  Rocket,
  MessageSquare,
  Users,
  GitBranch,
  Radio,
  Zap,
  Workflow,
  CalendarDays,
  Smartphone,
  Settings,
  LayoutDashboard,
  Bot,
  Webhook,
  ShieldCheck,
};

const BADGE: Record<HelpBadge, { label: string; className: string }> = {
  admin: { label: "Só admin", className: "border-primary/40 bg-primary/10 text-primary" },
  agent: { label: "Atendente+", className: "border-border bg-muted text-foreground" },
  beta: { label: "Beta", className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300" },
};

/** Texto pesquisável de um artigo (título + todos os campos + categoria). */
function searchText(a: HelpArticle, categoryTitle: string): string {
  return [
    a.title,
    categoryTitle,
    a.what,
    a.why,
    ...a.how,
    ...(a.connects ?? []),
    ...(a.tips ?? []),
    ...(a.problems?.flatMap((p) => [p.q, p.a]) ?? []),
    ...(a.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

export default function AjudaPage() {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState(HELP_CATEGORIES[0].slug);
  const [openSlugs, setOpenSlugs] = useState<Set<string>>(new Set());
  const contentRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();

  // Resultados da busca (achatados, com a categoria de cada artigo).
  const results = useMemo(() => {
    if (!q) return null;
    const out: { category: string; categoryTitle: string; article: HelpArticle }[] = [];
    for (const cat of HELP_CATEGORIES) {
      for (const article of cat.articles) {
        if (searchText(article, cat.title).includes(q)) {
          out.push({ category: cat.slug, categoryTitle: cat.title, article });
        }
      }
    }
    return out;
  }, [q]);

  // Deep-link: /ajuda#slug abre o artigo e rola até ele.
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    if (!hash) return;
    for (const cat of HELP_CATEGORIES) {
      const art = cat.articles.find((a) => a.slug === hash);
      if (art) {
        setActiveCat(cat.slug);
        setOpenSlugs((s) => new Set(s).add(art.slug));
        setTimeout(() => {
          document.getElementById(`art-${art.slug}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
        break;
      }
    }
  }, []);

  function toggle(slug: string) {
    setOpenSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function copyLink(slug: string) {
    const url = `${window.location.origin}${window.location.pathname}#${slug}`;
    navigator.clipboard?.writeText(url);
    history.replaceState(null, "", `#${slug}`);
  }

  const currentCat = HELP_CATEGORIES.find((c) => c.slug === activeCat) ?? HELP_CATEGORIES[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Cabeçalho + busca */}
      <header className="mb-6">
        <div className="flex items-center gap-2 text-primary">
          <HelpCircle className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">Central de Ajuda</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-foreground">Como podemos ajudar?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Guia completo do RedeZap — busque por qualquer recurso, dúvida ou palavra-chave.
        </p>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar na ajuda (ex.: lembrete, coex, transmissão, tags)…"
            aria-label="Buscar na Central de Ajuda"
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-10 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Rail de categorias (some no modo busca) */}
        {!q && (
          <nav aria-label="Categorias de ajuda" className="lg:sticky lg:top-4 lg:self-start">
            {/* Mobile: select */}
            <select
              value={activeCat}
              onChange={(e) => setActiveCat(e.target.value)}
              aria-label="Escolher categoria"
              className="mb-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground lg:hidden"
            >
              {HELP_CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.title}
                </option>
              ))}
            </select>
            {/* Desktop: lista */}
            <ul className="hidden gap-1 lg:grid">
              {HELP_CATEGORIES.map((c) => {
                const Icon = ICONS[c.icon] ?? Info;
                const active = c.slug === activeCat;
                return (
                  <li key={c.slug}>
                    <button
                      type="button"
                      onClick={() => setActiveCat(c.slug)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                        active
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{c.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {/* Conteúdo */}
        <div ref={contentRef} className={cn(!q && "lg:col-start-2")}>
          {q ? (
            // ---- Modo busca ----
            <section aria-live="polite">
              <p className="mb-3 text-sm text-muted-foreground">
                {results!.length === 0
                  ? "Nenhum resultado."
                  : `${results!.length} resultado${results!.length > 1 ? "s" : ""} para “${query}”`}
              </p>
              {results!.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card px-4 py-10 text-center">
                  <HelpCircle className="mx-auto size-8 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium text-foreground">Não achamos nada com “{query}”.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tente outra palavra (ex.: “agenda”, “template”, “conectar”), ou limpe a busca para navegar por categorias.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {results!.map(({ article, categoryTitle }) => (
                    <ArticleCard
                      key={article.slug}
                      article={article}
                      categoryTitle={categoryTitle}
                      open={openSlugs.has(article.slug)}
                      onToggle={() => toggle(article.slug)}
                      onCopy={() => copyLink(article.slug)}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            // ---- Modo categoria ----
            <section>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-foreground">{currentCat.title}</h2>
                <p className="text-sm text-muted-foreground">{currentCat.description}</p>
              </div>
              <div className="space-y-3">
                {currentCat.articles.map((article) => (
                  <ArticleCard
                    key={article.slug}
                    article={article}
                    open={openSlugs.has(article.slug)}
                    onToggle={() => toggle(article.slug)}
                    onCopy={() => copyLink(article.slug)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ArticleCard({
  article,
  categoryTitle,
  open,
  onToggle,
  onCopy,
}: {
  article: HelpArticle;
  categoryTitle?: string;
  open: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const badge = article.badge ? BADGE[article.badge] : null;

  return (
    <div
      id={`art-${article.slug}`}
      className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`panel-${article.slug}`}
          className="flex flex-1 items-center gap-3 px-4 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{article.title}</span>
              {badge && (
                <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-medium", badge.className)}>
                  {badge.label}
                </span>
              )}
              {categoryTitle && (
                <span className="text-[11px] text-muted-foreground">· {categoryTitle}</span>
              )}
            </span>
            {!open && <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">{article.what}</span>}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            onCopy();
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Copiar link desta seção"
          aria-label={`Copiar link para “${article.title}”`}
          className="mr-2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {copied ? <Check className="size-4 text-emerald-500" /> : <Link2 className="size-4" />}
        </button>
      </div>

      {open && (
        <div id={`panel-${article.slug}`} className="border-t border-border px-4 py-4 text-sm">
          <Block icon={Info} title="O que é">
            <p className="text-muted-foreground">{article.what}</p>
          </Block>
          <Block icon={HelpCircle} title="Para que serve">
            <p className="text-muted-foreground">{article.why}</p>
          </Block>
          <Block icon={ListChecks} title="Como usar">
            <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground marker:text-muted-foreground/60">
              {article.how.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </Block>
          {article.connects && article.connects.length > 0 && (
            <Block icon={GitBranch} title="Conecta com">
              <div className="flex flex-wrap gap-1.5">
                {article.connects.map((c) => (
                  <span key={c} className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-foreground">
                    {c}
                  </span>
                ))}
              </div>
            </Block>
          )}
          {article.tips && article.tips.length > 0 && (
            <Block icon={Lightbulb} title="Dicas">
              <ul className="space-y-1.5">
                {article.tips.map((t, i) => (
                  <li key={i} className="flex gap-2 text-muted-foreground">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}
          {article.problems && article.problems.length > 0 && (
            <Block icon={AlertTriangle} title="Problemas comuns">
              <div className="space-y-2.5">
                {article.problems.map((p, i) => (
                  <div key={i} className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="flex gap-2 font-medium text-foreground">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                      {p.q}
                    </p>
                    <p className="mt-1 pl-5 text-muted-foreground">{p.a}</p>
                  </div>
                ))}
              </div>
            </Block>
          )}
        </div>
      )}
    </div>
  );
}

function Block({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/70">
        <Icon className="size-3.5" />
        {title}
      </p>
      {children}
    </div>
  );
}
