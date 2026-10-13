import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, routes } from "@/lib/auth/routes";
import { refreshSession } from "@/lib/supabase/proxy";

const SESSION_HEADERS = ["cache-control", "expires", "pragma"];

/**
 * Keeps the Supabase session fresh and sends signed-out visitors to sign in.
 * This is an optimistic check: pages and server actions re-verify the user
 * through the data access layer (src/lib/auth/session.ts).
 */
export async function proxy(request: NextRequest) {
  const { response, isAuthenticated } = await refreshSession(request);
  const { pathname, search } = request.nextUrl;

  if (isAuthenticated || isPublicPath(pathname)) {
    return response;
  }

  const signInUrl = new URL(routes.signIn, request.url);
  if (pathname !== "/") {
    signInUrl.searchParams.set("next", `${pathname}${search}`);
  }

  const redirect = NextResponse.redirect(signInUrl);
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  for (const header of SESSION_HEADERS) {
    const value = response.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
