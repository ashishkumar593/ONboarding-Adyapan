import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { hash, requireThat, transaction } from "./db";
import { rosterGroup } from "./model";
import { session } from "./auth";
import { mail } from "./private";

type Recipient = {
  id: string;
  token: string;
  name: string;
  email: string;
  role: string;
};
type MailKind = "invitation" | "correction" | "issued";

export async function sendAccessMail(
  db: PoolClient,
  recipient: Recipient,
  kind: MailKind,
  correctionLabel?: string,
) {
  const secret = crypto.randomBytes(32).toString("base64url");
  const href = new URL("/apply", process.env.APP_ORIGIN);
  href.searchParams.set("invite", recipient.token);
  href.hash = "access=" + secret;
  const messages = {
    invitation: [
      "Your Adyapan internship invitation",
      "You’re invited to onboard as " + recipient.role + ".",
    ],
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
  await db.query(
    "DELETE FROM email_access_links WHERE invitation=$1 AND expires_at<=now()",
    [recipient.id],
  );
  await db.query(
    "INSERT INTO email_access_links(digest,invitation,expires_at) VALUES($1,$2,now()+interval '48 hours')",
    [hash(secret), recipient.id],
  );
  await mail(
    recipient.email,
    subject,
    [
      "Hello " + recipient.name + ",",
      intro,
      "Open your application:",
      href.toString(),
      "Keep this invitation private. If prompted, enter the email address HR invited.",
      "Adyapan People Operations",
    ].join("\n\n"),
  );
}

export async function emailInvitation(id: string, onlyPending = false) {
  return transaction(async (db) => {
    const recipient = (
      await db.query(
        "SELECT id, token, name, email, role, status, reference, invitation_email_sent_at FROM invitations WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    requireThat(recipient, "Invitation unavailable.", 404);
    const group = rosterGroup(recipient);
    if (onlyPending && group !== "pending") return false;
    requireThat(group !== "received", "This intern has already submitted their documents.", 409);
    await sendAccessMail(db, recipient, "invitation");
    await db.query(
      "UPDATE invitations SET invitation_email_sent_at=now(), status=CASE WHEN status='queued' THEN 'invited' ELSE status END WHERE id=$1",
      [id],
    );
    return true;
  });
}

export async function verifyInvitation(email: string, token: string) {
  return transaction(async (db) => {
    const result = await db.query(
      "SELECT id FROM invitations WHERE token=$1 AND email=$2 AND status <> 'queued'",
      [token, email],
    );
    requireThat(result.rowCount, "Check the email address and use the invitation HR sent you.", 401);
    return session(db, result.rows[0].id);
  });
}

export async function redeemAccess(token: string, secret: string) {
  return transaction(async (db) => {
    const row = (
      await db.query(
        "DELETE FROM email_access_links AS l USING invitations AS i WHERE l.invitation=i.id AND i.token=$1 AND l.digest=$2 AND l.expires_at>now() RETURNING i.id",
        [token, hash(secret)],
      )
    ).rows[0];
    requireThat(
      row,
      "This link has expired or has already been used. Enter your invited email to continue.",
      401,
    );
    return session(db, row.id);
  });
}
