import ExcelJS from "exceljs";
import type { ReceivedExport } from "@shared/received-export";
import { pool } from "./db";
import { statuses, type Invitation, type Doc } from "@shared/model";
import { validDrawing } from "@shared/signature";

type ReceivedRecord = Pick<Invitation,
  "id" | "name" | "email" | "role" | "starts" | "ends" | "status" |
  "draft" | "reference" | "requirements" | "correction"
> & {
  uploads: (Doc & { created_at: string })[];
  submissions: {
    created_at: string;
    snapshot: { agreed?: boolean; signature?: string; signatureMode?: string;
      terms?: string; version?: string; drawing?: unknown; acceptedAt?: string; files?: string[] };
  }[];
};

function sheet(workbook: ExcelJS.Workbook, name: string, columns: [string, number][]) {
  const page = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  page.columns = columns.map(([header, width]) => ({ header, width }));
  page.getRow(1).height = 25;
  page.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173E34" } };
  });
  return page;
}

export async function exportReceived(): Promise<ReceivedExport> {
  // Read related metadata in one database snapshot. Stored file IDs are immutable.
  const { rows } = await pool.query<ReceivedRecord>(`
    SELECT i.id,i.name,i.email,i.role,i.starts,i.ends,i.status,i.draft,i.reference,
      i.requirements,i.correction,
      ARRAY(SELECT to_jsonb(f) FROM files f WHERE f.invitation=i.id AND f.slot <> 'original'
            ORDER BY f.created_at,f.id) AS uploads,
      ARRAY(SELECT jsonb_build_object('created_at',s.created_at,'snapshot',s.snapshot)
            FROM submissions s WHERE s.invitation=i.id ORDER BY s.created_at,s.id) AS submissions
    FROM invitations i
    WHERE i.reference IS NOT NULL OR i.status IN ('submitted','correction','issued')
    ORDER BY i.name,i.id`);

  const book = new ExcelJS.Workbook();
  const interns = sheet(book, "Documents received", [
    ["Name", 26], ["Email", 34], ["Role", 26], ["Start date", 16], ["End date", 16],
    ["Status", 22], ["Employee ID", 18], ["Submission reference", 24], ["Documents received (UTC)", 28],
    ["Phone", 20], ["College", 32], ["Address", 34], ["Course", 26], ["Graduation year", 20],
    ["Correction requested", 42], ["Files", 12],
  ]);
  const documents = sheet(book, "Uploaded documents", [
    ["Submission reference", 24], ["Name", 26], ["Document", 34], ["Open file", 42],
    ["Uploaded (UTC)", 24], ["Size (bytes)", 16], ["Submission versions", 22], ["File ID", 40],
  ]);
  const declarations = sheet(book, "Signed declarations", [
    ["Submission reference", 24], ["Name", 26], ["Submission version", 20], ["Signed (UTC)", 24],
    ["Agreed", 12], ["Terms version", 20], ["Accepted terms", 72], ["Signed by", 26],
    ["Signature method", 20], ["Drawn signature", 22], ["Submission record", 24],
  ]);
  interns.getColumn(4).numFmt = interns.getColumn(5).numFmt = "yyyy-mm-dd";
  interns.getColumn(9).numFmt = documents.getColumn(5).numFmt =
    declarations.getColumn(4).numFmt = "yyyy-mm-dd hh:mm:ss";
  declarations.getColumn(7).alignment = { wrapText: true };

  const files: { path: string; id: string; bytes: number }[] = [];
  const records: { name: string; input: string }[] = [];
  for (const record of rows) {
    const { draft, uploads, submissions } = record;
    const name = draft.name || record.name;
    const ref = record.reference || record.id;
    const folder = "documents/" + (/^ADY-[0-9A-F]+$/.test(ref) ? ref : record.id);
    const latest = submissions.at(-1);
    interns.addRow([
      name, record.email, record.role, new Date(record.starts), new Date(record.ends),
      statuses[record.status] || record.status, draft.employeeId, ref, latest && new Date(latest.created_at),
      draft.phone, draft.college, draft.address, draft.course, draft.year, record.correction?.message, uploads.length,
    ]);
    const versions = new Map<string, number[]>();
    submissions.forEach(({ snapshot, created_at }, index) => {
      const version = index + 1;
      const base = folder + "/submission-" + version;
      for (const id of snapshot.files || []) versions.set(id, [...(versions.get(id) || []), version]);
      records.push({ name: base + ".json", input: JSON.stringify(snapshot, null, 2) });
      let signature;
      if (validDrawing(snapshot.drawing)) {
        const strokes = snapshot.drawing.map(points =>
          '<polyline points="' + points.map(point => point.join(",")).join(" ") + '"/>').join("");
        records.push({ name: base + ".svg", input: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 300"><g fill="none" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' + strokes + '</g></svg>' });
        signature = { text: "View signature", hyperlink: base + ".svg" };
      }
      declarations.addRow([
        ref, name, version, new Date(snapshot.acceptedAt || created_at),
        snapshot.agreed == null ? "" : snapshot.agreed ? "Yes" : "No",
        snapshot.version, snapshot.terms, snapshot.signature, snapshot.signatureMode,
        signature, { text: "Open signed record", hyperlink: base + ".json" },
      ]);
    });
    for (const [index, file] of uploads.entries()) {
      const label = record.requirements.find(r => r.id === file.slot)?.label ||
        (file.slot === "issued" ? "Issued offer" : file.slot);
      const extension = file.mime === "application/pdf" ? "pdf" : file.mime === "image/png" ? "png" : "jpg";
      const path = folder + "/" + (index + 1) + "-" + label.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) + "." + extension;
      documents.addRow([ref, name, label, { text: file.name, hyperlink: path },
        new Date(file.created_at), file.bytes, versions.get(file.id)?.join(", "), file.id]);
      files.push({ path, id: file.id, bytes: file.bytes });
    }
  }
  for (const page of book.worksheets) {
    page.autoFilter = { from: "A1", to: { row: page.rowCount, column: page.columnCount } };
  }
  return { workbook: Buffer.from(await book.xlsx.writeBuffer()).toString("base64"), files, records };
}
