"use client";

import type { Route } from "next";
import Link from "next/link";
import { Inbox, Settings2, Sparkles, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type NavItem = {
  label: string;
  icon: LucideIcon;
  active: boolean;
  href?: Route;
  onSelect?: () => void;
  badge?: string | number | null;
};

type StatItem = {
  label: string;
  value: string | number;
};

type AppShellProps = {
  workspaceKey: string;
  secondaryLabel: string;
  secondaryItems: NavItem[];
  stats?: StatItem[];
  children: ReactNode;
};

const primaryItems = [
  {
    href: "/mail" as Route,
    label: "Mail",
    icon: Inbox
  },
  {
    href: "/settings/models" as Route,
    label: "Settings",
    icon: Settings2
  }
] as const;

function NavButton({ item }: { item: NavItem }) {
  const content = (
    <>
      <item.icon size={18} />
      <span>{item.label}</span>
      {item.badge !== null && item.badge !== undefined ? <em className="nav-badge">{item.badge}</em> : null}
    </>
  );

  if (item.href) {
    return (
      <Link className={`nav-button ${item.active ? "active" : ""}`} href={item.href}>
        {content}
      </Link>
    );
  }

  return (
    <button className={`nav-button ${item.active ? "active" : ""}`} onClick={item.onSelect} type="button">
      {content}
    </button>
  );
}

export function AppShell({
  workspaceKey,
  secondaryLabel,
  secondaryItems,
  stats,
  children
}: AppShellProps) {
  return (
    <main className="client-shell">
      <div className="client-app" data-workspace={workspaceKey}>
        <aside className="client-nav" data-testid="client-nav">
          <div className="nav-stack">
            <div className="nav-brand">
              <div className="nav-mark">
                <Sparkles size={18} />
              </div>
              <div>
                <div className="eyebrow">AI email client</div>
                <h1>Smart Mail</h1>
              </div>
            </div>

            <div className="nav-cluster">
              <span className="nav-section-label">App</span>
              <div className="nav-group nav-group-primary">
                {primaryItems.map((item) => (
                  <NavButton
                    key={item.href}
                    item={{
                      ...item,
                      active: item.href === "/mail" ? !workspaceKey.startsWith("settings") : workspaceKey.startsWith("settings")
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="nav-cluster">
              <span className="nav-section-label">{secondaryLabel}</span>
              <div className="nav-group nav-group-secondary">
                {secondaryItems.map((item) => (
                  <NavButton key={`${item.href ?? item.label}`} item={item} />
                ))}
              </div>
            </div>
          </div>

          {stats?.length ? (
            <div className="nav-stats">
              {stats.map((stat) => (
                <div key={stat.label} className="nav-stat">
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </aside>

        <section className="client-main">{children}</section>
      </div>
    </main>
  );
}
