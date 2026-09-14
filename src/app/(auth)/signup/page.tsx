"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, UsersRound } from "lucide-react";
import { AuthShell, GlowInput, ShineButton } from "@/components/auth/auth-shell";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const loginHref = inviteToken
    ? `/login?invite=${encodeURIComponent(inviteToken)}`
    : "/login";

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);

    // Defesa em profundidade: mesmo que uma cópia em cache desta página
    // escape do redirect do middleware, re-checamos se o cadastro está
    // desativado (SIGNUP_DISABLED é server-only) antes de chamar o Supabase.
    try {
      const statusRes = await fetch(
        `/api/auth/signup-status${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""}`,
        { cache: "no-store" },
      );
      const { disabled } = (await statusRes.json()) as { disabled: boolean };
      if (disabled) {
        setError(
          "Novos cadastros estão desativados nesta instância. Se você recebeu um convite, use o link do convite; caso contrário, fale com quem administra esta conta.",
        );
        setLoading(false);
        return;
      }
    } catch (err) {
      // Fail-open: uma falha de rede nesta checagem não deve bloquear um
      // cadastro legítimo. O redirect do middleware segue como controle.
      console.error("[signup] signup-status check failed:", err);
    }

    const emailRedirectTo = inviteToken
      ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
      : undefined;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
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
          Enviamos um link de confirmação para{" "}
          <span className="text-foreground">{email}</span>. Abra sua caixa de
          entrada e clique no link para verificar sua conta.
        </p>
        <Link
          href={loginHref}
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
        {inviteToken ? (
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <UsersRound className="h-6 w-6 text-primary" />
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
        {inviteToken ? "Criar conta e entrar" : "Criar conta"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {inviteToken
          ? "Verifique seu e-mail e aceite o convite para entrar na equipe."
          : "Comece a usar o RedeZap"}
      </p>

      <form onSubmit={handleSignup} className="mt-6 flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="fullName" className="text-sm text-muted-foreground">
            Nome completo
          </label>
          <GlowInput
            id="fullName"
            type="text"
            autoComplete="name"
            placeholder="Seu nome"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm text-muted-foreground">
            Senha
          </label>
          <GlowInput
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="Pelo menos 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirmPassword" className="text-sm text-muted-foreground">
            Confirmar senha
          </label>
          <GlowInput
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Repita sua senha"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        <ShineButton disabled={loading}>
          {loading ? "Criando conta..." : "Criar conta"}
        </ShineButton>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        Já tem uma conta?{" "}
        <Link href={loginHref} className="font-medium text-primary hover:text-primary/80">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
