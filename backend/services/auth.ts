import crypto from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { pool, hash, requireThat, demo, safeEqual, transaction } from "./db";
import type { PoolClient } from "pg";
import type { Permission } from "@shared/hr";

export type StaffSession = {
  staff: string;
  permissions: Permission[];
  fresh: boolean;
};
export async function auth(hr = false, allowRosterStatus = false) {
  const token = (await cookies()).get(hr ? "ady_hr" : "ady_intern")?.value;
  const row =
    token &&
    (
      await pool.query(
        hr
          ? `SELECT s.invitation,s.hr,h.email AS staff,h.permissions,
              s.verified_at > now()-interval '10 minutes' AS fresh
          FROM sessions s JOIN hr_staff h ON h.email=s.staff
          WHERE s.digest=$1 AND s.hr AND s.expires>now() AND h.enabled AND h.credential_version=s.credential_version`
          : `SELECT s.invitation,s.hr,s.method,s.digest,s.draft_progress,i.status,i.email,i.token FROM sessions s JOIN invitations i ON i.id=s.invitation
          WHERE s.digest=$1 AND (s.method IN ('invitation','mail') OR ($2 AND s.method='roster-status')) AND NOT s.hr AND s.expires>now()
            AND i.intern_access_expires_at>now() AND i.access_revoked_at IS NULL AND i.status <> 'removed'`,
        hr ? [hash(token)] : [hash(token),allowRosterStatus],
      )
    ).rows[0];
  requireThat(
    row,
    hr ? "Sign in to the HR workspace." : "Verify your invitation to continue.",
    401,
  );
  return row;
}
export function permit(staff: StaffSession, ...permissions: Permission[]) {
  requireThat(
    permissions.some((p) => staff.permissions.includes(p)),
    "You do not have permission for this action.",
    403,
  );
}
export function requireFresh(staff: StaffSession) {
  requireThat(
    staff.fresh,
    "Sign in again with your password and access key to continue.",
    428,
  );
}
export async function assigned(
  staff: StaffSession,
  id: string,
  db: Pick<PoolClient, "query"> = pool,
) {
  requireThat(
    (
      await db.query(
        "SELECT 1 FROM hr_assignments a JOIN invitations i ON i.id=a.invitation WHERE a.staff=$1 AND a.invitation=$2 AND i.status <> 'removed'",
        [staff.staff, id],
      )
    ).rowCount,
    "Record unavailable.",
    404,
  );
}
export async function logAccess(
  staff: StaffSession,
  action: string,
  invitation: string | null = null,
  file: string | null = null,
  detail: object = {},
) {
  await pool.query(
    "INSERT INTO hr_access_events(staff,action,invitation,file_id,detail) VALUES($1,$2,$3,$4,$5)",
    [staff.staff, action, invitation, file, detail],
  );
}
const derive = promisify(crypto.scrypt);
export async function login(email: string, password: string, key: string) {
  const token = await transaction(async (db) => {
    const staff = (
      await db.query(
        "SELECT * FROM hr_staff WHERE email=$1 AND enabled FOR SHARE",
        [email],
      )
    ).rows[0];
    if (!staff) return null;
    await db.query(
      "INSERT INTO hr_login(account) VALUES($1) ON CONFLICT DO NOTHING",
      [email],
    );
    const limit = (
      await db.query(
        "SELECT failures,since>now()-interval '10 minutes' AS recent FROM hr_login WHERE account=$1 FOR UPDATE",
        [email],
      )
    ).rows[0];
    requireThat(
      !limit.recent || limit.failures < 8,
      "Try again in ten minutes.",
      429,
    );
    const [salt, expected] = staff.password_hash.split(":");
    const digest = ((await derive(password, salt, 32)) as Buffer).toString(
      "hex",
    );
    const passwordOK = safeEqual(digest, expected);
    const keyOK = safeEqual(hash(key), staff.access_key_hash);
    if (!passwordOK || !keyOK) {
      await db.query(
        "UPDATE hr_login SET failures=$2,since=CASE WHEN $3 THEN since ELSE now() END WHERE account=$1",
        [email, limit.recent ? limit.failures + 1 : 1, limit.recent],
      );
      return null;
    }
    await db.query("UPDATE hr_login SET failures=0 WHERE account=$1", [email]);
    const previous = (await cookies()).get("ady_hr")?.value;
    if (previous)
      await db.query("DELETE FROM sessions WHERE hr AND digest=$1", [
        hash(previous),
      ]);
    const value = crypto.randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO sessions(digest,hr,expires,staff,credential_version,verified_at)
      VALUES($1,true,now()+interval '8 hours',$2,$3,now())`,
      [hash(value), email, staff.credential_version],
    );
    return value;
  });
  requireThat(token, "Check your sign-in details.", 401);
  return token;
}
export async function setLoginCookie(name: "ady_hr" | "ady_intern", value: string, expires: Date) {
  (await cookies()).set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: !demo() || process.env.APP_ORIGIN?.startsWith("https://"),
    path: "/",
    expires,
  });
}
