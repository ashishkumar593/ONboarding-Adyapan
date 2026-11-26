import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { hash, pool, requireThat, transaction } from "./db";
import { session } from "./auth";
import { mail } from "./private";

type Recipient = {
  id: string;
  token: string;
  name: string;
  email: string;
  role: string;
};
type MailKind = "correction" | "issued" | "return";

export async function sendAccessMail(
  db: PoolClient,
  recipient: Recipient,
  kind: MailKind,
  correctionLabel?: string,
) {
  const href = new URL("/apply",process.env.APP_ORIGIN);
  const messages = {
    return: ["Your personal onboarding link","Confirm your email to reopen your saved record."],
    correction: [
      "Adyapan onboarding correction",
      "Please replace your " + correctionLabel + " in the portal.",
    ],
    issued: [
      "Your Adyapan offer letter is ready",
      "Your countersigned offer is ready to download.",
    ],
  };
  const [subject, intro] = messages[kind];
  if (kind === "return") {
    const secret = crypto.randomBytes(32).toString("base64url");
    href.searchParams.set("invite",recipient.token);
    href.hash="access="+secret;
    await db.query("DELETE FROM email_access_links WHERE invitation=$1 AND expires_at<=now()",[recipient.id]);
    await db.query("INSERT INTO email_access_links(digest,invitation,expires_at) VALUES($1,$2,now()+interval '48 hours')",[hash(secret),recipient.id]);
  }
  await mail(
    recipient.email,
    subject,
    [
      "Hello " + recipient.name + ",",
      intro,
      "Open your application:",
      href.toString(),
      "Use the email address on your HR roster.",
      "Adyapan People Operations",
    ].join("\n\n"),
  );
}

export async function remembersBrowser(db: Pick<PoolClient, "query">, id: string, key?: string) {
  if (!key) return false;
  return !!(await db.query(
    "SELECT 1 FROM sessions WHERE invitation=$1 AND digest=$2 AND method='remember-browser' AND expires>now()",
    [id, hash("device:" + key)],
  )).rowCount;
}

export async function rememberBrowser(id: string, sessionToken: string, previous: string | undefined, enable: boolean) {
  return transaction(async db => {
    const record = await db.query("SELECT id FROM invitations WHERE id=$1 AND access_revoked_at IS NULL FOR UPDATE", [id]);
    const active = await db.query("SELECT 1 FROM sessions WHERE invitation=$1 AND digest=$2 AND method IN ('invitation','mail') AND expires>now()", [id, hash(sessionToken)]);
    requireThat(record.rowCount && active.rowCount, "Sign in again to manage this browser.", 401);
    if (previous) await db.query("DELETE FROM sessions WHERE digest=$1 AND method='remember-browser'", [hash("device:" + previous)]);
    if (!enable) return null;
    const key = crypto.randomBytes(32).toString("base64url");
    await db.query(
      "INSERT INTO sessions(digest,invitation,method,expires) VALUES($1,$2,'remember-browser',now()+interval '30 days')",
      [hash("device:" + key), id],
    );
    return key;
  });
}

export async function verifyRosterEmail(email: string, device?: string) {
  return transaction(async db => {
    const recipient = (await db.query(
      `SELECT *,status IN ('queued','invited','draft') AND draft='{}'::jsonb AND reference IS NULL
          AND NOT EXISTS(SELECT 1 FROM files WHERE invitation=i.id)
          AND NOT EXISTS(SELECT 1 FROM sessions WHERE invitation=i.id AND expires>now()) AS first_claim,
          last_access_request_at>now()-interval '1 minute' AND EXISTS(
            SELECT 1 FROM email_access_links WHERE invitation=i.id AND expires_at>now()) AS recently_mailed
       FROM invitations i WHERE lower(email)=$1 AND status <> 'removed'
       ORDER BY starts DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
      [email])).rows[0];
    requireThat(recipient && !recipient.access_revoked_at,"Check the email address or contact HR to join the roster.",401);
    if (await remembersBrowser(db, recipient.id, device)) return session(db,recipient.id);
    if (recipient.first_claim) {
      await db.query("UPDATE invitations SET status='draft',qr_expires_at=NULL WHERE id=$1",[recipient.id]);
      return session(db,recipient.id);
    }
    if (!recipient.recently_mailed) {
      await sendAccessMail(db,recipient,"return");
      await db.query("UPDATE invitations SET last_access_request_at=now() WHERE id=$1",[recipient.id]);
    }
    return null;
  });
}

export async function redeemAccess(token: string, secret: string) {
  return transaction(async db => {
    const recipient = (await db.query("SELECT id FROM invitations WHERE token=$1 AND access_revoked_at IS NULL FOR UPDATE",[token])).rows[0];
    const used = recipient && (await db.query(
      "DELETE FROM email_access_links WHERE invitation=$1 AND digest=$2 AND expires_at>now() RETURNING invitation",
      [recipient.id,hash(secret)])).rowCount;
    requireThat(used,"This link has expired or has already been used. Enter your invited email to continue.",401);
    await db.query("UPDATE invitations SET qr_expires_at=NULL WHERE id=$1",[recipient.id]);
    await db.query("DELETE FROM sessions WHERE invitation=$1 AND verified_at IS NULL",[recipient.id]);
    const value = await session(db,recipient.id);
    await db.query("UPDATE sessions SET verified_at=now(),method='mail' WHERE digest=$1",[hash(value)]);
    return value;
  });
}

export async function changeAccess(id: string, actor: string, restore: boolean) {
  return transaction(async db => {
    const row = (await db.query("SELECT * FROM invitations WHERE id=$1 AND status <> 'removed' FOR UPDATE",[id])).rows[0];
    requireThat(row,"Record unavailable.",404);
    if (restore) requireThat(row.access_revoked_at,"Access is already active.",409);
    const token = crypto.randomBytes(24).toString("base64url");
    await db.query("UPDATE invitations SET token=$2,access_revoked_at=CASE WHEN $3 THEN NULL ELSE now() END,qr_expires_at=NULL,last_access_request_at=NULL WHERE id=$1",[id,token,restore]);
    await db.query("DELETE FROM sessions WHERE invitation=$1",[id]);
    await db.query("DELETE FROM email_access_links WHERE invitation=$1",[id]);

    await db.query("INSERT INTO events(invitation,action,detail) VALUES($1,$2,$3)",[id,restore?"access restored":"access revoked",{actor}]);
    return {ok:true};
  });
}
