import { screenDocument } from "./screen";
import { assigned, type StaffSession } from "./auth";
import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { details, event, Problem, requireThat, transaction } from "./db";
import { put, get, upload, contentDigest } from "./private";
import { sendAccessMail } from "./access-mail";
import { countersign, requireSignedOffer } from "./issue";
import {
  termsAcknowledgement,
  signedPolicySlot,
  standardDocuments,
  profileComplete,
  isResume,
  type Invitation,
} from "@shared/model";
import { validDrawing } from "@shared/signature";
import type { Stroke } from "@shared/signature";
import { signatureImage, signPolicyPdf } from "./signing-policies";
import { loadHrStamp } from "./hr-stamp";

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
  file: { data: Uint8Array; name: string; mime: string; pending?: boolean },
) {
  const id = crypto.randomUUID();
  await put(id, file.data, file.mime);
  await db.query(
    "INSERT INTO files(id,invitation,slot,name,mime,bytes,clean_digest) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, inv, slot, file.name, file.mime, file.data.length, file.pending ? null : contentDigest(file.data)],
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
  actor: string,
) {
  const { name, email, role, starts, ends } = values;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    email + "|" + starts,
  ]);
  if (
    (
      await db.query(
        "SELECT 1 FROM invitations WHERE email=$1 AND starts=$2 AND status <> 'removed' LIMIT 1",
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
  await db.query("INSERT INTO hr_assignments(staff,invitation) VALUES($1,$2)",[actor,id]);
  await event(db, id, "queued", { actor });
  return { id, token };
}
export async function createInvite(data: FormData, actor: string) {
  return transaction(async db => {
    const row = await queueInvite(db,invitationFields(data),actor);
    requireThat(row,"This intern and start date already exist.",409);
    return { id: row.id };
  });
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
      const usage = (await db.query("SELECT count(*)::int AS versions,coalesce(sum(bytes),0)::bigint AS bytes FROM files WHERE invitation=$1 AND slot NOT IN ('issued','original')",[id])).rows[0];
      requireThat(usage.versions < 48 && Number(usage.bytes) + file.data.length <= 128 * 1024 * 1024,
        "Upload limit reached. Contact HR to review your stored versions.", 413);
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
      for (const doc of docs) {
        if (doc?.pending) {
          try { await get(doc.id, db); }
          catch (error) {
            if (error instanceof Problem) throw new Problem(
              (inv.requirements.find(r => r.id === doc.slot)?.label || "Document") + " — " + error.message,
              error.status,
            );
            throw error;
          }
        }
      }
      requireThat(
        inv.reference || profileComplete(inv),
        "Complete your personal details and upload your résumé.",
      );
      requireThat(
        !inv.correction || inv.policies.some(p => signedPolicySlot(p).id === inv.correction?.slot) ||
          inv.files.find((f) => f.slot === inv.correction!.slot)?.id !==
            inv.correction.previous,
        "Replace the requested file before resubmitting.",
      );
      const mode = field(data, "signatureMode", 6);
      requireThat(mode === "draw" || mode === "type", "Choose how to sign.");
      let drawing: Stroke[] | null = null;
      if (mode === "draw") {
        let input: unknown;
        try {
          input = JSON.parse(field(data, "drawing", 120000));
        } catch {
          input = null;
        }
        requireThat(
          validDrawing(input),
          "Draw your signature or choose Type signature.",
        );
        drawing = input;
      }
      const signature =
        mode === "type" ? field(data, "signature") : inv.draft.name || inv.name;
      requireThat(
        (mode !== "type" || signature.length >= 2) &&
          data.get("agreed") === "yes" &&
          inv.policies.length > 0 &&
          inv.version &&
          data.get("version") === inv.version,
        "Read the current terms, agree, and sign your name.",
      );
      const reference =
        inv.reference ||
        "ADY-" + crypto.randomBytes(6).toString("hex").toUpperCase();
      const image = await signatureImage(signature, drawing);
      const stamp = await loadHrStamp();
      const signedPolicies = [];
      for (const policy of inv.policies) {
        const bytes = await signPolicyPdf(policy, image, stamp);
        const fileId = await storeFile(db, id, signedPolicySlot(policy).id, {
          name: "signed-" + policy.file, mime: "application/pdf", data: bytes,
        });
        signedPolicies.push({ title: policy.title, sha256: policy.sha256, fileId });
      }
      const snapshot = {
        name: inv.draft.name || inv.name,
        email: inv.email,
        draft: inv.draft,
        files: [...docs.map((f) => f!.id), ...signedPolicies.map(p => p.fileId)],
        terms: [
          inv.terms,
          ...inv.policies.map(policy => [
            policy.title, policy.introduction,
            ...policy.clauses.map((clause, index) => `${index + 1}. ${clause}`),
          ].filter(Boolean).join("\n\n")),
        ].filter(Boolean).join("\n\n"),
        policies: inv.policies.map(({ title, file, sha256 }) => ({ title, file, sha256 })),
        signedPolicies,
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
export async function review(id: string, action: string, data: FormData, staff: StaffSession) {
  const inv = await transaction(async (db) => {
    const inv = await details(db, id, true);
    await assigned(staff,id,db);
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
        doc && (inv.requirements.some((r) => r.id === slot) || inv.policies.some(p => signedPolicySlot(p).id === slot)),
        "Select a submitted document.",
      );
      const correction = { slot, message, previous: doc.id };
      await db.query(
        "UPDATE invitations SET status='correction',correction=$1 WHERE id=$2",
        [correction, id],
      );
      await event(db, id, "correction", {
        ...correction,
        actor: staff.staff,
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
      const bytes = await countersign(await get(signed.id,db), inv);
      await screenDocument(Buffer.from(bytes));
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
        actor: staff.staff,
      });
    } else
      requireThat(
        action === "notify" && ["issued", "correction"].includes(inv.status),
        "There is no notification to send.",
        409,
      );
    return details(db, id);
  });
  if (inv.status === "issued" && inv.notified_at) return { ok: true };
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
      warning:
        "The review was saved. Email delivery failed. Use Send notification to retry.",
    };
  }
  return { ok: true };
}
