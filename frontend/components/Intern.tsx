"use client";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Check,
  FileText,
  LockKeyhole,
  MailCheck,
  Upload,
  UserRound,
} from "lucide-react";
import { decodeFile, form, request, RequestError, fileUrl, sendFile } from "./client";
import IssuedOffer from "./IssuedOffer";
import SignatureField from "./SignatureField";
import { validDrawing } from "@shared/signature";
import {
  termsAcknowledgement,
  signedPolicySlot,
  profileValues,
  profileComplete,
  isResume,
  statusDate,
  statuses,
  type Slot,
  type InternView, type ProfileField, profileFields,
} from "@shared/model";

type RosterStatus = { statusOnly: true; email: string; status: string; issued_file?: string | null };

export default function Intern({ token }: { token: string }) {
  const [inv, setInv] = useState<InternView | null>(null),
    [ready, setReady] = useState(false),
    [summary, setSummary] = useState<RosterStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState(0),
    [progress, setProgress] = useState<Record<string, number>>({});
  const invitationId = inv?.id;
  const autosave = useMemo(() => {
    let pending: Record<string, string> = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let saving: Promise<void> | undefined;
    function flush() {
      clearTimeout(timer);
      if (saving) return saving;
      if (!invitationId || !Object.keys(pending).length) return Promise.resolve();
      saving = (async () => {
        while (Object.keys(pending).length) {
          const values = pending;
          pending = {};
          try {
            await request("save-progress", form({ invitation: invitationId, ...values }));
          } catch (e) {
            pending = { ...values, ...pending };
            throw e;
          }
        }
      })().finally(() => { saving = undefined; });
      return saving;
    }
    return {
      flush,
      change(key: string, value: string) {
        pending[key] = value;
        clearTimeout(timer);
        timer = setTimeout(() => flush().catch(e => setError(e.message)), 400);
      },
      leave() {
        clearTimeout(timer);
        if (invitationId && Object.keys(pending).length)
          void fetch("/api/save-progress", { method: "POST", keepalive: true, body: form({ invitation: invitationId, ...pending }) }).catch(() => { });
      },
    };
  }, [invitationId]);
  useEffect(() => {
    window.addEventListener("pagehide", autosave.leave);
    return () => window.removeEventListener("pagehide", autosave.leave);
  }, [autosave]);
  async function load(resume = false) {
    const result: InternView | RosterStatus = await request(
      "application" + (token ? "?token=" + encodeURIComponent(token) : ""),
    );
    if ("statusOnly" in result) {
      setSummary(result);
      setInv(null);
      return;
    }
    setSummary(null);
    setInv(result);
    if (resume || result.correction) {
      const correction = result.requirements.find(
        (r) => r.id === result.correction?.slot,
      );
      if (result.policies.some(p => signedPolicySlot(p).id === result.correction?.slot)) setStep(2);
      else if (correction) setStep(isResume(correction) ? 0 : 1);
      else if (!profileComplete(result)) setStep(0);
      else
        setStep(
          result.requirements.every((r) =>
            result.files.some((f) => f.slot === r.id),
          )
            ? 2
            : 1,
        );
    }
  }
  useEffect(() => {
    setInv(null);
    setSummary(null);
    load(true).catch(e => {
      if (!(e instanceof RequestError && e.status === 401)) setError(e.message);
    }).finally(() => setReady(true));
  }, [token]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verifyEmail() {
    await request("roster-login", form({ email }));
    await load(true);
  }
  async function downloadPolicy(file: string) {
    const { content } = await request("signing-policy?format=json&file=" + encodeURIComponent(file));
    const url = URL.createObjectURL(new Blob([decodeFile(content)], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  const done = inv && ["submitted", "issued"].includes(inv.status);
  const stages = ["Your details", "Documents", "Terms & signature"];
  const resume = inv?.requirements.find(isResume);
  const policySlots = inv?.policies.map(signedPolicySlot) ?? [];
  const policyCorrection = policySlots.find(slot => slot.id === inv?.correction?.slot);
  const hasResume = inv?.files.some((f) => f.slot === resume?.id);
  const allFiles = inv?.requirements.every((r) =>
    inv.files.some((f) => f.slot === r.id),
  );
  const corrected =
    !inv?.correction || !!policyCorrection ||
    inv.files.find((f) => f.slot === inv.correction!.slot)?.id !==
    inv.correction.previous;
  const reviewProfile = inv ? { ...inv.draft } : {};
  for (const key of inv?.savedFields ?? []) reviewProfile[key] = "Saved";
  function savedField(key: ProfileField) {
    return inv?.savedFields?.includes(key) ?? false;
  }
  function renderUpload(slot: Slot) {
    if (!inv) return null;
    const doc = inv.files.find((f) => f.slot === slot.id),
      locked = !!inv.correction && inv.correction.slot !== slot.id;
    const pdfOnly = slot.id === "signed" || isResume(slot);
    return (
      <div
        className={
          "upload-slot " + (inv.correction?.slot === slot.id ? "requested" : "")
        }
        key={slot.id}
      >
        <div className="row between">
          <h3>{slot.label}</h3>
          {doc && !doc.pending && <BadgeCheck size={19} />}
        </div>
        {slot.label === "Degree or last-semester marksheet" && (
          <p>
            Upload your degree marksheet, or your latest semester marksheet if
            the degree marksheet is unavailable.
          </p>
        )}
        <small>{pdfOnly ? "PDF" : "PDF, PNG or JPEG"} · Up to 8 MB</small>
        {doc?.pending && <p role="status">File saved privately. You can continue filling out your application. Screening must finish before you can open the file or submit.</p>}
        {doc?.id && (
          <a
            className="filelink"
            href={fileUrl(doc.id)}
            target="_blank"
            rel="noreferrer"
          >
            <FileText size={15} />
            {doc.name}
          </a>
        )}
        {!locked && (
          <label className="upload-label">
            <Upload size={15} />
            {doc ? "Replace file" : "Choose file"}
            <input
              type="file"
              aria-label={"Upload " + slot.label}
              disabled={busy}
              accept={
                pdfOnly
                  ? "application/pdf"
                  : "application/pdf,image/png,image/jpeg"
              }
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run(async () => {
                  if (file.size > 8 * 1024 * 1024)
                    throw Error("Choose a file up to 8 MB.");
                  const data = form({
                    slot: slot.id,
                    invitation: inv.id,
                  });
                  data.set("file", file);
                  try {
                    await sendFile(data, (n) => setProgress({ [slot.id]: n }));
                    await load();
                  } finally {
                    setProgress({});
                  }
                });
              }}
            />
          </label>
        )}
        {progress[slot.id] !== undefined && (
          <progress
            aria-label="Upload progress"
            value={progress[slot.id]}
            max={100}
          />
        )}
      </div>
    );
  }
  return (
    <main className="narrow">
      <div className="crumb">
        <a href="/">Onboarding Portal</a>
        <i>/</i>
        {summary ? "Application status" : !inv ? "Intern login" : done ? "Confirmation" : "Your application"}
      </div>
      {!ready ? (
        <p role="status">Loading your application…</p>
      ) : summary ? (
        <section className="panel">
          <h1>Application status</h1>
          <p role="status">{statuses[summary.status]}</p>
          {summary.status === "issued" && summary.issued_file ? (
            <IssuedOffer key={summary.issued_file} id={summary.issued_file} />
          ) : (
            <p>{summary.status === "issued" ? "Contact HR for a copy of your stamped offer letter." : "Contact HR for help with your saved details and documents."}</p>
          )}
          <button className="secondary" disabled={busy} onClick={() => run(() => load())}>Refresh status</button>
        </section>
      ) : !inv ? (
        <section className="panel verify">
          <div className="large-icon">
            <MailCheck />
          </div>
          <div className="eyebrow">Adyapan Onboarding Portal</div>
          <h1>Intern login</h1>
          <p>Enter the email HR added to the roster. You can sign in from any browser for 30 days from your first sign-in.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(verifyEmail);
            }}
          >
            <label>
              Registered email address
              <input
                required
                autoComplete="email"
                type="email"
                name="email"
                disabled={busy}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </label>
            <button className="button" disabled={busy}>
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        </section>
      ) : done ? (
        <section className="panel receipt">
          <div className="checkseal">
            <Check />
          </div>
          <div className="eyebrow">Submission received</div>
          <h1>
            Welcome to Adyapan, {(inv.draft.name || inv.name).split(" ")[0]}.
          </h1>
          <p>We’ve received your documents.</p>
          <div className="notice">
            <strong>
              {inv.status === "issued"
                ? "Your offer letter is ready"
                : "Your application is with HR"}
            </strong>
            <p>
              {inv.status === "issued"
                ? "Download your reviewed, countersigned offer letter below."
                : "People Operations will review your documents. We’ll email you when your final offer is ready or if a file needs a correction."}
            </p>
            <small>Reference · {inv.reference}</small>
          </div>
          {inv.issued_file ? (
            <IssuedOffer key={inv.issued_file} id={inv.issued_file} />
          ) : (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => run(() => load())}
            >
              Refresh status
            </button>
          )}
        </section>
      ) : (
        <>
          <div className="eyebrow">
            <UserRound size={15} /> Roster match
          </div>
          <h1>Your application</h1>
          {!inv.savedFields && <div className="summary-box">
            <strong>{inv.name}</strong>
            <span>{inv.role}</span>
            <span>
              {statusDate(inv.starts)} – {statusDate(inv.ends)}
            </span>
          </div>}
          {inv.correction && (
            <div className="notice">
              <strong>
                Correction requested ·{" "}
                {
                  policyCorrection?.label ?? inv.requirements.find((r) => r.id === inv.correction?.slot)?.label
                }
              </strong>
              <p>{inv.correction.message}</p>
            </div>
          )}
          <nav className="stepnav" aria-label="Application steps">
            {stages.map((label, i) => (
              <button
                key={label}
                disabled={
                  busy ||
                  (i === 0 &&
                    !!inv.correction &&
                    inv.correction.slot !== resume?.id) ||
                  (i === 1 &&
                    !!inv.correction &&
                    inv.correction.slot === resume?.id) ||
                  (i > 0 && !inv.reference && !profileComplete(inv)) ||
                  (i === 2 && (!allFiles || (!corrected && !policyCorrection))) ||
                  (step === 0 && i > 0 && !inv.correction)
                }
                aria-current={step === i ? "step" : undefined}
                onClick={() => {
                  setStep(i);
                  setError("");
                }}
              >
                {i + 1}. {label}
              </button>
            ))}
          </nav>
          {step === 0 ? (
            <section className="panel">
              <h2>Personal details</h2>
              <form
                onChange={e => {
                  const input = e.target;
                  if (input instanceof HTMLInputElement && !inv.correction && !input.disabled &&
                    profileFields.includes(input.name as ProfileField)) autosave.change(input.name, input.value);
                }}
                onBlur={() => { void autosave.flush().catch(e => setError(e.message)); }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  data.set("invitation", inv.id);
                  void run(async () => {
                    if (!inv.correction) {
                      await autosave.flush();
                      const draft = await request("draft", data);
                      setInv(draft);
                    }
                    setStep(inv.correction ? 2 : 1);
                  });
                }}
              >
                <div className="twocol">
                  <label>
                    Full name
                    <input
                      name="name"
                      disabled={savedField("name")} placeholder={savedField("name") ? "Saved" : undefined}
                      autoComplete="name"
                      required
                      maxLength={160}
                      defaultValue={inv.draft.name || inv.name}
                      readOnly={!!inv.correction}
                    />
                  </label>
                  <label>
                    Employee ID
                    <input
                      name="employeeId"
                      disabled={savedField("employeeId")} placeholder={savedField("employeeId") ? "Saved" : undefined}
                      required={!inv.correction}
                      maxLength={80}
                      defaultValue={inv.draft.employeeId}
                      readOnly={!!inv.correction}
                    />
                  </label>
                </div>
                <label>
                  Email address
                  <input type="email" name="email" value={inv.email} readOnly />
                  <small>Registered by HR.</small>
                </label>
                <div className="twocol">
                  <label>
                    Phone number
                    <input
                      name="phone"
                      disabled={savedField("phone")} placeholder={savedField("phone") ? "Saved" : undefined}
                      type="tel"
                      autoComplete="tel"
                      required
                      maxLength={30}
                      defaultValue={inv.draft.phone}
                      readOnly={!!inv.correction}
                    />
                  </label>
                  <label>
                    College name
                    <input
                      name="college"
                      disabled={savedField("college")} placeholder={savedField("college") ? "Saved" : undefined}
                      required
                      maxLength={160}
                      defaultValue={inv.draft.college}
                      readOnly={!!inv.correction}
                    />
                  </label>
                </div>
                {resume && renderUpload(resume)}
                <button
                  className="button"
                  disabled={busy || !hasResume || !corrected}
                >
                  {inv.correction ? "Continue to terms" : "Save and continue"}
                </button>
              </form>
            </section>
          ) : step === 1 ? (
            <section className="panel">
              <h2>Your documents</h2>
              <p>
                {inv.savedFields ? "Upload the remaining documents. Previously uploaded files are on file." : "Upload a separate file for each requirement. You can replace a file before you submit."}
              </p>
              {inv.requirements.filter((r) => !isResume(r)).map(renderUpload)}
              <button
                className="button"
                disabled={busy || !allFiles || !corrected}
                onClick={() => setStep(2)}
              >
                Continue to terms
              </button>
            </section>
          ) : (
            <section className="panel">
              <h2>Terms and signature</h2>
              <details className="application-review">
                <summary>Review your details and uploads</summary>
                <dl className="review-list">
                  {Object.entries(profileValues({ ...inv, draft: reviewProfile })).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                {inv.requirements.map((r) => {
                  const f = inv.files.find((f) => f.slot === r.id);
                  return (
                    <p key={r.id}>
                      {r.label} ·{" "}
                      {f?.id ? (
                        <a
                          href={fileUrl(f.id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {f.name}
                        </a>
                      ) : (
                        f ? "On file" : "Missing"
                      )}
                    </p>
                  );
                })}
              </details>
              <h3>Terms and conditions</h3>
              <p>Review both agreements, then sign once below. When you submit, your signature is added to both PDFs for HR to review.</p>
              {inv.terms && <p className="onboarding-terms">{inv.terms}</p>}
              {inv.policies.map(policy => (
                <section key={policy.sha256} className="signing-policy">
                  <h4>{policy.title}</h4>
                  {policy.introduction && <p className="onboarding-terms">{policy.introduction}</p>}
                  <ol>{policy.clauses.map(clause => <li key={clause}>{clause}</li>)}</ol>
                  <div className="row">
                    <a href={`/api/signing-policy?file=${encodeURIComponent(policy.file)}`}
                      target="_blank" rel="noreferrer"
                      aria-label={`Open original PDF for ${policy.title} (opens in a new tab)`}>
                      Open original PDF
                    </a>
                  </div>
                </section>
              ))}
              <small>Terms version {inv.version}</small>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  data.set("invitation", inv.id);
                  data.set("revision", inv.revision);
                  data.set("version", inv.version);
                  void run(async () => {
                    if (
                      data.get("signatureMode") === "draw" &&
                      !validDrawing(
                        JSON.parse(String(data.get("drawing") || "null")),
                      )
                    )
                      throw new Error(
                        "Draw your signature or choose Type signature.",
                      );
                    if (inv.confirmSignedOffer) {
                      const file = data.get("confirmOffer");
                      if (!(file instanceof File) || file.size > 8 * 1024 * 1024) throw Error("Choose your original signed offer PDF (up to 8 MB).");
                      const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
                      data.delete("confirmOffer");
                      data.set("signedOfferDigest", Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join(""));
                    }
                    await request("submit", data);
                    await load();
                  });
                }}
              >
                <label className="check">
                  <input required type="checkbox" name="agreed" value="yes" />
                  {termsAcknowledgement}
                </label>
                {inv.confirmSignedOffer && <label>Confirm your previously uploaded signed offer
                  <input required type="file" name="confirmOffer" accept="application/pdf" />
                  <small>Select the same PDF to sign this saved application. Only its fingerprint is sent.</small>
                </label>}
                <SignatureField />
                <button className="button" disabled={busy || !corrected}>
                  {busy ? "Submitting…" : "Sign and submit"}
                </button>
              </form>
            </section>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(inv || summary) && (
        <div className="session">
          <span>
            <LockKeyhole size={14} />
            {inv?.email ?? summary?.email}
          </span>
          <button
            className="textbtn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await autosave.flush();
                await request("logout", form({}));
                setEmail("");
                setSummary(null);
                setInv(null);
                setStep(0);
              })
            }
          >
            Sign out
          </button>
        </div>
      )}
    </main>
  );
}
