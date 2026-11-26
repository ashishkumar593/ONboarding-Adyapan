const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");

test("the production signing route ships the PDF reader and its runtime worker together", async () => {
  const route = path.resolve("frontend/.next/server/app/api/[action]");
  const trace = JSON.parse(await fs.readFile(path.join(route, "route.js.nft.json"), "utf8"));
  const files = trace.files.map(file => path.resolve(route, file));
  for (const name of ["pdf.mjs", "pdf.worker.mjs"]) {
    expect(files).toContain(require.resolve("pdfjs-dist/legacy/build/" + name));
  }
});
