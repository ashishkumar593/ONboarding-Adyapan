import { exportReceived } from "../services/received-export";
import { roster, importRoster, exportRoster, removeFromRoster } from "../services/roster";
import {
  verifyRosterEmail,
  remembersBrowser,
  rememberBrowser,
  redeemAccess,
  changeAccess,

} from "../services/access-mail";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { auth, login, permit, assigned, requireFresh, logAccess, setSession } from "../services/auth";
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
      const user = await auth();
      const inv = await details(pool, user.invitation);
      requireThat(
        !q.get("token") || q.get("token") === inv.token,
        "Verify this invitation to continue.",
        401,
      );
      const device = (await cookies()).get("ady_device")?.value;
      return json({ ...inv, rememberedBrowser: await remembersBrowser(pool, inv.id, device) });
    }
    if (action === "signing-policy") {
      await auth();
      const policy = signingPolicies.find(item => item.file === q.get("file"));
      requireThat(policy, "Policy unavailable.", 404);
      return new Response(new Uint8Array(await readPolicyPdf(policy)), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${policy.file}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (action === "file") {
      const user = await auth(q.get("hr") === "1");
      const file = (
        await pool.query(
          "SELECT * FROM files WHERE id=$1 AND slot <> 'original' AND ($2::boolean OR invitation=$3)",
          [uuid(q.get("id")), user.hr, user.invitation],
        )
      ).rows[0];
      requireThat(file, "File unavailable.", 404);
      if (user.hr) {
        permit(user,"review","issue");
        await assigned(user,file.invitation);
        if (!user.permissions.includes("review")) requireThat(["signed","issued"].includes(file.slot),"File unavailable.",404);
        await logAccess(user,"file requested",file.invitation,file.id);
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
    if (action === "me") return json({email:staff.staff,permissions:staff.permissions});
    if (action === "received-export") {
      permit(staff,"export"); requireFresh(staff);
      const bundle = await exportReceived(staff.staff);
      await logAccess(staff,"export prepared",null,null,{files:bundle.files.length,scope:"assigned"});
      return json(bundle);
    }
    if (action === "received-export-file") {
      permit(staff,"export"); requireFresh(staff);
      const id = uuid(q.get("id"));
      const file = await pool.query(
        `SELECT f.invitation FROM files f JOIN invitations i ON i.id=f.invitation
         JOIN hr_assignments a ON a.invitation=i.id AND a.staff=$2 WHERE f.id=$1 AND f.slot <> 'original' AND (i.reference IS NOT NULL OR i.status IN ('submitted','correction','issued'))`,
        [id,staff.staff],
      );
      requireThat(file.rowCount, "This export document is unavailable.", 404);
      const bytes = await get(id);
      await logAccess(staff,"file exported",file.rows[0].invitation,id,{bytes:bytes.length});
      return json({ content: bytes.toString("base64") });
    }
    if (action === "list") return json(await roster(staff));
    if (action === "roster-xlsx") {
      const group = q.get("group") || "pending";
      if (group === "template") permit(staff,"invite");
      else {
        permit(staff,"export"); requireFresh(staff);
        await logAccess(staff,"roster export requested",null,null,{group});
      }
      return await exportRoster(group,staff);
    }
    if (action === "record") {
      const id = uuid(q.get("id"));
      await assigned(staff,id);
      const inv = await details(pool,id);
      const received = !!inv.reference || ["submitted","issued","correction"].includes(inv.status);
      if (received) permit(staff,"review","issue");
      else permit(staff,"invite");
      if (!received) return json({...inv,token:"",draft:{},files:[],issued_file:null});
        if (!staff.permissions.includes("review")) {
          inv.files = inv.files.filter(f=>["signed","issued"].includes(f.slot));
          inv.draft = {name:inv.draft.name,employeeId:inv.draft.employeeId};
        }
      return json({...inv,token:""});
    }
    if (action === "qr") {
      permit(staff,"invite");
      const bytes = await QRCode.toBuffer(
        new URL("/apply",process.env.APP_ORIGIN).href,
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
    if (!["roster-login", "redeem-link", "hr-login", "logout"].includes(action))
      await auth(!["draft", "upload", "submit", "remember-browser"].includes(action));
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
      const device = (await cookies()).get("ady_device")?.value;
      const sessionToken = await verifyRosterEmail(emailAddress(data), device);
      if (!sessionToken) return json({ emailSent: true });
      await setSession(sessionToken);
      return json({ ok: true });
    }
    if (action === "redeem-link") {
      const token = await redeemAccess(
        field(data, "token", 32),
        field(data, "access", 43),
      );
      await setSession(token);
      return json({ ok: true });
    }
    if (action === "hr-login") {
      const token = await login(emailAddress(data), field(data,"password",256), field(data,"accessKey",256));
      await setSession(token,true);
      return json({ok:true});
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
    if (action === "remember-browser") {
      const user = await auth();
      requireThat(data.get("invitation") === user.invitation, "Reopen your application.", 409);
      const jar = await cookies();
      const key = await rememberBrowser(user.invitation, jar.get("ady_intern")!.value,
        jar.get("ady_device")?.value, data.get("remember") === "yes");
      if (key) jar.set("ady_device", key, {
        httpOnly: true, sameSite: "lax", secure: !demo() || process.env.APP_ORIGIN?.startsWith("https://"),
        path: "/", maxAge: 30 * 86400,
      });
      else jar.delete("ady_device");
      return json({ rememberedBrowser: !!key });
    }
    if (["upload", "draft", "submit"].includes(action)) {
      const user = await auth();
      requireThat(
        data.get("invitation") === user.invitation,
        "Your active invitation changed. Reopen the application.",
        409,
      );
      return json(await internAction(user.invitation, action, data));
    }
    const staff = await auth(true);
    if (action === "import-roster" || action === "add-intern") {
      permit(staff,"invite");
      return json(action === "add-intern" ? await createInvite(data,staff.staff) : await importRoster(data,staff.staff));
    }
    if (action === "remove-roster") {
      permit(staff, "invite");
      requireFresh(staff);
      const ids = [...new Set(data.getAll("id").map(value => uuid(typeof value === "string" ? value.toLowerCase() : null)))];
      requireThat(ids.length > 0, "Select at least one intern.");
      return json(await removeFromRoster(ids, staff));
    }
    const id = uuid(field(data,"id"));
    await assigned(staff,id);
    if (action === "revoke" || action === "restore") {
      permit(staff,"invite"); requireFresh(staff);
      return json(await changeAccess(id,staff.staff,action === "restore"));
    }
    if (["issue","correct","notify"].includes(action)) {
      if (action === "issue") {permit(staff,"issue"); requireFresh(staff);}
      else if (action === "notify") permit(staff,"review","issue");
      else permit(staff,"review");
      return json(await review(id,action,data,staff));
    }
    throw new Problem("Unavailable.", 404);
  } catch (e) {
    return error(e);
  }
}
