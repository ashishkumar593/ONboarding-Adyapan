"use client";
import { useState } from "react";
import { Download, FileCheck2, Mail, Plus, Upload, Send } from "lucide-react";
import { rosterGroup, statusDate, statuses, type RosterRow } from "@shared/model";
import { request, form, decodeFile } from "./client";
import type { ReceivedExport } from "@shared/received-export";
export type RosterGroup = ReturnType<typeof rosterGroup>;
export type RosterView = { group: RosterGroup; search: string; page: number; size: number };
type Props = {
  rows: RosterRow[];
  view: RosterView;
  setView: (view: RosterView) => void;
  busy: boolean;
  run: (job: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
  create: () => void;
  notify: (s: string) => void;
};
const titles = {
  pending: "To invite",
  awaiting: "Awaiting documents",
  received: "Documents received",
};
const excelUrl = (group: string) => "/api/roster-xlsx?group=" + group;
export default function HrRoster({
  rows,
  view,
  setView,
  busy,
  run,
  refresh,
  open,
  create,
  notify,
}: Props) {
  const { group, search, size } = view;
  const [selected, setSelected] = useState<string[]>([]),
    [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(""),
    [issues, setIssues] = useState<string[]>([]);
  const pending = rows.filter((r) => rosterGroup(r) === "pending"),
    received = rows.filter((r) => rosterGroup(r) === "received");
  const matches = rows.filter(
    (r) =>
      rosterGroup(r) === group &&
      [r.name, r.email, r.role, r.employee_id, r.reference]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(matches.length / size));
  const page = Math.min(view.page, pages);
  const offset = (page - 1) * size;
  const visible = matches.slice(offset, offset + size);
  const chosen = matches.filter((r) => selected.includes(r.id));
  const selectedHere = visible.filter((r) => selected.includes(r.id)).length;
  const all = visible.length > 0 && visible.length === selectedHere;
  function change(g: RosterGroup) {
    setView({ ...view, group: g, search: "", page: 1 });
    setSelected([]);
    setIssues([]);
    setImporting(false);
    notify("");
  }
  async function downloadReceived() {
    setProgress("Preparing workbook");
    try {
      const { downloadZip } = await import("client-zip");
      const bundle: ReceivedExport = await request("received-export");
      async function* entries() {
        yield { name: "Documents received.xlsx", input: decodeFile(bundle.workbook) };
        yield* bundle.records;
        for (const [index, file] of bundle.files.entries()) {
          setProgress("Preparing document " + (index + 1) + " of " + bundle.files.length);
          const response = await request("received-export-file?id=" + encodeURIComponent(file.id));
          const input = decodeFile(response.content);
          if (input.byteLength !== file.bytes) throw new Error("A document was incomplete. Please retry the export.");
          yield { name: file.path, input };
        }
      }
      const archive = await downloadZip(entries()).blob();
      const url = URL.createObjectURL(archive);
      const link = document.createElement("a");
      link.href = url;
      link.download = "adyapan-documents-received.zip";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      notify("Export ready. Extract the ZIP and open Documents received.xlsx.");
    } finally {
      setProgress("");
    }
  }
  async function send(batch: RosterRow[]) {
    setIssues([]);
    const failures: string[] = [],
      retry: string[] = [];
    let sent = 0,
      skipped = 0;
    try {
      for (const [i, r] of batch.entries()) {
        setProgress("Sending " + (i + 1) + " of " + batch.length);
        try {
          const result = await request("send-queued", form({ id: r.id }));
          if (result.sent) sent++;
          else skipped++;
        } catch (e) {
          failures.push(r.email + " — " + (e as Error).message);
          retry.push(r.id);
        }
      }
      setSelected(retry);
      setIssues(failures);
      await refresh();
      notify(
        sent +
          " sent" +
          (skipped ? ", " + skipped + " already processed" : "") +
          (failures.length ? ", " + failures.length + " failed" : "") +
          ".",
      );
    } finally {
      setProgress("");
    }
  }
  return (
    <section className="roster" aria-label="Intern records">
      <nav className="roster-tabs" aria-label="HR lists">
        <button
          disabled={busy}
          aria-pressed={group !== "received"}
          onClick={() => change("pending")}
        >
          <Mail size={22} />
          <span>Invitation queue</span>
          <b>{pending.length}</b>
        </button>
        <button
          disabled={busy}
          aria-pressed={group === "received"}
          onClick={() => change("received")}
        >
          <FileCheck2 size={22} />
          <span>Documents received</span>
          <b>{received.length}</b>
        </button>
      </nav>
      <section className="panel roster-panel">
        <div className="row between">
          <div>
            <h2>
              {group === "received" ? "Documents received" : "Invitations"}
            </h2>
            <p>
              {group === "received"
                ? "Open a submission to review it, or export the workbook and uploaded files together as a ZIP."
                : "Send personal onboarding links to interns individually or in bulk."}
            </p>
          </div>
          <div className="row">
            {group !== "received" && (
              <>
                <button className="button" disabled={busy} onClick={create}>
                  <Plus size={16} />
                  Create invitation
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  aria-expanded={importing}
                  onClick={() => setImporting(!importing)}
                >
                  <Upload size={16} />
                  Import Excel
                </button>
              </>
            )}
            {group === "received" ? (
              <button className="secondary" disabled={busy} onClick={() => run(downloadReceived)}>
                <Download size={16} />
                Export Excel + documents
              </button>
            ) : (
              <a className="secondary" href={excelUrl(group)} download>
                <Download size={16} />
                Export Excel
              </a>
            )}
          </div>
        </div>
        {importing && (
          <section className="roster-import">
            <h3>Import interns from Excel</h3>
            <p>
              Use the first sheet for name, email, role, start date and end
              date. Existing email and start-date pairs are skipped. Importing
              adds rows to the queue for HR to review.
            </p>
            <div className="row">
              <a href={excelUrl("template")} download>
                Download Excel template
              </a>
              <label className="upload-label">
                Choose Excel workbook
                <input
                  type="file"
                  aria-label="Import Excel workbook"
                  accept=".xlsx"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void run(async () => {
                      const d = new FormData();
                      d.set("workbook", file);
                      const result = await request("import-roster", d);
                      change("pending");
                      await refresh();
                      notify(
                        result.added +
                          " added to the queue. " +
                          result.skipped +
                          " duplicates skipped.",
                      );
                    });
                  }}
                />
              </label>
            </div>
          </section>
        )}
        {group !== "received" && (
          <div className="roster-filters" aria-label="Invitation status">
            {(["pending", "awaiting"] as const).map((g) => (
              <button
                key={g}
                disabled={busy}
                aria-pressed={g === group}
                onClick={() => change(g)}
              >
                {titles[g]}{" "}
                <span>
                  {g === "pending"
                    ? pending.length
                    : rows.length - pending.length - received.length}
                </span>
              </button>
            ))}
          </div>
        )}
        <label className="roster-search">
          Search {group === "received" ? "submissions" : "invitations"}
          <input
            type="search"
            value={search}
            onChange={(e) => setView({ ...view, search: e.target.value, page: 1 })}
            placeholder="Name, email or internship role"
          />
        </label>
        {group === "pending" && !!pending.length && (
          <div className="roster-batch">
            <div className="row">
              <button
                className="button"
                disabled={busy || !chosen.length}
                onClick={() => run(() => send(chosen))}
              >
                <Send size={15} />
                Send selected ({chosen.length})
              </button>
            </div>
          </div>
        )}
        {progress && <p role="status">{progress}…</p>}
        {!!issues.length && (
          <div className="error" role="alert">
            <strong>Needs attention</strong>
            <ul>
              {issues.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {visible.length ? (
          <div className="roster-scroll">
            <table>
              <thead>
                <tr>
                  {group === "pending" && (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all invitations on this page"
                        ref={input => { if (input) input.indeterminate = selectedHere > 0 && !all; }}
                        checked={all}
                        disabled={busy || !visible.length}
                        onChange={() => {
                          const pageIds = visible.map(r => r.id);
                          setSelected(ids => all
                            ? ids.filter(id => !pageIds.includes(id))
                            : [...new Set([...ids, ...pageIds])]);
                        }}
                      />
                    </th>
                  )}
                  <th>Intern</th>
                  <th>Internship</th>
                  {group !== "pending" && <th>Status</th>}
                  <th>
                    {group === "received"
                      ? "Received"
                      : group === "awaiting"
                        ? "Invitation"
                        : "Send"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    {group === "pending" && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={"Select " + r.email}
                          checked={selected.includes(r.id)}
                          disabled={busy}
                          onChange={() =>
                            setSelected((ids) =>
                              ids.includes(r.id)
                                ? ids.filter((id) => id !== r.id)
                                : [...ids, r.id],
                            )
                          }
                        />
                      </td>
                    )}
                    <td>
                      <button
                        className="roster-name"
                        disabled={busy}
                        onClick={() => run(() => open(r.id))}
                      >
                        {r.name}
                      </button>
                      <small>{r.email}</small>
                    </td>
                    <td>
                      {r.role}
                      <small>{statusDate(r.starts)}</small>
                    </td>
                    {group !== "pending" && (
                      <td><span className="badge">{statuses[r.status]}</span></td>
                    )}
                    <td>
                      {group === "pending" ? (
                        <button
                          className="secondary"
                          disabled={busy}
                          aria-label={"Send invitation to " + r.email}
                          onClick={() => run(() => send([r]))}
                        >
                          Send
                        </button>
                      ) : group === "received" ? (
                        r.received_at ? (
                          statusDate(new Date(r.received_at).toISOString())
                        ) : (
                          r.reference
                        )
                      ) : r.invitation_email_sent_at ? (
                        "Sent"
                      ) : (
                        "In progress"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="roster-empty">
            {search
              ? "No matching interns."
              : group === "pending"
                ? "No interns waiting for an invitation. Add one or import an Excel workbook."
                : group === "received"
                  ? "Submitted applications will appear here for review."
                  : "No invitations are awaiting documents."}
          </p>
        )}
        <nav className="roster-paging" aria-label={titles[group] + " pagination"}>
          <span aria-live="polite">
            {matches.length ? offset + 1 : 0}–{offset + visible.length} of {matches.length}
          </span>
          <label>
            Rows per page
            <select value={size} disabled={busy}
              onChange={e => setView({ ...view, size: Number(e.target.value), page: 1 })}>
              {[5, 10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="row">
            <button className="secondary" disabled={busy || page === 1}
              onClick={() => setView({ ...view, page: page - 1 })}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button className="secondary" disabled={busy || page === pages}
              onClick={() => setView({ ...view, page: page + 1 })}>Next</button>
          </div>
        </nav>
      </section>
    </section>
  );
}
