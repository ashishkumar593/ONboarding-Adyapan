"use client";
import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Check,
  FileText,
  LockKeyhole,
  MailCheck,
  Upload,
  UserRound,
} from "lucide-react";
import { form, request, RequestError, fileUrl, sendFile } from "./client";
import IssuedOffer from "./IssuedOffer";
import SignatureField from "./SignatureField";
import { validDrawing } from "@shared/signature";
import {
  termsAcknowledgement,
  profileValues,
  profileComplete,
  isResume,
  statusDate,
  type Slot,
  type Invitation,
} from "@shared/model";

export default function Intern({ token }: { token: string }) {
  const [inv, setInv] = useState<Invitation | null>(null),
    [ready, setReady] = useState(false),
    [emailSent, setEmailSent] = useState(false),
    [returnAccess, setReturnAccess] = useState<{ canEmail: boolean } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""),
    [access, setAccess] = useState("");
  const [step, setStep] = useState(0),
    [progress, setProgress] = useState<Record<string, number>>({});
  async function load(resume = false) {
    const result: Invitation = await request(
      "application" + (token ? "?token=" + encodeURIComponent(token) : ""),
    );
    setInv(result);
    if (resume || result.correction) {
      const correction = result.requirements.find(
        (r) => r.id === result.correction?.slot,
      );
      if (correction) setStep(isResume(correction) ? 0 : 1);
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
    function navigate() {
      const key = new URLSearchParams(window.location.hash.slice(1)).get(
        "access",
      );
      setError("");
      setInv(null);
      if (key && /^[\w-]{43}$/.test(key) && token) {
        setAccess(key);
        setReady(true);
        return;
      }
      setAccess("");
      load(true)
        .catch(async (e) => {
          if (e instanceof RequestError && e.status === 401) {
            const hint = await request("remembered-email").catch(() => null);
            setEmail(hint?.email ?? "");
          } else setError(e.message);
        })
        .finally(() => setReady(true));
    }
    navigate();
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, [token]); // invitation scopes the session
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
  async function verifyEmail(recover = false) {
    setEmailSent(false);
    setReturnAccess(null);
    const result = await request("roster-login", form({ email, recover: recover ? "yes" : "no" }));
    if (result.useOriginalBrowser) { setReturnAccess(result); return; }
    if (result.emailSent) { setEmailSent(true); return; }
    await load(true);
  }
  async function openInvitation() {
    let invalidLink: RequestError | undefined;
    try {
      await request("redeem-link", form({ token, access }));
    } catch (e) {
      if (!(e instanceof RequestError) || e.status !== 401) throw e;
      invalidLink = e;
    }
    setAccess("");
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    try {
      await load(true);
    } catch (e) {
      if (invalidLink && e instanceof RequestError && e.status === 401)
        throw invalidLink;
      throw e;
    }
  }
  const done = inv && ["submitted", "issued"].includes(inv.status);
  const stages = ["Your details", "Documents", "Terms & signature"];
  const resume = inv?.requirements.find(isResume);
  const hasResume = inv?.files.some((f) => f.slot === resume?.id);
  const allFiles = inv?.requirements.every((r) =>
    inv.files.some((f) => f.slot === r.id),
  );
  const corrected =
    !inv?.correction ||
    inv.files.find((f) => f.slot === inv.correction!.slot)?.id !==
      inv.correction.previous;
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
        {doc && (
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
        {!inv ? "Intern login" : done ? "Confirmation" : "Your application"}
      </div>
      {!ready ? (
        <p role="status">Loading your application…</p>
      ) : !inv ? (
        <section className="panel verify">
          <div className="large-icon">
            <MailCheck />
          </div>
          <div className="eyebrow">Adyapan Onboarding Portal</div>
          <h1>{access ? "Resume onboarding" : "Intern login"}</h1>
          {access ? (
            <>
              <p>
                Continue to your internship application using the personal link
                from your email.
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() => run(openInvitation)}
              >
                {busy ? "Opening…" : "Open my application"}
              </button>
            </>
          ) : (
            <>
              {emailSent && <p className="notice" role="status">Check your invited inbox for a fresh personal link.</p>}
              <p>Enter the email HR added to the intern roster. Your access lasts 30 days from your first sign-in, including when you change browsers.</p>
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
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setEmailSent(false);
                      setReturnAccess(null);
                    }}
                  />
                </label>
                <button className="button" disabled={busy}>
                  {busy ? "Checking…" : "Continue"}
                </button>
              </form>
              {returnAccess && (
                <div className="notice" role="status">
                  <p>Your email is on the roster. This browser needs confirmation before it can open your saved documents.</p>
                  {returnAccess.canEmail ? (
                    <button type="button" className="secondary" disabled={busy} onClick={() => run(() => verifyEmail(true))}>
                      Email me a recovery link
                    </button>
                  ) : <p>Email confirmation is unavailable. You can use a browser you already signed in on during your 30-day access period.</p>}
                </div>
              )}
            </>

          )}
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
          <div className="summary-box">
            <strong>{inv.name}</strong>
            <span>{inv.role}</span>
            <span>
              {statusDate(inv.starts)} – {statusDate(inv.ends)}
            </span>
          </div>
          {inv.correction && (
            <div className="notice">
              <strong>
                Correction requested ·{" "}
                {
                  inv.requirements.find((r) => r.id === inv.correction?.slot)
                    ?.label
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
                  (i === 2 && (!allFiles || !corrected)) ||
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
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  data.set("invitation", inv.id);
                  void run(async () => {
                    if (!inv.correction) {
                      const draft = await request("draft", data);
                      setInv({ ...draft, rememberedBrowser: inv.rememberedBrowser });
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
                Upload a separate file for each requirement. You can replace a
                file before you submit.
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
                  {Object.entries(profileValues(inv)).map(([k, v]) => (
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
                      {f ? (
                        <a
                          href={fileUrl(f.id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {f.name}
                        </a>
                      ) : (
                        "Missing"
                      )}
                    </p>
                  );
                })}
              </details>
              <h3>Terms and conditions</h3>
              {inv.terms && <p className="onboarding-terms">{inv.terms}</p>}
              {inv.policies.map(policy => (
                <section key={policy.sha256} className="signing-policy">
                  <h4>{policy.title}</h4>
                  {policy.introduction && <p className="onboarding-terms">{policy.introduction}</p>}
                  <ol>{policy.clauses.map(clause => <li key={clause}>{clause}</li>)}</ol>
                  <a href={`/api/signing-policy?file=${encodeURIComponent(policy.file)}`}
                    target="_blank" rel="noreferrer"
                    aria-label={`Open original PDF for ${policy.title} (opens in a new tab)`}>
                    Open original PDF
                  </a>
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
                    await request("submit", data);
                    await load();
                  });
                }}
              >
                <label className="check">
                  <input required type="checkbox" name="agreed" value="yes" />
                  {termsAcknowledgement}
                </label>
                <SignatureField />
                <button className="button" disabled={busy}>
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
      {inv && (
        <div className="session">
          <span>
            <LockKeyhole size={14} />
            {inv.email}
          </span>
          <label className="check">
            <input type="checkbox" checked={!!inv.rememberedBrowser} disabled={busy}
              onChange={e => {
                const remember = e.target.checked;
                void run(async () => {
                  const result = await request("remember-browser", form({ invitation: inv.id, remember: remember ? "yes" : "no" }));
                  setInv(current => current && ({ ...current, rememberedBrowser: result.rememberedBrowser }));
                });
              }} />
            Remember this personal browser for 30 days
          </label>
          <button
            className="textbtn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await request("logout", form({}));
                setEmail(inv.rememberedBrowser ? inv.email : "");
                setInv(null);
                setAccess("");
                setStep(0);
                setEmailSent(false);
                setReturnAccess(null);
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
