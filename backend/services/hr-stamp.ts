import { readFile } from "node:fs/promises";
import UPNG from "@pdf-lib/upng";
import { Problem, requireThat } from "./db";
import { hasCloudinary, readObject } from "./private";

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

export async function loadHrStamp() {
  const encodedStamp = process.env.HR_STAMP_BASE64?.trim();
  const stampPath = process.env.HR_STAMP_PATH;
  const useCloudinaryStamp = !encodedStamp && !stampPath && hasCloudinary();
  requireThat(encodedStamp || stampPath || useCloudinaryStamp, "Configure the approved HR manager stamp PNG before signing.", 503);
  const stampBytes = encodedStamp
    ? Promise.resolve(Buffer.from(encodedStamp, "base64"))
    : stampPath
      ? readFile(/* turbopackIgnore: true */ stampPath)
      : readObject(process.env.HR_STAMP_CLOUDINARY_ID || "hr-manager-stamp");
  return stampBytes
    .then(bytes => ({ bytes, ink: stampInkBounds(bytes) }))
    .catch(() => { throw new Problem("The HR manager stamp could not be loaded. Check the configured PNG and retry.", 503); });
}

export type HrStamp = Awaited<ReturnType<typeof loadHrStamp>>;
