"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { AuthShell, GlowInput, ShineButton } from "@/components/auth/auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <AuthShell>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <CheckCircle className="h-6 w-6 text-primary" />
        </div>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          Confira seu e-mail
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enviamos um link para redefinir a senha para{" "}
          <span className="text-foreground">{email}</span>. Abra sua caixa de
          entrada.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Voltar para entrar
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-6 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/redezap-logo-light.png"
          alt="RedeZap"
          className="h-9 w-auto object-contain [[data-mode=dark]_&]:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/redezap-logo-dark.png"
          alt="RedeZap"
          className="hidden h-9 w-auto object-contain [[data-mode=dark]_&]:block"
        />
      </div>

      <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
        Recuperar senha
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Informe seu e-mail e enviaremos um link para redefinir a senha.
      </p>

      <form onSubmit={handleReset} className="mt-8 flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm text-muted-foreground">
            E-mail
          </label>
          <GlowInput
            id="email"
            type="email"
            autoComplete="email"
            placeholder="voce@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <ShineButton disabled={loading}>
          {loading ? "Enviando..." : "Enviar link"}
        </ShineButton>
      </form>

      <Link
        href="/login"
        className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para entrar
      </Link>
    </AuthShell>
  );
}
