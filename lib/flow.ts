import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { details, event, requireThat, transaction } from "./db";
import { put, get, upload } from "./private";
import { emailInvitation, sendAccessMail } from "./access-mail";
import { countersign, requireSignedOffer } from "./issue";
import {
  termsAcknowledgement,
  standardDocuments,
  profileComplete,
  isResume,
  type Invitation,
} from "./model";
import { validDrawing } from "./signature";

export function field(data: FormData, key: string, max = 160) {
  const value = data.get(key);
  requireThat(
    typeof value === "string" && value.trim() && value.trim().length <= max,
    "Enter a valid " + key + ".",
  );
  return value.trim();
}
export const emailAddress = (data: FormData) => {
  const email = field(data, "email", 254).toLowerCase();
  requireThat(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    "Enter a valid email address.",
  );
  return email;
};
export async function storeFile(
  db: PoolClient,
  inv: string,
  slot: string,
  file: { data: Uint8Array; name: string; mime: string },
) {
  const id = crypto.randomUUID();
  await put(id, file.data, file.mime);
  await db.query(
    "INSERT INTO files(id,invitation,slot,name,mime,bytes) VALUES($1,$2,$3,$4,$5,$6)",
    [id, inv, slot, file.name, file.mime, file.data.length],
  );
  return id;
}
export function invitationFields(data: FormData) {
  const name = field(data, "name"),
    email = emailAddress(data),
    role = field(data, "role"),
    starts = field(data, "starts", 10),
    ends = field(data, "ends", 10);
  requireThat(
    [starts, ends].every(
      (s) =>
        /^\d{4}-\d{2}-\d{2}$/.test(s) &&
        Number.isFinite(Date.parse(s)) &&
        new Date(s).toISOString().startsWith(s),
    ) && ends >= starts,
    "Check the internship dates.",
  );
  return { name, email, role, starts, ends };
}
export async function queueInvite(
  db: PoolClient,
  values: ReturnType<typeof invitationFields>,
) {
  const { name, email, role, starts, ends } = values;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    email + "|" + starts,
  ]);
  if (
    (
      await db.query(
        "SELECT 1 FROM invitations WHERE email=$1 AND starts=$2 LIMIT 1",
        [email, starts],
      )
    ).rowCount
  )
    return null;
  const id = crypto.randomUUID(),
    token = crypto.randomBytes(24).toString("base64url");
  await db.query(
    "INSERT INTO invitations(id,token,name,email,role,starts,ends,requirements,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued')",
    [
      id,
      token,
      name,
      email,
      role,
      starts,
      ends,
      JSON.stringify(standardDocuments),
    ],
  );
  await event(db, id, "queued", { actor: process.env.HR_EMAIL });
  return { id, token };
}
export async function createInvite(data: FormData) {
  const values = invitationFields(data),
    queued = data.get("delivery") === "queue";
  const { id, token } = await transaction(async (db) => {
    const created = await queueInvite(db, values);
    requireThat(
      created,
      "This email and start date already exist in the workspace.",
      409,
    );
    return created;
  });
  if (queued) return { id, token, queued: true };
  try {
    await emailInvitation(id, true);
    return { id, token };
  } catch {
    return {
      id,
      token,
      warning:
        "Invitation saved. Email delivery failed. Use Send invitation email to retry.",
    };
  }
}
const editable = (inv: Invitation) =>
  requireThat(
    ["invited", "draft"].includes(inv.status),
    "This application has already been submitted.",
    409,
  );
export async function internAction(id: string, action: string, data: FormData) {
  return transaction(async (db) => {
    const inv = await details(db, id, true);
    if (action === "draft") {
      editable(inv);
      requireThat(
        data.get("email") === inv.email,
        "Use the email address on your invitation.",
      );
      const update = {
        name: field(data, "name"),
        employeeId: field(data, "employeeId", 80),
        college: field(data, "college"),
        phone: field(data, "phone", 30),
      };
      requireThat(
        /^[+\d()\s.-]{7,30}$/.test(update.phone) &&
          update.phone.replace(/\D/g, "").length >= 7,
        "Enter a valid phone number.",
      );
      await db.query(
        "UPDATE invitations SET draft=draft||$1::jsonb,status='draft' WHERE id=$2",
        [JSON.stringify(update), id],
      );
    } else if (action === "upload") {
      const slot = field(data, "slot");
      const requirement = inv.requirements.find((r) => r.id === slot);
      requireThat(requirement, "Unknown document slot.");
      if (inv.status === "correction")
        requireThat(
          inv.correction?.slot === slot,
          "Only the requested file can be replaced.",
          409,
        );
      else editable(inv);
      const file = await upload(data.get("file"), slot === "signed" || isResume(requirement));
      if (slot === "signed") requireSignedOffer(file.data);
      await storeFile(db, id, slot, file);
    } else if (action === "submit") {
      if (["submitted", "issued"].includes(inv.status))
        return { reference: inv.reference };
      requireThat(
        data.get("revision") === inv.revision,
        "Your application changed. Reload and review the latest version.",
        409,
      );
      const docs = inv.requirements.map((r) =>
        inv.files.find((f) => f.slot === r.id),
      );
      requireThat(docs.every(Boolean), "Upload each required document.");
      requireThat(
        inv.reference || profileComplete(inv),
        "Complete your personal details and upload your résumé.",
      );
      requireThat(
        !inv.correction ||
          inv.files.find((f) => f.slot === inv.correction!.slot)?.id !==
            inv.correction.previous,
        "Replace the requested file before resubmitting.",
      );
      const mode = field(data, "signatureMode", 4);
      requireThat(mode === "draw" || mode === "type", "Choose how to sign.");
      let drawing: unknown = null;
      if (mode === "draw") {
        try {
          drawing = JSON.parse(field(data, "drawing", 120000));
        } catch {
          drawing = null;
        }
        requireThat(
          validDrawing(drawing),
          "Draw your signature or choose Type signature.",
        );
      }
      const signature =
        mode === "type" ? field(data, "signature") : inv.draft.name || inv.name;
      requireThat(
        (mode === "draw" || signature.length >= 2) &&
          data.get("agreed") === "yes" &&
          inv.terms &&
          inv.version &&
          data.get("version") === inv.version,
        "Read the current terms, agree, and sign your name.",
      );
      const reference =
        inv.reference ||
        "ADY-" + crypto.randomBytes(6).toString("hex").toUpperCase();
      const snapshot = {
        name: inv.draft.name || inv.name,
        email: inv.email,
        draft: inv.draft,
        files: docs.map((f) => f!.id),
        terms: inv.terms,
        version: inv.version,
        signature,
        agreed: true,
        acknowledgement: termsAcknowledgement,
        signatureMode: mode,
        drawing,
        reference,
        acceptedAt: new Date().toISOString(),
      };
      await db.query(
        "INSERT INTO submissions(id,invitation,snapshot) VALUES($1,$2,$3)",
        [crypto.randomUUID(), id, snapshot],
      );
      await db.query(
        "UPDATE invitations SET reference=$1,status='submitted',correction=NULL,requirements=$3 WHERE id=$2",
        [reference, id, JSON.stringify(inv.requirements)],
      );
      await event(db, id, "submitted", { reference });
    } else requireThat(false, "Unknown action.", 404);
    return details(db, id);
  });
}
export async function review(id: string, action: string, data: FormData) {
  const inv = await transaction(async (db) => {
    const inv = await details(db, id, true);
    if (action === "correct" || (action === "issue" && inv.status !== "issued"))
      requireThat(
        data.get("revision") === inv.revision,
        "This submission changed. Reopen the latest version before review.",
        409,
      );
    if (action === "correct") {
      requireThat(
        inv.status === "submitted",
        "This application is no longer awaiting review.",
        409,
      );
      const slot = field(data, "slot"),
        message = field(data, "message", 800),
        doc = inv.files.find((f) => f.slot === slot);
      requireThat(
        doc && inv.requirements.some((r) => r.id === slot),
        "Select a submitted document.",
      );
      const correction = { slot, message, previous: doc.id };
      await db.query(
        "UPDATE invitations SET status='correction',correction=$1 WHERE id=$2",
        [correction, id],
      );
      await event(db, id, "correction", {
        ...correction,
        actor: process.env.HR_EMAIL,
      });
    } else if (action === "issue") {
      if (inv.status === "issued") return inv;
      requireThat(
        inv.status === "submitted" && data.get("approved") === "yes",
        "Confirm that you reviewed and approved the uploaded offer.",
        409,
      );
      const signed = inv.files.find((f) => f.slot === "signed");
      requireThat(
        signed && data.get("reviewed") === signed.id,
        "Reopen the latest signed offer before issuing.",
        409,
      );
      const bytes = await countersign(await get(signed.id), inv);
      const issued = await storeFile(db, id, "issued", {
        data: bytes,
        mime: "application/pdf",
        name: inv.reference + "-signed-offer.pdf",
      });
      await db.query(
        "UPDATE invitations SET status='issued',issued_file=$1 WHERE id=$2",
        [issued, id],
      );
      await event(db, id, "issued", {
        source: signed.id,
        issued,
        actor: process.env.HR_EMAIL,
      });
    } else
      requireThat(
        action === "notify" && ["issued", "correction"].includes(inv.status),
        "There is no notification to send.",
        409,
      );
    return details(db, id);
  });
  if (inv.status === "issued" && inv.notified_at) return inv;
  try {
    await transaction(async (db) => {
      const current = await details(db, id, true);
      if (
        current.status !== inv.status ||
        (current.status === "issued" && current.notified_at)
      )
        return;
      const issued = current.status === "issued";
      await sendAccessMail(
        db,
        current,
        issued ? "issued" : "correction",
        current.requirements.find((r) => r.id === current.correction?.slot)
          ?.label,
      );
      if (issued)
        await db.query("UPDATE invitations SET notified_at=now() WHERE id=$1", [
          id,
        ]);
      await event(db, id, "notification sent", { type: current.status });
    });
  } catch {
    return {
      ...inv,
      warning:
        "The review was saved. Email delivery failed. Use Send notification to retry.",
    };
  }
  return inv;
}
