"use client";

import { CalendarDays, Hospital, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { signOut } from "@/features/auth/actions";
import { activeNavigationHref, type NavigationSection } from "@/lib/navigation";
import { NavigationBell } from "./notification-bell-wrapper";
import { NavigationIcon } from "./navigation-icon";
import styles from "./app-shell.module.css";

export interface ShellUser {
  displayName: string;
  roleLabel: string;
  /** The hospital's name, or a note that it is not set up yet. */
  contextLabel: string;
  /** Today's date in the hospital's time zone, already formatted. */
  todayLabel: string;
}

interface AppShellProps {
  user: ShellUser;
  navigation: NavigationSection[];
  unreadNotifications: number;
  children: ReactNode;
}

export function AppShell({ user, navigation, unreadNotifications, children }: AppShellProps) {
  const pathname = usePathname();
  const sidebarId = useId();
  const [menuOpen, setMenuOpen] = useState(false);

  const availableHrefs = navigation.flatMap((section) =>
    section.items.filter((item) => item.available).map((item) => item.href),
  );
  const activeHref = activeNavigationHref(pathname, availableHrefs);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to main content
      </a>

      <aside id={sidebarId} className={styles.sidebar} data-open={menuOpen} data-print-hide>
        <div className={styles.brand}>
          <BrandMark tone="dark" />
          <div className={styles.brandText}>
            <span className={styles.brandName}>Staff Attendance</span>
            <span className={styles.brandContext}>Clock in · Clock out</span>
          </div>
          <button type="button" className={styles.closeButton} onClick={closeMenu} aria-label="Close navigation">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className={styles.nav} aria-label="Main">
          {navigation.map((section) => (
            <div key={section.label} className={styles.navSection}>
              <p className={styles.navSectionLabel}>{section.label}</p>
              <ul className={styles.navList}>
                {section.items.map((item) => (
                  <li key={item.href}>
                    {item.available ? (
                      <Link
                        href={item.href}
                        className={styles.navLink}
                        aria-current={item.href === activeHref ? "page" : undefined}
                        onClick={closeMenu}
                      >
                        <NavigationIcon name={item.icon} />
                        <span>{item.label}</span>
                      </Link>
                    ) : (
                      <span className={styles.navLink} aria-disabled="true">
                        <NavigationIcon name={item.icon} />
                        <span>{item.label}</span>
                        <span className={styles.pendingBadge}>Soon</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className={styles.userCard}>
          <span className={styles.avatar} aria-hidden="true">
            {initials(user.displayName)}
          </span>
          <div className={styles.identity}>
            <span className={styles.identityName}>{user.displayName}</span>
            <span className={styles.identityRole}>{user.roleLabel}</span>
          </div>
          <form action={signOut}>
            <button type="submit" className={styles.signOut} aria-label="Sign out" title="Sign out">
              <LogOut size={17} aria-hidden="true" />
            </button>
          </form>
        </div>
      </aside>

      {menuOpen && <div className={styles.backdrop} onClick={closeMenu} aria-hidden="true" />}

      <div className={styles.main}>
        <header className={styles.topbar} data-print-hide>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setMenuOpen(true)}
            aria-controls={sidebarId}
            aria-expanded={menuOpen}
            aria-label="Open navigation"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className={styles.context}>
            <span className={styles.contextIcon} aria-hidden="true">
              <Hospital size={17} />
            </span>
            <span className={styles.contextText}>
              <span className={styles.contextLabel}>Workplace</span>
              <span className={styles.contextName}>{user.contextLabel}</span>
            </span>
          </div>
          <div className={styles.topbarActions}>
            <p className={styles.today}>
              <CalendarDays size={15} aria-hidden="true" />
              <span>{user.todayLabel}</span>
            </p>
            <NavigationBell unreadCount={unreadNotifications} />
          </div>
        </header>

        <main id="main-content" className={styles.content} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0][0], words[words.length - 1][0]] : [words[0]?.[0] ?? "?"];
  return letters.join("").toUpperCase();
}
