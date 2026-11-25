import crypto from "node:crypto";
import { cookies } from "next/headers";
import { pool, hash, requireThat, demo, safeEqual } from "./db";
import type { PoolClient } from "pg";
export async function auth(hr = false) {
  const token = (await cookies()).get(hr ? "ady_hr" : "ady_intern")?.value;
  const row =
    token &&
    (
      await pool.query(
        "SELECT invitation,hr FROM sessions WHERE digest=$1 AND hr=$2 AND expires>now()",
        [hash(token), hr],
      )
    ).rows[0];
  requireThat(
    row,
    hr ? "Sign in to the HR workspace." : "Verify your invitation to continue.",
    401,
  );
  return row;
}
export async function session(db: PoolClient, invitation: string | null) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions VALUES($1,$2,$3,now()+CASE WHEN $3 THEN interval '8 hours' ELSE interval '1 day' END)",
    [hash(token), invitation, !invitation],
  );
  return token;
}
export async function setSession(token: string, hr = false) {
  (await cookies()).set(hr ? "ady_hr" : "ady_intern", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: !demo() || process.env.APP_ORIGIN?.startsWith("https://"),
    path: "/",
    maxAge: hr ? 28800 : 86400,
  });
}
export function hrPassword(password: string) {
  const [salt, expected] = (process.env.HR_PASSWORD_HASH || "").split(":");
  if (!salt || !expected) return false;
  return safeEqual(
    crypto.scryptSync(password, salt, 32).toString("hex"),
    expected,
  );
}
