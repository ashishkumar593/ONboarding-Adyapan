"use client";
import { useState } from "react";
import { Download, FileCheck2, Mail, Plus, Upload } from "lucide-react";
import { rosterGroup, statusDate, statuses, type RosterRow } from "@shared/model";
import { request, decodeFile, RequestError } from "./client";
import type { ReceivedExport } from "@shared/received-export";
export type RosterGroup = ReturnType<typeof rosterGroup>;
export type RosterView = { group: RosterGroup; search: string; page: number; size: number };
import type { Permission } from "@shared/hr";
type Props = {
  sharedUrl: string;
  permissions: Permission[];
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
  awaiting: "Awaiting documents",
  received: "Documents received",
};
const excelUrl = (group: string) => "/api/roster-xlsx?group=" + group;
export default function HrRoster({
  sharedUrl,
  permissions,
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
  const [importing,setImporting] = useState(false);
  const [progress,setProgress] = useState("");
  const received = rows.filter(r=>rosterGroup(r)==="received");
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
  function change(g: RosterGroup) {
    setView({ ...view, group: g, search: "", page: 1 });


    setImporting(false);
    notify("");
  }
  async function downloadRoster() {
    const response = await fetch(excelUrl(group), {cache:"no-store"});
    if (!response.ok) throw new RequestError((await response.json()).error, response.status);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "adyapan-" + group + ".xlsx";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
  return (
    <section className="roster" aria-label="Intern records">
      <nav className="roster-tabs" aria-label="HR lists">
        {permissions.includes("invite") && <button
          disabled={busy}
          aria-pressed={group !== "received"}
          onClick={() => change("awaiting")}
        >
          <Mail size={22} />
          <span>Intern roster</span>
          <b>{rows.length - received.length}</b>
        </button>}
        {permissions.some(p=>p!=="invite") && <button
          disabled={busy}
          aria-pressed={group === "received"}
          onClick={() => change("received")}
        >
          <FileCheck2 size={22} />
          <span>Documents received</span>
          <b>{received.length}</b>
        </button>}
      </nav>
      <section className="panel roster-panel">
        <div className="row between">
          <div>
            <h2>
              {group === "received" ? "Documents received" : "Intern roster"}
            </h2>
            <p>
              {group === "received"
                ? "Open a submission to review it, or export the workbook and uploaded files together as a ZIP."
                : "Import the Excel sheet to give listed interns access."}
            </p>
          </div>
          <div className="row">
            {group !== "received" && (
              <>
                <button className="button" disabled={busy} onClick={create}>
                  <Plus size={16} />
                  Add intern
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
            {permissions.includes("export") && (group === "received" ? (
              <button className="secondary" disabled={busy} onClick={() => run(downloadReceived)}>
                <Download size={16} />
                Export Excel + documents
              </button>
            ) : (
              <a className="secondary" href={excelUrl(group)} download onClick={e=>{ e.preventDefault(); void run(downloadRoster); }}>
                <Download size={16} />
                Export Excel
              </a>
            ))}
          </div>
        </div>
        {importing && (
          <section className="roster-import">
            <h3>Import interns from Excel</h3>
            <p>
              Use the first sheet for name, email, role, start date and end
              date. Existing email and start-date pairs are skipped. Importing
              makes these interns eligible to start onboarding.
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
                      change("awaiting");
                      await refresh();
                      notify(
                        result.added +
                          " added to the roster. " +
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
        {group === "awaiting" && sharedUrl && <section className="panel qr-card">
          <h3>Shared onboarding link</h3>
          <p>Share this link or QR code with every intern on your roster.</p>
          <img className="qr" src="/api/qr" alt="Shared onboarding QR code" />
          <a className="invite-url" href={sharedUrl}>{sharedUrl}</a>
          <div className="row">
            <button className="secondary" onClick={()=>run(async()=>{
              if (navigator.clipboard) {
                await navigator.clipboard.writeText(sharedUrl);
                notify("Onboarding link copied.");
              } else {
                const link = document.querySelector(".invite-url");
                const selection = window.getSelection();
                if (!link || !selection) return;
                const range = document.createRange();
                range.selectNodeContents(link);
                selection.removeAllRanges();
                selection.addRange(range);
                notify(document.execCommand("copy") ? "Onboarding link copied." : "The link is selected. Copy it to share.");
              }
            })}>Copy link</button>
            <a href="/api/qr" download="onboarding-qr.png">Download QR</a>
          </div>
        </section>}
        <label className="roster-search">
          Search {group === "received" ? "submissions" : "interns"}
          <input
            type="search"
            value={search}
            onChange={(e) => setView({ ...view, search: e.target.value, page: 1 })}
            placeholder="Name, email or internship role"
          />
        </label>
        {progress && <p role="status">{progress}…</p>}
        {visible.length ? (
          <div className="roster-scroll">
            <table>
              <thead>
                <tr>
                  <th>Intern</th>
                  <th>Internship</th>
                  <th>Status</th>
                  {group==="received" && <th>Received</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button
                        className="roster-name"
                        disabled={busy || (group === "received" && !permissions.some(p => p === "review" || p === "issue"))}
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
                    <td><span className="badge">{statuses[r.status]}</span></td>
                    {group==="received" && <td>{r.received_at ? statusDate(r.received_at) : r.reference}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="roster-empty">
            {search
              ? "No matching interns."
              : group === "received" ? "Submitted applications will appear here." : "Import an Excel sheet or add an intern to start."}
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
