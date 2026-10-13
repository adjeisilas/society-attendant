export const routes = {
  home: "/dashboard",
  signIn: "/login",
  forgotPassword: "/forgot-password",
  setPassword: "/set-password",
  confirmEmailLink: "/auth/confirm",
  accountDisabled: "/account-disabled",
  setup: "/setup",
  /** The clock-in screen shown on a registered attendance terminal. */
  terminal: "/terminal",
} as const;

/**
 * Paths reachable without a session. Everything else requires sign-in. The terminal is
 * public because staff sign in per clock-in there; it only works on a registered computer.
 */
const PUBLIC_PATHS: readonly string[] = [routes.signIn, routes.forgotPassword, routes.confirmEmailLink, routes.terminal];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

const REDIRECT_BASE = "https://redirect.invalid";

/**
 * Turns untrusted input (such as a `?next=` parameter) into a same-origin application
 * path, or returns the fallback. Prevents open redirects.
 */
export function safeRedirectPath(value: unknown, fallback: string = routes.home): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }

  let url: URL;
  try {
    url = new URL(value, REDIRECT_BASE);
  } catch {
    return fallback;
  }

  if (url.origin !== REDIRECT_BASE || isPublicPath(url.pathname)) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
