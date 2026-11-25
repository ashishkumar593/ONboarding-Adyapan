import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import nodemailer from "nodemailer";
import { PDFDocument } from "pdf-lib";
import { demo, requireThat, Problem } from "./db";
const directory = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.PRIVATE_DIR || ".local/private",
  );
const s3 = () =>
  new S3Client({
    region: process.env.AWS_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: !!process.env.S3_ENDPOINT,
  });
export async function put(id: string, data: Uint8Array, mime: string) {
  if (process.env.S3_BUCKET) {
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: id,
        Body: data,
        ContentType: mime,
      }),
    );
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
export async function get(id: string): Promise<Buffer> {
  if (process.env.S3_BUCKET) {
    const obj = await s3().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: id }),
    );
    return Buffer.from(await obj.Body!.transformToByteArray());
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
  let mime = "";
  if (data.subarray(0, 5).toString() === "%PDF-") {
    try {
      const doc = await PDFDocument.load(data);
      requireThat(doc.getPageCount() > 0, "Empty PDF.");
      mime = "application/pdf";
    } catch {
      throw new Problem("Choose a readable, unlocked PDF.");
    }
  } else if (
    !pdfOnly &&
    data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  )
    mime = "image/png";
  else if (!pdfOnly && data[0] === 255 && data[1] === 216 && data[2] === 255)
    mime = "image/jpeg";
  requireThat(
    mime,
    pdfOnly ? "Choose a readable, unlocked PDF." : "Choose a PDF, PNG or JPEG.",
  );
  return { data, name: file.name.slice(0, 180), mime };
}
