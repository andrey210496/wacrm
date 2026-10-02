"use client";

import { useState, type ReactNode } from "react";

/**
 * Email / password field with a mouse-following green glow on its top and
 * bottom edges (RedeZap accent). Purely cosmetic; a normal controlled input.
 */
export function GlowInput({
  id,
  type,
  placeholder,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(false);
  return (
    <div className="relative w-full">
      <input
        id={id}
        type={type}
        required
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="peer relative z-10 h-12 w-full rounded-lg border border-border bg-muted px-4 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20"
      />
      {hover && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-0.5 rounded-t-lg"
            style={{
              background: `radial-gradient(30px circle at ${pos.x}px 0px, var(--primary) 0%, transparent 70%)`,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-0.5 rounded-b-lg"
            style={{
              background: `radial-gradient(30px circle at ${pos.x}px 2px, var(--primary) 0%, transparent 70%)`,
            }}
          />
        </>
      )}
    </div>
  );
}

/** Gradient submit button with a diagonal shine sweep on hover. */
export function ShineButton({
  children,
  disabled,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="group/btn relative mt-2 inline-flex h-11 w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-tl from-primary to-primary-hover text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/25 transition-all hover:brightness-110 disabled:opacity-50"
    >
      <span className="relative z-10">{children}</span>
      <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-13deg)_translateX(-100%)] group-hover/btn:duration-1000 group-hover/btn:[transform:skew(-13deg)_translateX(100%)]">
        <div className="relative h-full w-8 bg-white/20" />
      </div>
    </button>
  );
}

/**
 * Two-panel auth shell: a form column (left, with an ambient cursor glow)
 * and the RedeZap brand panel (right). Every auth screen — sign in, sign up,
 * reset — renders its form as `children` so they stay visually identical.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const [blob, setBlob] = useState({ x: 0, y: 0 });
  const [blobOn, setBlobOn] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex min-h-[600px] w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10">
        {/* Left: form */}
        <div
          className="relative w-full overflow-hidden px-6 py-10 sm:px-10 lg:w-1/2 lg:px-16"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setBlob({ x: e.clientX - r.left, y: e.clientY - r.top });
          }}
          onMouseEnter={() => setBlobOn(true)}
          onMouseLeave={() => setBlobOn(false)}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute h-[500px] w-[500px] rounded-full bg-gradient-to-r from-primary/25 via-emerald-400/15 to-primary/25 blur-3xl transition-opacity duration-200"
            style={{
              transform: `translate(${blob.x - 250}px, ${blob.y - 250}px)`,
              opacity: blobOn ? 1 : 0,
            }}
          />
          <div className="relative z-10 mx-auto flex h-full max-w-sm flex-col justify-center">
            {children}
          </div>
        </div>

        {/* Right: RedeZap brand panel (system-context texture, not stock) */}
        <div className="relative hidden w-1/2 overflow-hidden lg:block">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 via-primary to-[oklch(0.28_0.06_180)]" />
          <div
            aria-hidden
            className="absolute inset-0 bg-repeat"
            style={{
              backgroundImage: "url('/inbox-doodle.svg')",
              backgroundSize: "340px",
              filter: "brightness(0) invert(1)",
              opacity: 0.12,
            }}
          />
          <div className="absolute inset-0 bg-black/10" />
          <div className="relative flex h-full flex-col justify-between p-12 text-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/redezap-mark.png"
              alt="RedeZap"
              className="h-11 w-11 object-contain drop-shadow"
            />
            <div>
              <h2 className="font-heading text-3xl font-bold leading-tight tracking-tight">
                A rede toda no mesmo lugar.
              </h2>
              <p className="mt-3 max-w-sm text-white/85">
                Cada unidade com seu número de WhatsApp, e a gestão enxergando
                todos os leads num painel só.
              </p>
            </div>
            <p className="text-xs text-white/60">
              RedeZap · CRM de leads para redes e franquias
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
