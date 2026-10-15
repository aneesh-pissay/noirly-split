import { NextResponse, type NextRequest } from "next/server";
import { consumeRateLimit } from "@/src/server/security/rate-limit";

function configuredOrigin(value: string | undefined) {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
}

/**
 * Checks every API request before it reaches a route: a cookie-signed change
 * must come from this app's own pages (same origin, plus a header only our
 * scripts send), and each client IP gets at most 300 API requests a minute.
 *
 * All Noirly apps share one parent domain, so the browser's SameSite cookie
 * rule treats them as one site; it can't stop another Noirly app's page from
 * sending a cookie-signed request here. These checks can.
 *
 * Returns a response to send instead, or null to let the request through.
 */
export async function guardApiRequest(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/") || pathname.startsWith("/api/auth/")) return null;

  const bearer = /^Bearer\s+\S+$/i.test(request.headers.get("authorization") ?? "");
  if (!bearer && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const fail = () => NextResponse.json({ error: "csrf_failed" }, { status: 403 });
    const origin = request.headers.get("origin");
    const expected = configuredOrigin(process.env.AUTH_URL) || request.nextUrl.origin;
    if (origin && origin !== expected) return fail();
    if (request.headers.get("sec-fetch-site") === "cross-site") return fail();
    if (request.headers.get("x-noirly-csrf") !== "1") return fail();
  }

  try {
    const ip =
      request.headers.get(process.env.TRUSTED_CLIENT_IP_HEADER ?? "x-forwarded-for")?.split(",").at(-1)?.trim() ??
      "unknown";
    const limit = await consumeRateLimit(`api:${ip}`, 300, 60);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
  } catch {
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });
  }
  return null;
}
