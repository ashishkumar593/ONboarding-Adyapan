"use client";
import { useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { request, fileUrl, form, RequestError } from "./client";
import {
  standardDocuments,
  rosterGroup,
  type RosterRow,
  profileValues,
  statuses,
  statusDate,
  type Invitation,
} from "@shared/model";
import HrRoster, { type RosterView } from "./HrRoster";
import IssuedOffer from "./IssuedOffer";
import type { Permission } from "@shared/hr";
const initialView: RosterView = { group: "awaiting", search: "", page: 1, size: 10 };
export default function Workspace() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rows, setRows] = useState<RosterRow[] | null>(null),
    [inv, setInv] = useState<Invitation | null>(null),
    [create, setCreate] = useState(false),
    [origin, setOrigin] = useState("");
  const [working, setWorking] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState(initialView);
  async function list() {
    const me: { permissions: Permission[] } = await request("me");
    setPermissions(me.permissions);
    if (!me.permissions.includes("invite")) setView(v=>({...v,group:"received"}));
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
      if (e instanceof RequestError && [401,428].includes(e.status)) {
        setRows(null); setInv(null); setCreate(false); setPermissions([]);
      }
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
            Sign in with your work email, password and personal access key to manage onboarding.
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
            <label>
              Access key
              <input required name="accessKey" type="password" autoComplete="off" maxLength={256} spellCheck={false} />
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
                Back to roster
              </button>
              <h2>Add intern</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void run(async () => {
                    await request("add-intern", data);
                    await list(); setCreate(false); setView(initialView);
                    setNotice("Intern added to the roster.");
                  });
                }}
              >
                <div className="twocol">
                  <label>
                    Intern name
                    <input name="name" required />
                  </label>
                  <label>
                    Registered email
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
                <fieldset>
                  <legend>Required uploads for every intern</legend>
                  <ul>
                    {standardDocuments.map((doc) => (
                      <li key={doc.id}>{doc.label}</li>
                    ))}
                  </ul>
                </fieldset>
                <button disabled={working} className="button">
                  Add intern
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
                {received ? "Back to documents received" : "Back to roster"}
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
                  {received && <>
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
                    .filter((r) => permissions.includes("review") && r.id !== "signed")
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
                  </>}
                  {inv.status === "submitted" && permissions.includes("review") && (
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
                    </>
                  )}
                  {inv.status === "submitted" && permissions.includes("issue") && (
                    <>
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
                  {permissions.includes("invite") && <button className="secondary" disabled={working} onClick={()=>run(async()=>{
                    const action = inv.access_revoked_at ? "restore" : "revoke";
                    if (!window.confirm(action === "revoke" ? "Revoke this intern's portal access and active sessions?" : "Restore access through the shared onboarding link?")) return;
                    await request(action,form({id:inv.id})); await open(inv.id);
                    setNotice(action === "revoke" ? "Intern access revoked." : "Intern access restored.");
                  })}>{inv.access_revoked_at ? "Restore intern access" : "Revoke intern access"}</button>}
                </section>
              </div>
            </>
          ) : (
            <HrRoster
              sharedUrl={origin ? new URL("/apply",origin).href : ""}
              permissions={permissions}
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
