"use client";
import { useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  Copy,
  FileText,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { request, fileUrl, form } from "./client";
import {
  standardDocuments,
  rosterGroup,
  type RosterRow,
  profileValues,
  statuses,
  statusDate,
  type Invitation,
} from "@/lib/model";
import HrRoster, { type RosterView } from "./HrRoster";
import IssuedOffer from "./IssuedOffer";
const initialView: RosterView = { group: "pending", search: "", page: 1, size: 10 };
export default function Workspace() {
  const [rows, setRows] = useState<RosterRow[] | null>(null),
    [inv, setInv] = useState<Invitation | null>(null),
    [create, setCreate] = useState(false),
    [origin, setOrigin] = useState("");
  const [working, setWorking] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState(initialView),
    [queueOnly, setQueueOnly] = useState(false);
  async function list() {
    const records: RosterRow[] = await request("list");
    setRows(records);
    setOrigin((await request("origin")).origin);
    return records;
  }
  async function open(id: string) {
    setInv(await request("record?id=" + id));
    setCreate(false);
  }
  useEffect(() => {
    list()
      .catch((e) => {
        if (!e.message.includes("Sign in")) setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  async function run(job: () => Promise<void>) {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await job();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function update(action: string, data: FormData) {
    data.set("revision", inv!.revision);
    data.set("id", inv!.id);
    const result = await request(action, data);
    await open(inv!.id);
    await list();
    setNotice(
      result.warning ||
        (action === "correct"
          ? "Correction requested."
          : action === "issue"
            ? "The signed offer is ready."
            : "Notification sent."),
    );
  }
  const url = inv ? origin + "/i/" + inv.token : "";
  const signedOffer = inv?.files.find(f => f.slot === "signed");
  const received = inv && rosterGroup(inv) === "received";
  return (
    <main className={rows ? "shell hr-main" : "narrow"}>
      <div className="crumb">
        <a href="/">Onboarding Portal</a>
        <i>/</i>HR workspace
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {loading ? (
        <p>Loading workspace…</p>
      ) : rows === null ? (
        <section className="panel verify">
          <div className="large-icon">
            <ShieldCheck />
          </div>
          <div className="eyebrow">People Operations</div>
          <h1>HR sign in</h1>
          <p>
            Sign in with your work email and password to manage internship
            invitations.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void run(async () => {
                await request("hr-login", data);
                await list();
              });
            }}
          >
            <label>
              Work email
              <input
                required
                type="email"
                name="email"
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                name="password"
                autoComplete="current-password"
              />
            </label>
            <button className="button" disabled={working}>
              Sign in
            </button>
          </form>
        </section>
      ) : (
        <>
          <div className="row between">
            <div>
              <div className="eyebrow">
                <BriefcaseBusiness size={15} />
                People Operations
              </div>
              <h1>HR workspace</h1>
            </div>
            <button
              className="secondary"
              disabled={working}
              onClick={() =>
                run(async () => {
                  await request("logout", form({ hr: "1" }));
                  setRows(null);
                  setView(initialView);
                  setInv(null);
                  setCreate(false);
                })
              }
            >
              Sign out
            </button>
          </div>
          {create ? (
            <section className="panel hr-form">
              <button className="textbtn" onClick={() => setCreate(false)}>
                Back to invitations
              </button>
              <h2>Create invitation</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  if (queueOnly) data.set("delivery", "queue");
                  void run(async () => {
                    const result = await request("invite", data);
                    await list();
                    if (result.queued) {
                      setCreate(false);
                      setView({ ...view, group: "pending", search: "", page: 1 });
                      setNotice("Intern added to the invitation queue.");
                      return;
                    }
                    await open(result.id);
                    setNotice(
                      result.warning ||
                        "Invitation email sent to " + data.get("email") + ".",
                    );
                  });
                }}
              >
                <div className="twocol">
                  <label>
                    Intern name
                    <input name="name" required />
                  </label>
                  <label>
                    Invited email
                    <input name="email" type="email" required />
                  </label>
                </div>
                <label>
                  Internship role
                  <input name="role" required />
                </label>
                <div className="twocol">
                  <label>
                    Start date
                    <input type="date" name="starts" required />
                  </label>
                  <label>
                    End date
                    <input type="date" name="ends" required />
                  </label>
                </div>
                <fieldset className="delivery-choice">
                  <legend>Invitation delivery</legend>
                  <label className="check">
                    <input
                      type="radio"
                      name="deliveryChoice"
                      checked={!queueOnly}
                      onChange={() => setQueueOnly(false)}
                    />
                    Send now
                  </label>
                  <label className="check">
                    <input
                      type="radio"
                      name="deliveryChoice"
                      checked={queueOnly}
                      onChange={() => setQueueOnly(true)}
                    />
                    Save to invitation queue
                  </label>
                </fieldset>
                <fieldset>
                  <legend>Required uploads for every intern</legend>
                  <ul>
                    {standardDocuments.map((doc) => (
                      <li key={doc.id}>{doc.label}</li>
                    ))}
                  </ul>
                </fieldset>
                <button disabled={working} className="button">
                  {queueOnly ? "Save to queue" : "Create invitation"}
                </button>
              </form>
            </section>
          ) : inv ? (
            <>
              <button
                className="textbtn"
                onClick={() =>
                  run(async () => {
                    const records = await list();
                    const current = records.find((r) => r.id === inv.id);
                    if (current && rosterGroup(current) !== view.group)
                      setView({ ...view, group: rosterGroup(current), search: "", page: 1 });
                    setInv(null);
                  })
                }
              >
                {received ? "Back to documents received" : "Back to invitation queue"}
              </button>
              <div className={received ? "hr-review" : "hr-grid"}>
                <section className="panel">
                  <span className="badge">{statuses[inv.status]}</span>
                  <h2>{inv.name}</h2>
                  <p>
                    {inv.role} · {inv.email}
                  </p>
                  <small>
                    {statusDate(inv.starts)} – {statusDate(inv.ends)}
                  </small>
                  <h3 className="spaced">Application details</h3>
                  <dl className="review-list">
                    {Object.entries({
                      ...profileValues(inv),
                      ...(inv.draft.address
                        ? { Address: inv.draft.address }
                        : {}),
                      ...(inv.draft.course ? { Course: inv.draft.course } : {}),
                      ...(inv.draft.year
                        ? { "Graduation year": inv.draft.year }
                        : {}),
                    }).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v || "Pending"}</dd>
                      </div>
                    ))}
                  </dl>
                  <h3 className="spaced">Intern-signed offer</h3>
                  <div className="proof">
                    {signedOffer ? (
                      <>
                        <a href={fileUrl(signedOffer.id, true)} target="_blank" rel="noreferrer">
                          <FileText size={15} />
                          {signedOffer.name}
                        </a>
                        <iframe title="Intern-signed offer preview" src={fileUrl(signedOffer.id, true)} />
                      </>
                    ) : <small>Awaiting upload</small>}
                  </div>
                  {inv.requirements
                    .filter((r) => r.id !== "signed")
                    .map((r) => {
                      const f = inv.files.find((f) => f.slot === r.id);
                      return (
                        <p key={r.id}>
                          {r.label} ·{" "}
                          {f ? (
                            <a
                              href={fileUrl(f.id, true)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {f.name}
                            </a>
                          ) : (
                            "Awaiting upload"
                          )}
                        </p>
                      );
                    })}
                  {inv.status === "submitted" && (
                    <>
                      <hr />
                      <h3>Request a correction</h3>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const d = new FormData(e.currentTarget);
                          void run(() => update("correct", d));
                        }}
                      >
                        <label>
                          Document
                          <select aria-label="Document" name="slot">
                            {inv.requirements.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          What needs to change?
                          <textarea name="message" required maxLength={800} />
                        </label>
                        <button disabled={working} className="secondary">
                          Request correction
                        </button>
                      </form>
                      <hr />
                      <h3>Issue final offer</h3>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const d = new FormData(e.currentTarget);
                          if (!signedOffer) return;
                          d.set("reviewed", signedOffer.id);
                          void run(() => update("issue", d));
                        }}
                      >
                        <label className="check">
                          <input
                            type="checkbox"
                            required
                            name="approved"
                            value="yes"
                          />
                          I reviewed the submitted offer and authorize the HR
                          countersignature and stamp.
                        </label>
                        <button disabled={working || !signedOffer} className="button">
                          {working ? "Processing…" : "Countersign and issue"}
                        </button>
                      </form>
                    </>
                  )}
                  {inv.correction && (
                    <div className="notice">
                      <strong>Requested correction</strong>
                      <p>{inv.correction.message}</p>
                    </div>
                  )}
                  {inv.issued_file && (
                    <section aria-labelledby="stamped-offer">
                      <h3 className="spaced" id="stamped-offer">Stamped offer letter</h3>
                      <IssuedOffer key={inv.issued_file} id={inv.issued_file} hr />
                    </section>
                  )}
                  {(inv.status === "correction" ||
                    (inv.status === "issued" && !inv.notified_at)) && (
                    <button
                      disabled={working}
                      className="secondary"
                      onClick={() => run(() => update("notify", form({})))}
                    >
                      Send notification
                    </button>
                  )}
                </section>
                {!received && (
                  <aside className="panel qr-card">
                    <div className="eyebrow">Adyapan Onboarding Portal</div>
                    <h2>
                      {inv.status === "queued"
                        ? "Pending invitation"
                        : "Invitation QR"}
                    </h2>
                    <p>
                      {inv.name} · {inv.role}
                    </p>
                    <p>
                      {inv.invitation_email_sent_at
                        ? "Last invitation email sent to " + inv.email
                        : "Invitation email pending for " + inv.email}
                    </p>
                    <button
                      className="secondary"
                      disabled={working}
                      onClick={() =>
                        run(async () => {
                          await request("email-invitation", form({ id: inv.id }));
                          await open(inv.id);
                          setNotice(
                            "Invitation email sent to " + inv.email + ".",
                          );
                        })
                      }
                    >
                      {inv.invitation_email_sent_at
                        ? "Resend invitation email"
                        : "Send invitation email"}
                    </button>
                    <img
                      className="qr"
                      alt={"Invitation QR for " + inv.name}
                      src={"/api/qr?id=" + inv.id}
                    />
                    <a className="invite-url" href={url}>
                      {url}
                    </a>
                    <div className="row">
                      <button
                        className="secondary"
                        onClick={() => window.print()}
                      >
                        <Printer size={15} /> Print QR
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          run(async () => {
                            if (navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setNotice("Invitation link copied.");
                            } else {
                              setNotice(
                                "Select and copy the invitation link above.",
                              );
                            }
                          })
                        }
                      >
                        <Copy size={15} /> Copy link
                      </button>
                    </div>
                  </aside>
                )}
              </div>
            </>
          ) : (
            <HrRoster
              rows={rows}
              view={view}
              setView={setView}
              busy={working}
              run={run}
              refresh={async () => {
                await list();
              }}
              open={open}
              notify={setNotice}
              create={() => {
                setQueueOnly(false);
                setCreate(true);
                setError("");
                setNotice("");
              }}
            />
          )}
        </>
      )}
    </main>
  );
}
