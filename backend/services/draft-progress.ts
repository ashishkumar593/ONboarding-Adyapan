import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { profileFields, validProfileValue, type Draft, type Invitation, type InternView, type ProfileField } from "@shared/model";

export type ResumeSession = { digest: string; progress: Draft & {signed?:string} };
export async function unfinished(db: Pick<PoolClient,"query">, inv: Invitation) {
  if (inv.reference || !["queued","invited","draft"].includes(inv.status)) return false;
  const submitted = await db.query("SELECT 1 FROM submissions WHERE invitation=$1 LIMIT 1",[inv.id]);
  return submitted.rowCount === 0;
}
export const resumeRevision = (inv: Invitation, session: ResumeSession) =>
  createHmac("sha256",session.digest).update(inv.revision).digest("hex");
export const fieldDigest = (session: ResumeSession, key: string, value: string) =>
  createHmac("sha256",session.digest).update(key + "\0" + value).digest("hex");
export const privateField = (inv: Invitation, session: ResumeSession, key: ProfileField) =>
  validProfileValue(key, inv.draft[key]) && session.progress[key] !== fieldDigest(session,key,inv.draft[key]!);

export function resumeView(inv: Invitation, session: ResumeSession): InternView {
  return {
    id: inv.id,
    email: inv.email,
    status: inv.status,
    requirements: inv.requirements,
    terms: inv.terms,
    policies: inv.policies,
    version: inv.version,
    revision: resumeRevision(inv, session),
    draft: inv.draft,
    files: inv.files.filter((f) => inv.requirements.some((r) => r.id === f.slot)),
    confirmSignedOffer: false,
    name: inv.name,
    role: inv.role,
    starts: inv.starts,
    ends: inv.ends,
    reference: null,
    correction: null,
    issued_file: null,
  };
}
