"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import {
  UnitScopeProvider,
  type UnitScopeInitial,
} from "@/components/units/unit-scope-provider";

// Empty scope for the (rare) case where the server couldn't resolve the
// unit context — the selector renders nothing and lists stay unfiltered.
const EMPTY_UNIT_SCOPE: UnitScopeInitial = {
  selectedUnitId: null,
  visibleUnits: [],
  canSeeAll: false,
};

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({
  children,
  unitScope,
}: {
  children: React.ReactNode;
  unitScope: UnitScopeInitial;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    // Active-unit scope wraps the whole authenticated shell so both the
    // topbar selector (in Header) and the list pages (in children) read
    // the same reactive selection.
    <UnitScopeProvider initial={unitScope}>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Reports this tab's online/away presence once we know a user is
            signed in. Headless — renders nothing. */}
        <PresenceHeartbeat />
        <Sidebar open={sidebarOpen} onClose={closeSidebar} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header onOpenSidebar={() => setSidebarOpen(true)} />
          {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            {/* Above every page: writes are being rejected and here's why.
                Renders nothing unless the account/role failed to resolve. */}
            <AccountAccessAlert />
            {children}
          </main>
        </div>
      </div>
    </UnitScopeProvider>
  );
}

export function DashboardShell({
  children,
  unitScope,
}: {
  children: React.ReactNode;
  unitScope: UnitScopeInitial | null;
}) {
  return (
    <AuthProvider>
      <DashboardShellInner unitScope={unitScope ?? EMPTY_UNIT_SCOPE}>
        {children}
      </DashboardShellInner>
    </AuthProvider>
  );
}
