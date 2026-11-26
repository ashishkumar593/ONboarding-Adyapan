import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { BlendMode, PDFDocument, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb } from "pdf-lib";
import UPNG from "@pdf-lib/upng";
import { Problem, requireThat } from "./db";
import { hasCloudinary, readObject } from "./private";
import type { Invitation } from "@shared/model";
import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";

function stampInkBounds(bytes: Uint8Array) {
  const image = UPNG.decode(Uint8Array.from(bytes).buffer);
  const pixels = new Uint8Array(UPNG.toRGBA8(image)[0]);
  let left = image.width, right = 0, top = image.height, bottom = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const darkness = 255 - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (darkness * pixels[i + 3] / 255 < 64) continue;
    const x = (i / 4) % image.width, y = Math.floor(i / 4 / image.width);
    left = Math.min(left, x);
    right = Math.max(right, x + 1);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y + 1);
  }
  if (!right) return { left: 0, right: 1, bottom: 0, top: 1 };
  return { left: left / image.width, right: right / image.width,
    bottom: 1 - bottom / image.height, top: 1 - top / image.height };
}

async function findHrSignatureSpace(source: Buffer, size: { width: number; height: number }, ink: ReturnType<typeof stampInkBounds>) {
  try {
    const task = getDocument({ data: new Uint8Array(source), useSystemFonts: false });
    try {
      const document = await task.promise;
      const last = await document.getPage(document.numPages);
      const view = last.getViewport({ scale: 1 / last.userUnit });
      const { items } = await last.getTextContent();
      const words = items.flatMap(item => {
        if (!("str" in item) || !item.str.trim()) return [];
        const [, , , , x, top] = Util.transform(view.transform, item.transform);
        const y = view.height - top;
        return [{ text: item.str.trim(), x, y, right: x + item.width, upper: y + item.height }];
      });
      for (const manager of words.filter(word => /^(?:HR|HUMAN RESOURCES)\s+MANAGER\s*:?$/i.test(word.text))) {
        const label = words.find(word => /^SIGNATURE\s*:?$/i.test(word.text)
          && Math.abs(word.x - manager.x) < 30 && word.y >= manager.y && word.y - manager.y < 65);
        if (!label) continue;
        const x = (label.x + label.right - (ink.left + ink.right) * size.width) / 2;
        // The uppercase glyphs occupy the cap height above the PDF text baseline.
        const capTop = label.y + 0.67 * (label.upper - label.y);
        const y = capTop - ink.bottom * size.height;
        const left = x + ink.left * size.width, right = x + ink.right * size.width;
        const top = y + ink.top * size.height;
        const fits = left >= 0 && right <= view.width && capTop >= 0 && top <= view.height;
        const overlaps = words.some(word => word !== label && word.x < right && word.right > left
          && word.y < top && word.upper > capTop);
        if (fits && !overlaps) return { x, y };
      }
    } finally {
      await task.destroy().catch(() => {});
    }
  } catch (e) {
    console.warn("HR signature block lookup failed; using footer stamp:", e instanceof Error ? e.message : e);
  }
}
// Fingerprint of the retired, unfilled demo PDF. An uploaded filename is not evidence of its contents.
export function requireSignedOffer(bytes: Uint8Array) {
  requireThat(
    createHash("sha256").update(bytes).digest("hex") !== "cef8022e05d3571f4014c0f945a374a0b5ad81248d16e68935f7ff6c33775ef6",
    "The blank sample offer cannot be issued. Upload the intern's signed offer letter.",
  );
}

export async function countersign(source: Buffer, inv: Invitation) {
  requireSignedOffer(source);
  if (process.env.SIGNING_URL) {
    const url = new URL(process.env.SIGNING_URL);
    requireThat(
      url.protocol === "https:" && process.env.SIGNING_TOKEN,
      "Configure the authorized signing service.",
      503,
    );
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + process.env.SIGNING_TOKEN!,
        "Content-Type": "application/pdf",
        "Idempotency-Key":
          inv.id + ":" + inv.files.find((f) => f.slot === "signed")!.id,
        "X-Offer-Reference": inv.reference!,
      },
      body: new Uint8Array(source),
      signal: AbortSignal.timeout(40000),
    });
    requireThat(
      response.ok,
      "The signing service could not issue the letter. Retry this submission.",
      502,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    requireThat(
      pdf.getPageCount() > 0,
      "Signing service returned an empty PDF.",
      502,
    );
    return bytes;
  }
  const encodedStamp = process.env.HR_STAMP_BASE64?.trim();
  const stampPath = process.env.HR_STAMP_PATH;
  const useCloudinaryStamp = !encodedStamp && !stampPath && hasCloudinary();
  requireThat(encodedStamp || stampPath || useCloudinaryStamp, "Configure HR_STAMP_BASE64 with the approved HR stamp PNG, or configure the signing service.", 503);
  const pdf = await PDFDocument.load(source);
  const stampBytes = encodedStamp
    ? Promise.resolve(Buffer.from(encodedStamp, "base64"))
    : stampPath
      ? readFile(/* turbopackIgnore: true */ stampPath)
      : readObject(process.env.HR_STAMP_CLOUDINARY_ID || "hr-manager-stamp");
  const { stamp, ink } = await stampBytes
    .then(async bytes => ({ stamp: await pdf.embedPng(bytes), ink: stampInkBounds(bytes) }))
    .catch(() => { throw new Problem("The HR manager stamp could not be loaded. Check the configured PNG and retry.", 503); });

  const page = pdf.getPages().at(-1);
  requireThat(page, "The submitted offer has no pages.");
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  const angle = (page.getRotation().angle % 360 + 360) % 360;
  const horizontal = angle === 0 || angle === 180;
  const width = horizontal ? crop.width : crop.height;
  const inset = Math.min(12, width / 10);
  const size = stamp.scaleToFit(Math.min(175, width - 2 * inset), 85);
  const footer = size.height + 2 * inset;

  const cos = Math.round(Math.cos(angle * Math.PI / 180));
  const sin = Math.round(Math.sin(angle * Math.PI / 180));
  const left = crop.x + (angle === 90 || angle === 180 ? crop.width : 0);
  const bottom = crop.y + (angle === 180 || angle === 270 ? crop.height : 0);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos, left, bottom));
  const signature = await findHrSignatureSpace(source, size, ink);
  if (signature) {
    page.drawImage(stamp, { ...signature, ...size, blendMode: BlendMode.Multiply });
    page.pushOperators(popGraphicsState());
    return pdf.save();
  }

  // Layouts without a clear HR signature block retain the separate footer.
  const x = crop.x - (angle === 270 ? footer : 0);
  const y = crop.y - (angle === 0 ? footer : 0);
  const w = crop.width + (horizontal ? 0 : footer);
  const h = crop.height + (horizontal ? footer : 0);
  const mx = Math.min(media.x, x), my = Math.min(media.y, y);
  page.setMediaBox(mx, my, Math.max(media.x + media.width, x + w) - mx,
    Math.max(media.y + media.height, y + h) - my);
  page.setCropBox(x, y, w, h);

  page.drawRectangle({ x: 0, y: -footer, width, height: footer, color: rgb(1, 1, 1) });
  page.drawImage(stamp, { x: width - inset - size.width, y: -footer + inset, ...size });
  page.pushOperators(popGraphicsState());
  return pdf.save();
}
