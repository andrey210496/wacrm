import type { Metadata } from "next";

// Shown instead of the dashboard shell when this SILO instance's
// license is suspended (see src/lib/license/guard.ts). Deliberately
// has no app chrome (sidebar/header) — the account may be suspended
// precisely because the underlying data shouldn't be reachable.
export const metadata: Metadata = {
  title: "Conta suspensa",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function SuspendedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6 text-amber-500"
            aria-hidden="true"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" x2="12" y1="9" y2="13" />
            <line x1="12" x2="12.01" y1="17" y2="17" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-foreground">
          Conta temporariamente suspensa
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O acesso a esta conta foi suspenso, geralmente por uma pendência
          de pagamento. Assim que a situação for regularizada, o acesso
          volta a funcionar normalmente — nenhum dado foi perdido.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          Precisa de ajuda? Fale com o suporte para verificar a situação
          da sua assinatura.
        </p>
      </div>
    </div>
  );
}
