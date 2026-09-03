"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  Bell,
  Bot,
  Building2,
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { hasMinRole, type AccountRole } from "@/lib/auth/roles";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    className: "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    className: "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    className: "border-border bg-card text-muted-foreground",
  },
};

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  beta?: boolean;
  minRole?: AccountRole;
}

interface NavSection {
  /** Section eyebrow (shown only when the sidebar is expanded). */
  label?: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    items: [
      { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
      {
        href: "/dashboard/consolidado",
        labelKey: "consolidado",
        icon: Building2,
        minRole: "admin",
      },
      { href: "/notifications", labelKey: "notifications", icon: Bell },
    ],
  },
  {
    label: "Atendimento",
    items: [
      { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
      { href: "/contacts", labelKey: "contacts", icon: Users },
      { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
    ],
  },
  {
    label: "Alcance",
    items: [
      { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
      { href: "/automations", labelKey: "automations", icon: Zap },
      { href: "/flows", labelKey: "flows", icon: Workflow, beta: true },
    ],
  },
  {
    label: "Inteligência",
    items: [{ href: "/agents", labelKey: "aiAgents", icon: Bot }],
  },
];

const bottomNavItems: NavItem[] = [
  { href: "/settings", labelKey: "settings", icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  // Desktop hover-to-expand: collapsed to an icon rail, expands on hover.
  const [hovered, setHovered] = useState(false);

  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the mobile drawer when route changes.
  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll + Escape-to-close while the mobile drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // One nav row. `expanded` controls whether the label + badges show or
  // the row collapses to a centered icon (with a dot for unread state).
  const renderNavRow = (item: NavItem, expanded: boolean) => {
    const isActive =
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href));
    const showUnreadDot =
      item.href === "/inbox" && totalUnread > 0 && !isActive;
    const showNotificationBadge =
      item.href === "/notifications" && unreadNotifications > 0;
    const hasDot = showUnreadDot || showNotificationBadge;

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          title={expanded ? undefined : t(item.labelKey as string)}
          className={cn(
            "relative flex items-center rounded-lg text-sm transition-colors",
            expanded ? "gap-3 px-3 py-2.5 lg:py-2" : "justify-center py-2.5",
            isActive
              ? "bg-muted/70 font-semibold text-foreground before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r-full before:bg-primary"
              : "font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <span className="relative flex shrink-0">
            <item.icon
              className={cn(
                "h-4 w-4",
                isActive ? "text-primary" : "text-muted-foreground/80",
              )}
            />
            {!expanded && hasDot && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
            )}
          </span>
          {expanded && (
            <>
              <span className="flex-1 whitespace-nowrap">
                {t(item.labelKey as string)}
              </span>
              {item.beta && (
                <span
                  aria-label={t("beta")}
                  className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
                >
                  {t("beta")}
                </span>
              )}
              {showUnreadDot && (
                <span
                  aria-label={t("unreadConversations", { count: totalUnread })}
                  className="relative flex h-2 w-2"
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
              )}
              {showNotificationBadge && (
                <span
                  aria-label={t("unreadNotifications", {
                    count: unreadNotifications,
                  })}
                  className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                >
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
            </>
          )}
        </Link>
      </li>
    );
  };

  // Full sidebar body, collapse-aware. Reused by the desktop hover rail
  // and the mobile drawer (which is always expanded).
  const body = (expanded: boolean) => (
    <>
      {/* Logo row */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 border-b border-border",
          expanded ? "justify-between px-4" : "justify-center px-2",
        )}
      >
        <Link href="/dashboard" className="flex items-center">
          {expanded ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/redezap-logo-light.png"
                alt="RedeZap"
                className="h-11 w-auto object-contain [[data-mode=dark]_&]:hidden"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/redezap-logo-dark.png"
                alt="RedeZap"
                className="hidden h-11 w-auto object-contain [[data-mode=dark]_&]:block"
              />
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/redezap-mark.png"
              alt="RedeZap"
              className="h-8 w-8 object-contain"
            />
          )}
        </Link>
        {/* Close button — mobile drawer only. */}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closeMenu")}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden",
            expanded ? "" : "hidden",
          )}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Main navigation — grouped by job-to-be-done. */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden py-4",
          expanded ? "px-3" : "px-2",
        )}
      >
        {navSections.map((section, si) => {
          const items = section.items.filter(
            (item) =>
              !item.minRole ||
              (accountRole && hasMinRole(accountRole, item.minRole)),
          );
          if (items.length === 0) return null;
          return (
            <div key={section.label ?? "top"} className={si === 0 ? "" : "mt-6"}>
              {section.label && expanded ? (
                <p className="px-3 pb-1.5 font-heading text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
                  {section.label}
                </p>
              ) : null}
              {section.label && !expanded ? (
                <div className="mx-2 mb-2 border-t border-border/60" />
              ) : null}
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => renderNavRow(item, expanded))}
              </ul>
            </div>
          );
        })}

        <div
          className={cn(
            "my-4 border-t border-border",
            expanded ? "mx-3" : "mx-2",
          )}
        />

        <ul className="flex flex-col gap-0.5">
          {bottomNavItems.map((item) => renderNavRow(item, expanded))}
        </ul>
      </nav>

      {/* User section */}
      <div
        className={cn(
          "shrink-0 border-t border-border",
          expanded ? "p-3" : "p-2",
        )}
      >
        {expanded && showAccountStrip && account?.name ? (
          <div className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
            <UsersRound className="size-3.5 shrink-0" />
            <span className="truncate" title={account.name}>
              {account.name}
            </span>
            {accountRole ? (
              (() => {
                const meta = ROLE_CHIP[accountRole];
                const Icon = meta.icon;
                return (
                  <span
                    className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                  >
                    <Icon className="size-3" />
                    {t(meta.labelKey as string)}
                  </span>
                );
              })()
            ) : null}
          </div>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            title={expanded ? undefined : (profile?.full_name ?? t("defaultUser"))}
            className={cn(
              "flex w-full items-center rounded-lg text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60",
              expanded ? "gap-3 px-3 py-2" : "justify-center py-2",
            )}
          >
            <Avatar className="size-8 shrink-0">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? t("defaultAvatar")}
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                {profile?.full_name?.charAt(0)?.toUpperCase() ??
                  profile?.email?.charAt(0)?.toUpperCase() ??
                  "U"}
              </AvatarFallback>
            </Avatar>
            {expanded && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={expanded ? "end" : "start"}
            side="top"
            sideOffset={6}
            className="min-w-56 bg-popover text-popover-foreground ring-border"
          >
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=profile"
                  onClick={onClose}
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                />
              }
            >
              <User className="size-4" />
              {t("menuProfile")}
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=whatsapp"
                  onClick={onClose}
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                />
              }
            >
              <Settings className="size-4" />
              {t("menuSettings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={signOut}
              className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
            >
              <LogOut className="size-4" />
              {t("menuSignOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      {/* Mobile drawer — always expanded when open. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-background lg:hidden",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Primary"
      >
        {body(true)}
      </aside>

      {/* Desktop hover-expand rail. The reserve div holds the collapsed
          width in the flex row; the fixed panel grows over the content on
          hover so nothing reflows. */}
      <div className="hidden lg:block lg:w-[72px] lg:shrink-0">
        <motion.aside
          className="fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-border bg-background"
          initial={false}
          animate={{ width: hovered ? 256 : 72 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          aria-label="Primary"
        >
          {body(hovered)}
        </motion.aside>
      </div>
    </>
  );
}
