import type { StaffSession } from "./auth";
import ExcelJS from "exceljs";
import { fromBuffer } from "yauzl";
import { pool, Problem, requireThat, transaction } from "./db";
import { invitationFields, queueInvite } from "./flow";
import { rosterGroup, statuses, type RosterRow } from "@shared/model";

const fields = [
  ["name", "Name", 28],
  ["email", "Email", 36],
  ["role", "Role", 28],
  ["starts", "Start date", 17],
  ["ends", "End date", 17],
] as const;
export async function roster(user: StaffSession): Promise<RosterRow[]> {
  return (
    await pool.query(`SELECT i.id,coalesce(nullif(i.draft->>'name',''),i.name) AS name,i.email,i.role,i.starts,i.ends,i.status,
    i.reference,i.invitation_email_sent_at,i.draft->>'employeeId' AS employee_id,
    (SELECT max(s.created_at) FROM submissions s WHERE s.invitation=i.id) AS received_at
    FROM invitations i JOIN hr_assignments a ON a.invitation=i.id AND a.staff=$1
    WHERE i.status <> 'removed' AND CASE WHEN i.reference IS NOT NULL OR i.status IN ('submitted','correction','issued')
      THEN $2::boolean ELSE $3::boolean END ORDER BY i.created_at DESC, i.id`,[user.staff,
      user.permissions.some(p=>p==="review" || p==="issue" || p==="export"),user.permissions.includes("invite")])
  ).rows;
}

export async function removeFromRoster(ids: string[], user: StaffSession) {
  return transaction(async db => {
    const { rows } = await db.query(
      `SELECT i.id, i.status, i.reference FROM invitations i
       JOIN hr_assignments a ON a.invitation=i.id AND a.staff=$2
       WHERE i.id=ANY($1::uuid[]) ORDER BY i.id FOR UPDATE OF i,a`, [ids, user.staff],
    );
    requireThat(rows.length === ids.length, "One or more roster records are unavailable.", 404);
    requireThat(rows.every(row => !row.reference && ["queued", "invited", "draft", "removed"].includes(row.status)),
      "An intern has already submitted documents. Refresh the roster and review your selection.", 409);
    const active = rows.filter(row => row.status !== "removed").map(row => row.id);
    if (active.length) {
      await db.query("UPDATE invitations SET status='removed', access_revoked_at=now() WHERE id=ANY($1::uuid[])", [active]);
      await db.query("DELETE FROM sessions WHERE invitation=ANY($1::uuid[])", [active]);
      await db.query("DELETE FROM email_access_links WHERE invitation=ANY($1::uuid[])", [active]);
      await db.query(`INSERT INTO events(invitation,action,detail)
        SELECT id,'removed from roster',jsonb_build_object('actor',$2::text) FROM unnest($1::uuid[]) AS id`, [active, user.staff]);
    }
    return { removed: active.length };
  });
}

export async function exportRoster(group: string, user: StaffSession) {
  if (group === "pending") group = "awaiting";
  requireThat(
    ["awaiting", "received", "template"].includes(group),
    "Select a list to export.",
  );
  const workbook = new ExcelJS.Workbook();
  const titles: Record<string, string> = {
    awaiting: "Intern roster",
    received: "Documents received",
    template: "Intern roster",
  };
  const sheet = workbook.addWorksheet(titles[group], {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = fields.map(([key, header, width]) => ({
    key,
    header,
    width,
  }));
  if (group !== "template") {
    sheet.getColumn(6).header = "Status";
    sheet.getColumn(6).width = 24;
    if (group === "received") {
      ["Employee ID", "Submission reference", "Documents received (UTC)"].forEach((name, i) => {
        sheet.getColumn(i + 7).header = name;
        sheet.getColumn(i + 7).width = 26;
      });
      sheet.getColumn(9).numFmt = "yyyy-mm-dd hh:mm";
    }
    for (const row of (await roster(user)).filter(
      (row) => rosterGroup(row) === group,
    )) {
      const values = [
        row.name,
        row.email,
        row.role,
        new Date(row.starts + "T00:00:00Z"),
        new Date(row.ends + "T00:00:00Z"),
        statuses[row.status],
      ];
      if (group === "received")
        values.push(row.employee_id || "", row.reference || "", row.received_at ? new Date(row.received_at) : "");
      sheet.addRow(values);
    }
  }
  sheet.getColumn(4).numFmt = sheet.getColumn(5).numFmt = "yyyy-mm-dd";
  const header = sheet.getRow(1);
  header.height = 25;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF173E34" },
    };
    cell.alignment = { vertical: "middle" };
  });
  sheet.autoFilter = {
    from: "A1",
    to: { row: Math.max(1, sheet.rowCount), column: header.cellCount },
  };
  return new Response(new Uint8Array(await workbook.xlsx.writeBuffer()), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="adyapan-' + group + '.xlsx"',
      "Cache-Control": "private, no-store",
    },
  });
}

async function checkArchive(buffer: Buffer) {
  await new Promise<void>((resolve, reject) =>
    fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(new Problem("Choose a valid .xlsx workbook."));
        return;
      }
      let size = 0;
      zip.on("error", () =>
        reject(new Problem("The workbook cannot be read.")),
      );
      zip.on("entry", (entry) => {
        size += entry.uncompressedSize;
        if (
          size > 24 * 1024 * 1024 ||
          zip.entryCount > 2000 ||
          entry.isEncrypted()
        ) {
          zip.close();
          reject(new Problem("Choose a smaller, unencrypted roster workbook."));
          return;
        }
        zip.readEntry();
      });
      zip.on("end", () => {
        zip.close();
        resolve();
      });
      zip.readEntry();
    }),
  );
}
function cellText(
  cell: ExcelJS.Cell,
  date: boolean,
  epoch1904: boolean,
): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (
    date &&
    typeof v === "number" &&
    Number.isInteger(v) &&
    v > 0 &&
    v < 2958466
  )
    return new Date(
      Date.UTC(
        epoch1904 ? 1904 : 1899,
        epoch1904 ? 0 : 11,
        epoch1904 ? 1 : 30,
      ) +
        v * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  if (typeof v === "object" && "hyperlink" in v) return v.text.trim();
  if (typeof v === "object" && "richText" in v)
    return v.richText
      .map((r) => r.text)
      .join("")
      .trim();
  throw new Problem(
    "Use plain text or an Excel date in cell " + cell.address + ".",
  );
}
export async function importRoster(data: FormData, actor: string) {
  const file = data.get("workbook");
  requireThat(
    file instanceof File &&
      /\.xlsx$/i.test(file.name) &&
      file.size > 0 &&
      file.size <= 5 * 1024 * 1024,
    "Choose an .xlsx workbook up to 5 MB.",
  );
  const bytes = await file.arrayBuffer();
  await checkArchive(Buffer.from(bytes));
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes, {
      ignoreNodes: ["drawing", "dataValidations", "conditionalFormatting"],
    });
  } catch {
    throw new Problem("Choose a readable Excel workbook (.xlsx).");
  }
  const sheet = workbook.worksheets[0];
  requireThat(sheet, "The workbook needs a worksheet.");
  const columns = new Map<string, number>();
  sheet.getRow(1).eachCell((c, i) => {
    const key = c.text.trim().toLowerCase();
    if (columns.has(key))
      throw new Problem("Repeated column heading: " + c.text);
    columns.set(key, i);
  });
  for (const [, label] of fields)
    requireThat(
      columns.has(label.toLowerCase()),
      "Missing column: " + label + ". Use the invitation template.",
    );
  const rows: ReturnType<typeof invitationFields>[] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const values = new FormData();
    for (const [key, label] of fields)
      values.set(
        key,
        cellText(
          row.getCell(columns.get(label.toLowerCase())!),
          key === "starts" || key === "ends",
          !!workbook.properties.date1904,
        ),
      );
    if (fields.every(([key]) => !values.get(key))) return;
    requireThat(rows.length < 1000, "Import up to 1,000 interns per workbook.");
    try {
      rows.push(invitationFields(values));
    } catch (e) {
      if (e instanceof Problem)
        throw new Problem("Row " + n + ": " + e.message);
      throw e;
    }
  });
  requireThat(
    rows.length,
    "Add at least one intern below the column headings.",
  );
  rows.sort(
    (a, b) =>
      a.email.localeCompare(b.email) || a.starts.localeCompare(b.starts),
  );
  return transaction(async (db) => {
    let added = 0;
    for (const row of rows) if (await queueInvite(db, row, actor)) added++;
    return { added, skipped: rows.length - added };
  });
}
