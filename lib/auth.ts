import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "wp_relight_session";

function getAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD is not configured");
  }
  return password;
}

function sign(payload: string): string {
  return createHmac("sha256", getAdminPassword()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyPassword(password: string): boolean {
  return safeEqual(password, getAdminPassword());
}

export function createSessionToken(): string {
  const payload = "authenticated";
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const separatorIndex = token.indexOf(".");
  if (separatorIndex === -1) return false;

  const payload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  if (payload !== "authenticated") return false;

  try {
    return safeEqual(signature, sign(payload));
  } catch {
    return false;
  }
}

export function verifyCronSecret(provided: string | undefined | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured: allow, but this should only happen in local dev.
    return true;
  }
  if (!provided) return false;
  return safeEqual(provided, secret);
}
