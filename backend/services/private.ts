import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { screenDocument, ScreeningUnavailable, validateDocument } from "./screen";
import { pool } from "./db";
import type { PoolClient } from "pg";
import { demo, requireThat, Problem } from "./db";
const directory = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.PRIVATE_DIR || ".local/private",
  );
const cloudinaryConfig = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
};
const cloudinarySign = (params: Record<string, string | number>, apiSecret: string) => {
  const payload = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(payload + apiSecret).digest("hex");
};
export async function put(id: string, data: Uint8Array, mime: string) {
  const cld = cloudinaryConfig();
  if (cld) {
    const ts = Math.floor(Date.now() / 1000);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(data)], { type: mime }), id);
    form.append("public_id", id);
    form.append("type", "private");
    form.append("timestamp", String(ts));
    form.append("api_key", cld.apiKey);
    form.append(
      "signature",
      cloudinarySign({ public_id: id, timestamp: ts, type: "private" }, cld.apiSecret),
    );
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cld.cloudName}/raw/upload`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      throw new Problem(`Storage upload failed (${res.status}).`, 502);
    }
    return;
  }
  requireThat(demo(), "Private storage requires configuration.", 503);
  await fs.mkdir(directory(), { recursive: true });
  await fs.writeFile(
    path.join(/* turbopackIgnore: true */ directory(), id),
    data,
    { flag: "wx" },
  );
}
async function readObject(id: string): Promise<Buffer> {
  const cld = cloudinaryConfig();
  if (cld) {
    const ts = Math.floor(Date.now() / 1000);
    const qs = new URLSearchParams({
      public_id: id,
      type: "private",
      timestamp: String(ts),
      api_key: cld.apiKey,
      signature: cloudinarySign({ public_id: id, timestamp: ts, type: "private" }, cld.apiSecret),
    });
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cld.cloudName}/raw/download?${qs}`);
    if (!res.ok) {
      throw new Problem(`Storage read failed (${res.status}).`, res.status === 404 ? 404 : 502);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  requireThat(demo(), "Private storage requires configuration.", 503);
  return fs.readFile(
    /* turbopackIgnore: true */ path.join(
      /* turbopackIgnore: true */ directory(),
      id,
    ),
  );
}
export async function mail(to: string, subject: string, text: string) {
  if (process.env.SMTP_URL) {
    await nodemailer
      .createTransport(process.env.SMTP_URL)
      .sendMail({ from: process.env.MAIL_FROM, to, subject, text });
    return;
  }
  requireThat(demo(), "Email delivery requires configuration.", 503);
  const dir = path.resolve(
    /* turbopackIgnore: true */ process.env.OUTBOX_DIR || ".local/outbox",
  );
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, Date.now() + "-" + crypto.randomUUID() + ".json"),
    JSON.stringify({ to, subject, text }, null, 2),
  );
}
export async function upload(file: FormDataEntryValue | null, pdfOnly = false) {
  requireThat(
    file instanceof File && file.size > 0 && file.size <= 8 * 1024 * 1024,
    "Choose a file up to 8 MB.",
  );
  const data = Buffer.from(await file.arrayBuffer());
  let pending = false;
  try {
    await screenDocument(data);
  } catch (error) {
    if (!(error instanceof ScreeningUnavailable)) throw error;
    pending = true;
  }
  // Only inspect the signature before quarantine. Full parsing follows a clean scan.
  let mime: string;
  if (!pending) mime = await validateDocument(data, pdfOnly);
  else if (data.subarray(0, 5).toString() === "%PDF-") mime = "application/pdf";
  else if (!pdfOnly && data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) mime = "image/png";
  else if (!pdfOnly && data.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) mime = "image/jpeg";
  else throw new Problem(pdfOnly ? "Choose a PDF file." : "Choose a PDF, PNG or JPEG file.");
  return { data, name: file.name.slice(0, 180), mime, pending };
}

export const contentDigest = (data: Uint8Array) => crypto.createHash("sha256").update(data).digest("hex");

export async function get(id: string, db: Pick<PoolClient,"query"> = pool) {
  const file = (await db.query("SELECT clean_digest,mime,slot FROM files WHERE id=$1",[id])).rows[0];
  requireThat(file,"File unavailable.",404);
  const data = await readObject(id);
  const digest = contentDigest(data);
  if (file.clean_digest !== digest) {
    requireThat(!file.clean_digest,"Stored document failed its integrity check.",503);
    await screenDocument(data);
    requireThat(await validateDocument(data,file.mime === "application/pdf") === file.mime,"Stored document format mismatch.",422);
    await db.query("UPDATE files SET clean_digest=$2 WHERE id=$1 AND clean_digest IS NULL",[id,digest]);
  }
  return data;
}
