import crypto from "node:crypto";
import { hash, requireThat, transaction } from "./db";
import { mail } from "./private";

type Recipient = {
  name: string;
  email: string;
};
type MailKind = "correction" | "issued";

export async function sendAccessMail(
  recipient: Recipient,
  kind: MailKind,
  correctionLabel?: string,
) {
  const href = new URL("/apply",process.env.APP_ORIGIN);
  const messages = {
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

export async function verifyRosterEmail(email: string) {
  return transaction(async db => {
    const { rows: [record] } = await db.query(
      `SELECT id, access_revoked_at, intern_access_expires_at <= now() AS expired
       FROM invitations WHERE lower(email)=$1 AND status <> 'removed'
       ORDER BY starts DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE`, [email],
    );
    requireThat(record && !record.access_revoked_at, "Check the email address or contact HR to join the roster.", 401);
    requireThat(!record.expired, "Your 30-day onboarding access has ended. Contact HR.", 403);

    // Evaluate this after taking the roster lock so concurrent sign-ins cannot both claim an empty record.
    const { rows: [application] } = await db.query(
      `SELECT status IN ('queued','invited','draft') AND draft='{}'::jsonb AND reference IS NULL
         AND NOT EXISTS (SELECT 1 FROM files WHERE invitation=i.id AND slot <> 'original')
         AND NOT EXISTS (SELECT 1 FROM submissions WHERE invitation=i.id)
         AND NOT EXISTS (SELECT 1 FROM sessions WHERE invitation=i.id AND method IN ('invitation','mail') AND expires>now())
         AS can_start FROM invitations i WHERE id=$1`, [record.id],
    );
    const { rows: [access] } = await db.query(
      `UPDATE invitations SET intern_access_expires_at=COALESCE(intern_access_expires_at,now()+interval '720 hours'),
         status=CASE WHEN $2 THEN 'draft' ELSE status END
       WHERE id=$1 RETURNING intern_access_expires_at AS expires`, [record.id, application.can_start],
    );
    const token = crypto.randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO sessions(digest,invitation,method,expires) VALUES($1,$2,$3,$4)",
      [hash(token),record.id,application.can_start ? "invitation" : "roster-status",access.expires],
    );
    return { token, expires: access.expires };
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
