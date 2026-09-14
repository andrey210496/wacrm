"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { UsersRound } from "lucide-react";
import { AuthShell, GlowInput, ShineButton } from "@/components/auth/auth-shell";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("LoginPage");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Full-page navigation so the fresh Supabase auth cookies reach the
    // middleware before it gates /dashboard (issue #365).
    const destination = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : "/dashboard";
    window.location.href = destination;
  };

  return (
    <AuthShell>
      <div className="mb-8 flex items-center gap-2">
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
        {inviteToken ? t("titleAccept") : t("titleWelcome")}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {inviteToken ? t("descAccept") : t("descWelcome")}
      </p>

      <form onSubmit={handleLogin} className="mt-8 flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm text-muted-foreground">
            {t("emailLabel")}
          </label>
          <GlowInput
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm text-muted-foreground">
              {t("passwordLabel")}
            </label>
            <Link
              href="/forgot-password"
              className="text-sm text-primary hover:text-primary/80"
            >
              {t("forgotPassword")}
            </Link>
          </div>
          <GlowInput
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <ShineButton disabled={loading}>
          {loading ? t("signingIn") : t("signIn")}
        </ShineButton>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link
          href={
            inviteToken
              ? `/signup?invite=${encodeURIComponent(inviteToken)}`
              : "/signup"
          }
          className="font-medium text-primary hover:text-primary/80"
        >
          {t("createAccount")}
        </Link>
      </p>
    </AuthShell>
  );
}
