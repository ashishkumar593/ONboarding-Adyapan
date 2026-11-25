import { exportReceived } from "@/lib/received-export";
import { roster, importRoster, exportRoster } from "@/lib/roster";
import {
  verifyInvitation,
  redeemAccess,
  emailInvitation,
} from "@/lib/access-mail";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { auth, hrPassword, session, setSession } from "@/lib/auth";
import {
  details,
  hash,
  pool,
  Problem,
  requireThat,
  transaction,
} from "@/lib/db";
import {
  createInvite,
  emailAddress,
  field,
  internAction,
  review,
} from "@/lib/flow";
import { get, mail } from "@/lib/private";
type Context = { params: Promise<{ action: string }> };
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function error(e: unknown) {
  if (e instanceof Problem) return json({ error: e.message }, e.status);
  console.error(
    "Portal request failed",
    e instanceof Error ? e.name : "Unknown",
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
      return json(inv);
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
    await auth(true);
    if (action === "received-export") return json(await exportReceived());
    if (action === "received-export-file") {
      const id = uuid(q.get("id"));
      const file = await pool.query(
        `SELECT 1 FROM files f JOIN invitations i ON i.id=f.invitation
         WHERE f.id=$1 AND f.slot <> 'original' AND (i.reference IS NOT NULL OR i.status IN ('submitted','correction','issued'))`,
        [id],
      );
      requireThat(file.rowCount, "This export document is unavailable.", 404);
      return json({ content: (await get(id)).toString("base64") });
    }
    if (action === "list") return json(await roster());
    if (action === "roster-xlsx")
      return await exportRoster(q.get("group") || "pending");
    if (action === "record")
      return json(await details(pool, uuid(q.get("id"))));
    if (action === "qr") {
      const inv = await details(pool, uuid(q.get("id")));
      const bytes = await QRCode.toBuffer(
        process.env.APP_ORIGIN + "/i/" + inv.token,
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
    if (!["verify-invitation", "redeem-link", "hr-login", "logout"].includes(action))
      await auth(!["draft", "upload", "submit"].includes(action));
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
    if (action === "verify-invitation") {
      const sessionToken = await verifyInvitation(emailAddress(data), field(data, "token", 32));
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
    if (action === "email-invitation") {
      await emailInvitation(uuid(field(data, "id")));
      return json({ ok: true });
    }
    if (action === "hr-login") {
      const email = emailAddress(data),
        password = field(data, "password", 256);
      requireThat(
        email === process.env.HR_EMAIL,
        "Check your sign-in details.",
        401,
      );
      const token = await transaction(async (db) => {
        await db.query(
          "INSERT INTO hr_login(account) VALUES($1) ON CONFLICT DO NOTHING",
          [email],
        );
        const row = (
          await db.query(
            "SELECT *,since>now()-interval '10 minutes' AS recent FROM hr_login WHERE account=$1 FOR UPDATE",
            [email],
          )
        ).rows[0];
        requireThat(
          !row.recent || row.failures < 8,
          "Try again in ten minutes.",
          429,
        );
        if (!hrPassword(password)) {
          await db.query(
            "UPDATE hr_login SET failures=$1,since=CASE WHEN $2 THEN since ELSE now() END WHERE account=$3",
            [row.recent ? row.failures + 1 : 1, row.recent, email],
          );
          return null;
        }
        await db.query("UPDATE hr_login SET failures=0 WHERE account=$1", [
          email,
        ]);
        return session(db, null);
      });
      requireThat(token, "Check your sign-in details.", 401);
      await setSession(token, true);
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
    if (["upload", "draft", "submit"].includes(action)) {
      const user = await auth();
      requireThat(
        data.get("invitation") === user.invitation,
        "Your active invitation changed. Reopen the application.",
        409,
      );
      return json(await internAction(user.invitation, action, data));
    }
    if (action === "import-roster") return json(await importRoster(data));
    if (action === "send-queued")
      return json({
        sent: await emailInvitation(uuid(field(data, "id")), true),
      });
    if (action === "invite") return json(await createInvite(data));
    if (["issue", "correct", "notify"].includes(action))
      return json(await review(uuid(field(data, "id")), action, data));
    throw new Problem("Unavailable.", 404);
  } catch (e) {
    return error(e);
  }
}
