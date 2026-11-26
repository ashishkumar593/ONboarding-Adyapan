import type { NextConfig } from "next";
import path from "node:path";
const repository = path.resolve(__dirname, "..");
const config: NextConfig = {
  turbopack: { root: repository },
  outputFileTracingRoot: repository,
  poweredByHeader: false,
  serverExternalPackages: [
    "pg",
    "nodemailer",
    "@aws-sdk/client-s3",
    "exceljs",
    "pdfjs-dist",
    "yauzl",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};
export default config;
