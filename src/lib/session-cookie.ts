import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/sessions";

const COOKIE = "session";

/**
 * How the session cookie is sent. `secure` cookies are `SameSite=None`, so a
 * frontend on another site (HTTPS only) can send them with
 * `credentials: "include"`; otherwise `SameSite=Lax`, which is enough for a
 * frontend on another `localhost` port.
 */
export type CookieOptions = { secure: boolean };

/** The session token from the request's cookie. */
export function readSessionToken(c: Context): string | undefined {
  return getCookie(c, COOKIE);
}

export function writeSessionCookie(
  c: Context,
  token: string,
  { secure }: CookieOptions,
): void {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: secure ? "None" : "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(
  c: Context,
  { secure }: CookieOptions,
): void {
  deleteCookie(c, COOKIE, {
    httpOnly: true,
    secure,
    sameSite: secure ? "None" : "Lax",
    path: "/",
  });
}
