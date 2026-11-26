import { createHash } from "node:crypto";
import { BlendMode, PDFDocument, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb } from "pdf-lib";
import { Problem, requireThat } from "./db";
import { loadHrStamp, type HrStamp } from "./hr-stamp";
import type { Invitation } from "@shared/model";
import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";

async function findHrSignatureSpace(source: Buffer, size: { width: number; height: number }, ink: HrStamp["ink"]) {
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
    console.error("HR signature block lookup failed:", e instanceof Error ? e.name : "unknown error");
    throw new Problem("The signing service could not read the signature area. The offer is still awaiting issuance.", 503);
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
  const pdf = await PDFDocument.load(source);
  const { bytes, ink } = await loadHrStamp();
  const stamp = await pdf.embedPng(bytes);

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
