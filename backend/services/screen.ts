import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { demo, Problem, requireThat } from "./db";

const unavailable = () =>
  new Problem("Document screening is unavailable. Please retry shortly.", 503);
const rejected = () =>
  new Problem("This document did not pass security screening.", 422);

async function scanWithClam(data: Buffer, address: string) {
  const url = new URL(address);
  const secure = url.protocol === "tls:";
  requireThat(
    secure ||
      (url.protocol === "tcp:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)),
    "Configure a private TLS scanner or a loopback scanner.",
    503,
  );
  await new Promise<void>((resolve, reject) => {
    const options = { host: url.hostname, port: Number(url.port || 3310) };
    const socket = secure
      ? tls.connect({ ...options, servername: url.hostname })
      : net.connect(options);
    const finish = (error?: Error) => {
      clearTimeout(deadline);
      socket.destroy();
      error ? reject(error) : resolve();
    };
    const deadline = setTimeout(() => finish(unavailable()), 30000);
    socket.once(secure ? "secureConnect" : "connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < data.length; offset += 65536) {
        const chunk = data.subarray(offset, offset + 65536);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    let reply = "";
    socket.on("error", () => finish(unavailable()));
    socket.on("close", () => {
      clearTimeout(deadline);
      reject(unavailable());
    });
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (reply.length > 2048) return finish(unavailable());
      if (!reply.includes("\0")) return;
      const verdict = reply.split("\0")[0];
      finish(
        verdict === "stream: OK"
          ? undefined
          : verdict.endsWith(" FOUND")
            ? rejected()
            : unavailable(),
      );
    });
  });
}

export async function screenDocument(data: Buffer) {
  if (process.env.CLAMD_URL) return scanWithClam(data, process.env.CLAMD_URL);
  if (!demo() || process.platform !== "win32") throw unavailable();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "adyapan-scan-"));
  const input = path.join(dir, "document");
  try {
    await fs.writeFile(input, data, { mode: 0o600 });
    await promisify(execFile)(
      path.join(
        process.env.ProgramFiles || "C:/Program Files",
        "Windows Defender",
        "MpCmdRun.exe",
      ),
      ["-Scan", "-ScanType", "3", "-File", input, "-DisableRemediation"],
      { timeout: 30000, windowsHide: true },
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code?.toString() === "2") throw rejected();
    throw unavailable();
  } finally {
    await fs.rm(input, { force: true });
    await fs.rmdir(dir);
  }
}

export async function validateDocument(data: Buffer, pdfOnly: boolean) {
  if (data.subarray(0, 5).toString() === "%PDF-") {
    try {
      const doc = await PDFDocument.load(data);
      requireThat(
        doc.getPageCount() > 0 && doc.getPageCount() <= 200,
        "Choose a PDF with 1 to 200 pages.",
      );
      return "application/pdf";
    } catch (e) {
      if (e instanceof Problem) throw e;
      throw new Problem("Choose a readable, unlocked PDF.");
    }
  }
  requireThat(!pdfOnly, "Choose a readable, unlocked PDF.");
  try {
    const image = sharp(data, {
      limitInputPixels: 20_000_000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    requireThat(
      ["jpeg", "png"].includes(metadata.format) && (metadata.pages ?? 1) === 1,
      "Choose a single JPEG or PNG image.",
    );
    await image.stats();
    return metadata.format === "jpeg" ? "image/jpeg" : "image/png";
  } catch {
    throw new Problem(
      "Choose a complete PDF, PNG or JPEG within the image size limit.",
    );
  }
}
