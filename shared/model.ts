import requiredDocuments from "./intern-documents.json";
export const sharedOnboardingUrl = "https://onbording.adyapan.com";
export const termsAcknowledgement = "I have read and agree to the Confidentiality Agreement and the Liquidated Damages Addendum.";
export type SigningPolicy = {
  title: string;
  file: string;
  sha256: string;
  introduction: string;
  clauses: string[];
};
export type Slot = { id: string; label: string };
export function signedPolicySlot(policy: SigningPolicy): Slot {
  return { id: "policy-" + policy.sha256, label: "Signed copy of " + policy.title };
}
export type Doc = {
  pending?: boolean;
  id: string;
  slot: string;
  name: string;
  mime: string;
  bytes: number;
};
export type Draft = {
  name?: string;
  employeeId?: string;
  phone?: string;
  address?: string;
  college?: string;
  course?: string;
  year?: string;
};
export type Invitation = {
  rememberedBrowser?: boolean;
  id: string;
  revision: string;
  token: string;
  name: string;
  email: string;
  role: string;
  starts: string;
  ends: string;
  requirements: Slot[];
  draft: Draft;
  status: string;
  reference: string | null;
  correction: { slot: string; message: string; previous: string } | null;
  issued_file: string | null;
  access_revoked_at: string | null;
  invitation_email_sent_at: string | null;
  notified_at: string | null;
  files: Doc[];
  terms: string;
  policies: SigningPolicy[];
  version: string;
};
export const statuses: Record<string, string> = {
  queued: "Ready to start",
  invited: "Ready to start",
  draft: "In progress",
  submitted: "In review",
  correction: "Correction requested",
  issued: "Letter ready",
};
export const statusDate = (value: string) =>
  new Date(value.slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export const standardDocuments: Slot[] = requiredDocuments;
const normalizedLabel = (label: string) =>
  label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
export const isResume = (slot: Slot) =>
  slot.id === "resume" || normalizedLabel(slot.label) === "resume";
export function currentRequirements(previous: Slot[]) {
  // Keep earlier upload IDs when the same document was requested by name.
  return standardDocuments.map((slot) => ({
    ...slot,
    id:
      previous.find(
        (old) =>
          old.id === slot.id ||
          normalizedLabel(old.label) === normalizedLabel(slot.label),
      )?.id ?? slot.id,
  }));
}
export function profileComplete(inv: Invitation) {
  return Boolean(
    inv.draft.name &&
    inv.draft.employeeId &&
    inv.draft.phone &&
    inv.draft.college &&
    inv.requirements.some(
      (r) => isResume(r) && inv.files.some((f) => f.slot === r.id),
    ),
  );
}
export function profileValues(inv: Invitation) {
  return {
    Name: inv.draft.name || inv.name,
    "Employee ID": inv.draft.employeeId,
    "Email address": inv.email,
    "Phone number": inv.draft.phone,
    "College name": inv.draft.college,
  };
}

export type RosterRow = Pick<
  Invitation,
  | "id"
  | "name"
  | "email"
  | "role"
  | "starts"
  | "ends"
  | "status"
  | "invitation_email_sent_at"
  | "reference"
> & {
  received_at: string | null;
  employee_id: string | null;
};
export function rosterGroup(
  row: Pick<RosterRow, "reference" | "status" | "invitation_email_sent_at">,
) {
  if (
    row.reference ||
    ["submitted", "correction", "issued"].includes(row.status)
  )
    return "received";
  return "awaiting";
}
