import { Clock, HelpCircle, Timer } from "lucide-react";

import { formatBusinessHoursPt } from "@/lib/support/business-hours-format";
import type { SupportConfigDto } from "@/lib/support/central-support-client";

// Bloco informativo do suporte: explica como funciona + horário de atendimento
// + prazo de resposta (SLA). `config` vem da central (best-effort); se null,
// mostra só a explicação de como funciona.
export function SupportInfo({ config }: { config: SupportConfigDto | null }) {
  const hours = config ? formatBusinessHoursPt(config.businessHours) : [];
  const sla = config?.slaClientText?.trim();

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Como funciona</h2>
          <p className="text-sm text-muted-foreground">
            Abra um chamado descrevendo sua necessidade — você pode anexar imagens
            ou PDF. Nossa equipe responde por aqui mesmo, e você acompanha o status
            e o prazo de cada chamado nesta tela.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Horário de atendimento
            </p>
            {hours.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-sm text-foreground">
                {hours.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Não informado.</p>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Timer className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Prazo de resposta (SLA)
            </p>
            <p className="mt-1 text-sm text-foreground">
              {sla && sla.length > 0
                ? sla
                : "O prazo é contado em horas úteis (dentro do horário de atendimento). Chamados abertos fora do expediente começam a contar no próximo dia útil. Você vê o prazo de cada chamado na lista e no detalhe."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
