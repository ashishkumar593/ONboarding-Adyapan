import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import type { SigningPolicy } from "@shared/model";
import type { Stroke } from "@shared/signature";
import sharp from "sharp";
import { BlendMode, PDFDocument } from "pdf-lib";
import type { HrStamp } from "./hr-stamp";

export const signingPolicies: SigningPolicy[] = [
  {
    title: "Confidentiality, Non-Disclosure & Professional Conduct Agreement",
    file: "confidentiality-47a5ba1f.pdf",
    sha256: "47a5ba1fb4fd62747fbb010fa1840b43f51add1b345f504466ddf5267ae73584",
    introduction: "",
    clauses: [
      "The employee shall maintain strict confidentiality regarding company information including student data, employee records, salary structures, incentives, financial information, business strategies, CRM data, training materials, technology, client/vendor information and any non-public company information.",
      "The employee shall not disclose confidential information to any third party during or after employment except where authorized or required by law.",
      "The employee shall not make false, defamatory or malicious statements about ADYAPAN, its directors, management, employees, customers, products or services in person, online or through social media.",
      "All company property including laptops, IDs, documents, CRM access and data must be returned upon separation.",
      "Any breach may result in disciplinary action including termination. The Company may also seek civil remedies and any other remedies available under applicable law.",
      "This agreement shall be governed by the laws of India.",
    ],
  },
  {
    title: "Addendum – Confidentiality, Non-Solicitation & Liquidated Damages Clause",
    file: "liquidated-damages-32913b97.pdf",
    sha256: "32913b97ef21bb225c81951a7a15a704e024b8901085786621402a9a02cc8584",
    introduction: "Employee Manipulation and Non-Solicitation\n\nIf, after a fair investigation, the Employee is found to have intentionally solicited, manipulated, induced, persuaded or encouraged employees of ADYAPAN to resign, join a competing organization, disclose confidential information, or otherwise act against the legitimate interests of the Company, and such conduct results in demonstrable financial loss to the Company, the following actions may be taken:",
    clauses: [
      "Immediate disciplinary action, including suspension or termination of employment.",
      "The Company may seek recovery of actual losses and damages through the appropriate legal process.",
      "Where the Employee has expressly agreed that such misconduct is likely to cause substantial but difficult-to-quantify losses, the Company may seek to enforce liquidated damages of up to six (6) months' gross salary, provided the amount represents a genuine pre-estimate of likely loss and is enforceable under applicable law.",
      "The Company may seek injunctive or other equitable relief to prevent further harm.",
      "This clause is in addition to, and does not limit, any other rights or remedies available to ADYAPAN under applicable law.",
    ],
  },
];

export async function readPolicyPdf(policy: SigningPolicy) {
  // Next can start from either the project directory or the repository root.
  const bytes = await readFile(path.join(process.cwd(), "policies", policy.file)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return readFile(path.join(process.cwd(), "frontend", "policies", policy.file));
  });
  if (createHash("sha256").update(bytes).digest("hex") !== policy.sha256)
    throw new Error("Policy PDF differs from its signed version.");
  return bytes;
}

export async function signatureImage(name: string, drawing: Stroke[] | null) {
  if (drawing) {
    const lines = drawing.map(stroke => '<polyline points="' + stroke.map(point => point.join(",")).join(" ") + '"/>').join("");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1010" height="310" viewBox="-5 -5 1010 310"><g fill="none" stroke="#152436" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' + lines + '</g></svg>';
    return sharp(Buffer.from(svg)).trim({ threshold: 1 }).png().toBuffer();
  }
  const text = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const resolveFont = createRequire(path.join(process.cwd(), "package.json")).resolve;
  const fontfile = resolveFont("pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf");
  return sharp({ text: { text, rgba: true, font: "Liberation Sans Italic 48", fontfile } }).png().toBuffer();
}

// Label centers and the bottom of the visible marks, in original PDF coordinates.
const signingPositions: Record<string, { employee: number; authority: number; bottom: number }> = {
  "confidentiality-47a5ba1f.pdf": { employee: 80.5, authority: 498, bottom: 99 },
  "liquidated-damages-32913b97.pdf": { employee: 66, authority: 519, bottom: 83 },
};

export async function signPolicyPdf(policy: SigningPolicy, signature: Buffer, hrStamp: HrStamp) {
  const position = signingPositions[policy.file];
  if (!position) throw new Error("Missing signature positions for this agreement.");
  const pdf = await PDFDocument.load(await readPolicyPdf(policy));
  const page = pdf.getPages()[0];
  const autograph = await pdf.embedPng(signature);
  const size = autograph.scaleToFit(120, 36);
  page.drawImage(autograph, { x: position.employee - size.width / 2, y: position.bottom, ...size });
  const seal = await pdf.embedPng(hrStamp.bytes);
  const stampSize = seal.scaleToFit(140, 66);
  const { left, right, bottom } = hrStamp.ink;
  page.drawImage(seal, {
    x: position.authority - (left + right) * stampSize.width / 2,
    y: position.bottom - bottom * stampSize.height,
    ...stampSize, blendMode: BlendMode.Multiply,
  });
  return Buffer.from(await pdf.save());
}
