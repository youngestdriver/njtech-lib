import { createHmac, timingSafeEqual } from "node:crypto";

export function signToken(accessPassword: string, ttlSec: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlSec * 1000 }))
    .toString("base64url");
  const sig = createHmac("sha256", accessPassword).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string | undefined, accessPassword: string): boolean {
  if (!token) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const [payload, sig] = [token.slice(0, i), token.slice(i + 1)];
  const expect = createHmac("sha256", accessPassword).update(payload).digest();
  let got: Buffer;
  try { got = Buffer.from(sig, "base64url"); } catch { return false; }
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return false;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  return typeof data.exp === "number" && data.exp > Date.now();
}
