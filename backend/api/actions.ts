import { exportReceived, signatureSvg } from "../services/received-export";
import { roster, importRoster, exportRoster, removeFromRoster } from "../services/roster";
import { verifyRosterEmail, changeAccess } from "../services/access-mail";
import { resumeView, unfinished } from "../services/draft-progress";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { sharedOnboardingUrl } from "@shared/model";
import { auth, login, permit, assigned, requireFresh, logAccess, setLoginCookie } from "../services/auth";
import {
  details,
  demo,
  hash,
  pool,
  Problem,
  requireThat,
} from "../services/db";
import {
  createInvite,
  emailAddress,
  field,
  internAction,
  review,
} from "../services/flow";
import { get } from "../services/private";
import { readPolicyPdf, signingPolicies } from "../services/signing-policies";
type Context = { params: Promise<{ action: string }> };
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function error(e: unknown) {
  if (e instanceof Problem) return json({ error: e.message }, e.status);
  if (e instanceof Error && "code" in e && e.code === "28P01") {
    console.error("Database authentication failed (28P01). Check the deployed DATABASE_URL.");
    return json({ error: "The portal cannot connect to the onboarding database. Please contact HR." }, 503);
  }
  console.error(
    "Portal request failed",
    e instanceof Error ? `${e.name}: ${e.message}` : "Unknown",
  );
  return json(
    { error: "The server could not finish this request. Please try again." },
    503,
  );
}
function uuid(value: string | null) {
  requireThat(
    value && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value),
    "Invalid reference.",
    400,
  );
  return value;
}
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { action } = await ctx.params,
      q = req.nextUrl.searchParams;
    if (action === "application") {
      const user = await auth(false, true);
      requireThat(!q.get("token") || q.get("token") === user.token, "Sign in to this application.", 401);
      if (user.method === "roster-status") {
        if (["queued", "invited", "draft"].includes(user.status)) {
          const inv = await details(pool, user.invitation);
          if (await unfinished(pool, inv)) return json(resumeView(inv, { digest: user.digest, progress: user.draft_progress }));
        }
        return json({
          statusOnly: true,
          email: user.email,
          status: user.status,
          issued_file: user.status === "issued" ? user.issued_file : null,
        });
      }
      return json(await details(pool, user.invitation));
    }
    if (action === "signing-policy") {
      await auth(false, true);
      const policy = signingPolicies.find(item => item.file === q.get("file"));
      requireThat(policy, "Policy unavailable.", 404);
      const bytes = await readPolicyPdf(policy);
      if (q.get("format") === "json") return json({ content: bytes.toString("base64") });
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${policy.file}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (action === "file") {
      const user = await auth(q.get("hr") === "1", true);
      const file = (
        await pool.query(
          "SELECT * FROM files WHERE id=$1 AND slot <> 'original' AND ($2::boolean OR invitation=$3)",
          [uuid(q.get("id")), user.hr, user.invitation],
        )
      ).rows[0];
      requireThat(file, "File unavailable.", 404);
      if (!user.hr && user.method === "roster-status" && file.slot !== "issued") {
        requireThat(["queued", "invited", "draft"].includes(user.status), "File unavailable.", 404);
      }
      if (user.hr) {
        permit(user, "review", "issue");
        await assigned(user, file.invitation);
        if (!user.permissions.includes("review")) requireThat(["signed", "issued"].includes(file.slot), "File unavailable.", 404);
        await logAccess(user, "file requested", file.invitation, file.id);
      }
      if (q.get("format") === "json") {
        requireThat(file.slot === "issued" && file.mime === "application/pdf", "Issued offer unavailable.", 404);
        const bytes = await get(file.id);
        requireThat(bytes.length === file.bytes, "The issued PDF could not be read. Please retry.", 503);
        return json({ name: file.name, content: bytes.toString("base64") });
      }
      const bytes = await get(file.id);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": file.mime,
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Content-Disposition":
            (q.get("download") ? "attachment" : "inline") +
            "; filename*=UTF-8''" +
            encodeURIComponent(file.name).replace(/'/g, "%27"),
        },
      });
    }
    const staff = await auth(true);
    if (action === "me") return json({ email: staff.staff, permissions: staff.permissions });
    if (action === "received-export" || (action === "roster-xlsx" && q.get("group") === "received")) {
      permit(staff, "export"); requireFresh(staff);
      const year = q.get("year") || "", month = q.get("month") || "";
      requireThat(!year || /^\d{4}$/.test(year), "Select a valid year.");
      requireThat(!month || /^(0[1-9]|1[0-2])$/.test(month), "Select a valid month.");
      const standalone = action === "roster-xlsx";
      const portal = demo() ? new URL(process.env.APP_ORIGIN || req.nextUrl.origin).origin : sharedOnboardingUrl;
      const bundle = await exportReceived(staff.staff, year, month, q.get("search") || "", standalone ? portal : undefined);
      await logAccess(staff, "export prepared", null, null, { files: bundle.files.length, scope: "assigned", year, month, standalone });
      if (standalone) return new Response(new Uint8Array(bundle.workbook), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="adyapan-documents-received.xlsx"',
          "Cache-Control": "private, no-store",
        }
      });
      return json({ ...bundle, workbook: Buffer.from(bundle.workbook).toString("base64") });
    }
    if (action === "received-export-record") {
      permit(staff, "export"); requireFresh(staff);
      const id = uuid(q.get("id"));
      const record = (await pool.query(
        `SELECT s.snapshot,s.invitation FROM submissions s JOIN hr_assignments a ON a.invitation=s.invitation
         JOIN invitations i ON i.id=s.invitation WHERE s.id=$1 AND a.staff=$2 AND i.status <> 'removed'
         AND (i.reference IS NOT NULL OR i.status IN ('submitted','correction','issued'))`, [id, staff.staff],
      )).rows[0];
      requireThat(record, "Submission unavailable.", 404);
      await logAccess(staff, "exported declaration opened", record.invitation, null, { submission: id });
      if (!q.has("drawing")) return json(record.snapshot);
      const svg = signatureSvg(record.snapshot.drawing);
      requireThat(svg, "Drawn signature unavailable.", 404);
      return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "private, no-store" } });
    }
    if (action === "received-export-file") {
      permit(staff, "export"); requireFresh(staff);
      const id = uuid(q.get("id"));
      const file = await pool.query(
        `SELECT f.invitation,f.mime,f.name FROM files f JOIN invitations i ON i.id=f.invitation
         JOIN hr_assignments a ON a.invitation=i.id AND a.staff=$2 WHERE f.id=$1 AND f.slot <> 'original' AND i.status <> 'removed' AND (i.reference IS NOT NULL OR i.status IN ('submitted','correction','issued'))`,
        [id, staff.staff],
      );
      requireThat(file.rowCount, "This export document is unavailable.", 404);
      const bytes = await get(id);
      await logAccess(staff, "file exported", file.rows[0].invitation, id, { bytes: bytes.length });
      if (q.get("open") === "1") return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": file.rows[0].mime, "Cache-Control": "private, no-store",
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(file.rows[0].name).replace(/'/g, "%27"),
        }
      });
      return json({ content: bytes.toString("base64") });
    }
    if (action === "list") return json(await roster(staff));
    if (action === "roster-xlsx") {
      const group = q.get("group") || "pending";
      if (group === "template") permit(staff, "invite");
      else {
        permit(staff, "export"); requireFresh(staff);
        await logAccess(staff, "roster export requested", null, null, { group });
      }
      return await exportRoster(group, staff);
    }
    if (action === "record") {
      const id = uuid(q.get("id"));
      await assigned(staff, id);
      const inv = await details(pool, id);
      const received = !!inv.reference || ["submitted", "issued", "correction"].includes(inv.status);
      if (received) permit(staff, "review", "issue");
      else permit(staff, "invite");
      if (!received) return json({ ...inv, token: "", draft: {}, files: [], issued_file: null });
      if (!staff.permissions.includes("review")) {
        inv.files = inv.files.filter(f => ["signed", "issued"].includes(f.slot));
        inv.draft = { name: inv.draft.name, employeeId: inv.draft.employeeId };
      }
      return json({ ...inv, token: "" });
    }
    if (action === "qr") {
      permit(staff, "invite");
      const bytes = await QRCode.toBuffer(
        sharedOnboardingUrl,
        { width: 520, margin: 4 },
      );
      return new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    }
    if (action === "origin") return json({ origin: process.env.APP_ORIGIN });
    throw new Problem("Unavailable.", 404);
  } catch (e) {
    return error(e);
  }
}
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { action } = await ctx.params;
    const origin = req.headers.get("origin");
    requireThat(
      origin && new URL(origin).host === req.headers.get("host"),
      "Reload this page to continue.",
      403,
    );
    requireThat(
      Number(req.headers.get("content-length") || 0) <= 9 * 1024 * 1024,
      "Choose a file up to 8 MB.",
      413,
    );
    if (!["roster-login", "hr-login", "logout"].includes(action))
      await auth(!["save-progress", "draft", "upload", "submit"].includes(action), true);
    const body = req.body?.getReader();
    requireThat(body, "Empty request.");
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    while (true) {
      const chunk = await body.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 9 * 1024 * 1024) {
        await body.cancel();
        throw new Problem("Choose a file up to 8 MB.", 413);
      }
      parts.push(new Uint8Array(chunk.value));
    }
    const data = await new Response(new Blob(parts), {
      headers: { "Content-Type": req.headers.get("content-type") || "" },
    }).formData();
    if (action === "roster-login") {
      const session = await verifyRosterEmail(emailAddress(data));
      await setLoginCookie("ady_intern", session.token, session.expires);
      return json({ ok: true });
    }
    if (action === "hr-login") {
      const token = await login(emailAddress(data), field(data, "password", 256), field(data, "accessKey", 256));
      await setLoginCookie("ady_hr", token, new Date(Date.now() + 8 * 3600_000));
      return json({ ok: true });
    }
    if (action === "logout") {
      const key = data.get("hr") === "1" ? "ady_hr" : "ady_intern",
        jar = await cookies();
      await pool.query("DELETE FROM sessions WHERE digest=$1", [
        hash(jar.get(key)?.value || ""),
      ]);
      jar.delete(key);
      return json({ ok: true });
    }
    if (["upload", "save-progress", "draft", "submit"].includes(action)) {
      const user = await auth(false, true);
      requireThat(
        data.get("invitation") === user.invitation,
        "Your active invitation changed. Reopen the application.",
        409,
      );
      return json(await internAction(user.invitation, action, data, user.method === "roster-status" ? user.digest : undefined));
    }
    const staff = await auth(true);
    if (action === "import-roster" || action === "add-intern") {
      permit(staff, "invite");
      return json(action === "add-intern" ? await createInvite(data, staff.staff) : await importRoster(data, staff.staff));
    }
    if (action === "remove-roster") {
      permit(staff, "invite");
      requireFresh(staff);
      const ids = [...new Set(data.getAll("id").map(value => uuid(typeof value === "string" ? value.toLowerCase() : null)))];
      requireThat(ids.length > 0, "Select at least one intern.");
      return json(await removeFromRoster(ids, staff));
    }
    const id = uuid(field(data, "id"));
    await assigned(staff, id);
    if (action === "revoke" || action === "restore") {
      permit(staff, "invite"); requireFresh(staff);
      return json(await changeAccess(id, staff.staff, action === "restore"));
    }
    if (["issue", "correct", "notify"].includes(action)) {
      if (action === "issue") { permit(staff, "issue"); requireFresh(staff); }
      else if (action === "notify") permit(staff, "review", "issue");
      else permit(staff, "review");
      return json(await review(id, action, data, staff));
    }
    throw new Problem("Unavailable.", 404);
  } catch (e) {
    return error(e);
  }
}
