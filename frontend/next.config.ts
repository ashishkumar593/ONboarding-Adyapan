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
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};
export default config;
