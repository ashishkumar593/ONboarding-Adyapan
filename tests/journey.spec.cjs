const { test, expect, devices } = require("@playwright/test");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { Client } = require("pg");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");
const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, StandardFonts } = require("pdf-lib");
const origin = "http://127.0.0.1:3019";
const email = "aarya@example.test",
  hrEmail = "hr@example.test";
const accessKey = crypto.randomBytes(32).toString("hex");
const password = crypto.randomBytes(24).toString("hex");
const schema = "test_" + crypto.randomBytes(12).toString("hex");
let dir, db, server, sample, scanner;
let scanReply = "stream: OK";
async function messages() {
  const outbox = path.join(dir, "mail");
  await fs.mkdir(outbox,{recursive:true});
  const files = await fs.readdir(outbox);
  return Promise.all(
    files
      .sort()
      .reverse()
      .map(async (file) =>
        JSON.parse(await fs.readFile(path.join(outbox, file), "utf8")),
      ),
  );
}
test.beforeAll(async () => {
  process.loadEnvFile(".env.local");
  if (process.env.PORTAL_MODE !== "local")
    throw Error("Tests require the isolated local database.");
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== "127.0.0.1" || url.username !== "portal")
    throw Error("Expected local setup.");
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query("CREATE SCHEMA " + schema);
  await db.query("SET search_path TO " + schema);
  await db.query(await fs.readFile("backend/database/schema.sql", "utf8"));
  url.searchParams.set("options", "-c search_path=" + schema);
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "adyapan-test-"));
  const salt = crypto.randomBytes(16).toString("hex");
  await db.query("INSERT INTO hr_staff(email,password_hash,access_key_hash,permissions) VALUES($1,$2,$3,$4)",
    [hrEmail,salt+":"+crypto.scryptSync(password,salt,32).toString("hex"),crypto.createHash("sha256").update(accessKey).digest("hex"),["invite","review","issue","export"]]);
  scanner=require("node:net").createServer(socket=>{
    let packet=Buffer.alloc(0);
    socket.on("error",()=>{});
    socket.on("data",chunk=>{
      packet=Buffer.concat([packet,chunk]);
      if (packet.length < 14) return;
      let pos=10;
      while (pos+4 <= packet.length) {
        const size=packet.readUInt32BE(pos); pos+=4;
        if (!size) {socket.end(scanReply+"\0"); return;}
        pos+=size;
      }
    });
  });
  await new Promise(resolve=>scanner.listen(0,"127.0.0.1",resolve));
  server = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "start",
      "frontend",
      "-H",
      "127.0.0.1",
      "-p",
      "3019",
    ],
    {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PORTAL_MODE: "local",
        APP_ORIGIN: origin,
        DATABASE_URL: url.toString(),
        CLAMD_URL: "tcp://127.0.0.1:"+scanner.address().port,
        HR_EMAIL: hrEmail,
        HR_PASSWORD_HASH:
          salt + ":" + crypto.scryptSync(password, salt, 32).toString("hex"),
        PRIVATE_DIR: path.join(dir, "files"),
        OUTBOX_DIR: path.join(dir, "mail"),
        S3_BUCKET: "",
        SMTP_URL: "",
        SIGNING_URL: "",
        HR_STAMP_PATH: path.join(dir, "test-stamp.png"),
      },
    },
  );
  await expect
    .poll(async () => {
      if (server.exitCode !== null) throw Error("Test server failed to start");
      try {
        return (await fetch(origin)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
  const doc = await PDFDocument.create();
  const offerPage = doc.addPage();
  offerPage.drawText("Sample intern-signed offer", { x: 72, y: 560 });
  offerPage.drawText("SIGNATURE:", { x: 72, y: 178, size: 12 });
  offerPage.drawText("HR MANAGER", { x: 72, y: 151, size: 12 });
  sample = {
    name: "test-offer.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  };
});
test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const ended = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await ended;
  }
  if (scanner) await new Promise(resolve=>scanner.close(resolve));
  if (db) {
    await db.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    await db.end();
  }
  if (
    dir &&
    path.dirname(dir) === os.tmpdir() &&
    path.basename(dir).startsWith("adyapan-test-")
  )
    await fs.rm(dir, { force: true, recursive: true });
});
function personalLink(message) {
  return message.text
    .split("\n")
    .find((line) => line.startsWith(origin + "/apply?invite="));
}
async function openFromInbox(page, subject, heading = "Your application") {
  const envelope = (await messages()).find(
    (m) => m.to === email && m.subject === subject,
  );
  expect(envelope).toBeTruthy();
  const link = personalLink(envelope);
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "Resume onboarding" }),
  ).toBeVisible();
  expect((await page.request.get("/api/application")).status()).toBe(401);
  await page.getByRole("button", { name: "Open my application" }).click();
  await expect(
    page.getByRole("heading", { name: heading }),
  ).toBeVisible();
  return link;
}
test("HR invitation, phone onboarding, correction and idempotent PDF issuance", async ({
  browser,
  page: hr,
}) => {
  await hr.goto("/hr");
  await hr.getByLabel("Work email").fill(hrEmail);
  await hr.getByLabel("Access key",{exact:true}).fill(accessKey);
  await hr
    .getByLabel("Password", { exact: true })
    .fill("incorrect-test-password");
  await hr.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    hr.getByText("Check your sign-in details.", { exact: true }),
  ).toBeVisible();
  expect((await hr.request.get("/api/list")).status()).toBe(401);
  await hr.getByLabel("Password", { exact: true }).fill(password);
  await expect(hr.getByLabel("Authenticator code")).toHaveCount(0);
  await hr.getByRole("button", { name: "Sign in", exact: true }).click();
  await hr.getByRole("button", { name: "Add intern" }).click();
  await hr.getByLabel("Intern name").fill("Aarya Test");
  await hr.getByLabel("Registered email").fill(email);
  await hr.getByLabel("Internship role").fill("Product Design Intern");
  await hr.getByLabel("Start date").fill("2027-01-01");
  await hr.getByLabel("End date").fill("2027-03-31");
  await expect(hr.locator('input[type="file"]')).toHaveCount(0);
  await expect(hr.getByText("PAN card", { exact: true })).toBeVisible();
  await hr.getByRole("button", { name: "Add intern" }).click();
  await expect(
    hr.getByRole("heading", { name: "Shared onboarding link" }),
  ).toBeVisible();
  const qrUrl = await hr
    .getByAltText("Shared onboarding QR code")
    .getAttribute("src");
  const png = PNG.sync.read(await (await hr.request.get(qrUrl)).body());
  const link = jsQR(
    new Uint8ClampedArray(png.data),
    png.width,
    png.height,
  ).data;
  expect(link).toBe(await hr.locator(".invite-url").getAttribute("href"));
  expect(link).toBe(origin + "/apply");
  const inviteId = (await (await hr.request.get("/api/list")).json()).find(r=>r.email===email).id;
  const createSecond = await hr.request.post(origin + "/api/add-intern", {
    headers: { Origin: origin },
    multipart: {
      name: "Second intern",
      email: "second@example.test",
      role: "Designer",
      starts: "2027-01-01",
      ends: "2027-02-01",
    },
  });
  expect(createSecond.ok()).toBeTruthy();
  const other = await createSecond.json();
  const foreign = crypto.randomUUID();
  await fs.mkdir(path.join(dir, "files"), { recursive: true });
  await fs.writeFile(path.join(dir, "files", foreign), sample.buffer);
  await db.query(
    "INSERT INTO files(id,invitation,slot,name,mime,bytes) VALUES($1,$2,'resume',$3,$4,$5)",
    [foreign, other.id, sample.name, sample.mimeType, sample.buffer.length],
  );
  const first = await browser.newContext({
      ...devices["Pixel 7"],
      baseURL: origin,
    }),
    phone = await first.newPage();
  await phone.goto(link);
  await phone.getByLabel("Registered email address").fill(email);
  await phone.getByRole("button",{name:"Continue",exact:true}).click();
  await expect(phone.getByRole("heading",{name:"Your application"})).toBeVisible();
  expect((await phone.request.get("/api/file?id=" + foreign)).status()).toBe(
    404,
  );
  expect((await phone.request.get("/api/list")).status()).toBe(401);
  await phone.getByLabel("Phone number").fill("+91 9876543210");
  await expect(phone.getByLabel("Email address")).toHaveValue(email);
  await expect(phone.getByLabel("Email address")).not.toBeEditable();
  await phone.getByLabel("Full name").fill("Aarya Test");
  await phone.getByLabel("Employee ID").fill("ADY-IN-007");
  await phone.getByLabel("College name").fill("Sample University");
  await expect(
    phone.getByRole("button", { name: "Save and continue" }),
  ).toBeDisabled();
  await phone
    .getByLabel("Upload Résumé")
    .setInputFiles({ ...sample, name: "resume.pdf" });
  await phone.getByRole("button", { name: "Save and continue" }).click();
  await expect(
    phone.getByRole("heading", { name: "Your documents" }),
  ).toBeVisible();
  await first.close();
  const second = await browser.newContext({
      ...devices["iPhone 13"],
      baseURL: origin,
    }),
    intern = await second.newPage();
  await intern.goto(link);
  const numberOfMessages = (await messages()).length;
  for (const address of ["uninvited@example.test", "absent@example.test"]) {
    await intern.getByLabel("Registered email address").fill(address);
    await intern
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(
      intern.getByRole("alert").filter({ hasText: "Check the email address" }),
    ).toBeVisible();
    expect((await messages()).length).toBe(numberOfMessages);
    expect((await intern.request.get("/api/application")).status()).toBe(401);
  }
  await intern.getByLabel("Registered email address").fill(email.toUpperCase());
  await intern.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(intern.getByText("Check your invited inbox for a fresh personal link.")).toBeVisible();
  expect((await intern.request.get("/api/application")).status()).toBe(401);
  await openFromInbox(intern,"Your personal onboarding link","Your documents");
  await expect(intern.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await expect(
    intern.getByRole("button", { name: "Continue to terms" }),
  ).toBeDisabled();
  for (const label of [
    "10th marksheet",
    "Intermediate marksheet",
    "Degree or last-semester marksheet",
    "Aadhaar card",
    "PAN card",
    "Signed offer letter",
  ]) {
    await intern
      .getByLabel("Upload " + label, { exact: true })
      .setInputFiles({ ...sample, name: label + ".pdf" });
    await expect(
      intern.getByRole("link", { name: label + ".pdf", exact: true }),
    ).toBeVisible();
  }
  await intern.getByRole("button", { name: "Continue to terms" }).click();
  await intern.getByText("Review your details and uploads").click();
  await expect(intern.getByText("ADY-IN-007")).toBeVisible();
  const displayedTerms = (await intern.locator(".onboarding-terms").innerText()).replace(/\s+/g, " ").trim();
  expect(displayedTerms).toBe(process.env.TERMS_TEXT?.replace(/\s+/g, " ").trim() || "I confirm that my details and uploaded documents are accurate. I agree that Adyapan may review these records for my internship onboarding.");
  const acknowledgement = intern.getByRole("checkbox", { name: "I agree to the terms and conditions.", exact: true });
  await expect(acknowledgement).not.toBeChecked();
  async function sign(typed = false) {
    await acknowledgement.check();
    if (typed) {
      await intern.getByLabel("Type signature", { exact: true }).check();
      await intern.getByLabel("Signature · full name").fill("Aarya Test");
    } else {
      await intern.getByRole("button", { name: "Sign and submit" }).click();
      await expect(
        intern.getByText("Draw your signature or choose Type signature."),
      ).toBeVisible();
      const pad = intern.getByRole("img", { name: "Signature drawing area" });
      await pad.scrollIntoViewIfNeeded();
      const box = await pad.boundingBox();
      await intern.mouse.move(box.x + 15, box.y + 30);
      await intern.mouse.down();
      await intern.mouse.move(box.x + 75, box.y + 50, { steps: 5 });
      await intern.mouse.up();
    }
    await intern.getByRole("button", { name: "Sign and submit" }).click();
    await expect(
      intern.getByRole("heading", { name: "Welcome to Adyapan, Aarya." }),
    ).toBeVisible();
  }
  await sign();
  const firstSubmission = (
    await db.query("SELECT snapshot FROM submissions WHERE invitation=$1", [
      inviteId,
    ])
  ).rows[0].snapshot;
  expect(firstSubmission.draft.employeeId).toBe("ADY-IN-007");
  expect(firstSubmission.files).toHaveLength(7);
  expect(firstSubmission.signatureMode).toBe("draw");
  expect(firstSubmission.terms.replace(/\s+/g, " ").trim()).toBe(displayedTerms);
  expect(firstSubmission.version).toBe(process.env.TERMS_VERSION || "development-1");
  expect(firstSubmission.acknowledgement).toBe("I agree to the terms and conditions.");
  expect(firstSubmission.drawing[0].length).toBeGreaterThan(1);
  const receipt = await (await intern.request.get("/api/application")).json();
  expect(receipt.reference).toMatch(/^ADY-/);
  await hr.reload();
  await hr.getByRole("button",{name:/Documents received/}).click();
  const [bundleDownload] = await Promise.all([
    hr.waitForEvent("download", { timeout: 8000 }),
    hr.getByRole("button", { name: "Export Excel + documents" }).click(),
  ]);
  expect(bundleDownload.suggestedFilename()).toBe("adyapan-documents-received.zip");
  expect(await bundleDownload.failure()).toBeNull();
  const bundle = await require("jszip").loadAsync(await fs.readFile(await bundleDownload.path()));
  const receivedBook = new (require("exceljs").Workbook)();
  await receivedBook.xlsx.load(await bundle.file("Documents received.xlsx").async("nodebuffer"));
  expect(receivedBook.worksheets[0].getColumn(8).values).toContain(
    receipt.reference,
  );
  expect(receivedBook.worksheets[0].getCell("K2").value).toBe("Sample University");
  const documentRows = receivedBook.getWorksheet("Uploaded documents").getRows(2, 7);
  for (const row of documentRows) {
    const entry = bundle.file(row.getCell(4).value.hyperlink);
    expect((await entry.async("nodebuffer")).equals(sample.buffer)).toBe(true);
  }
  const declaration = receivedBook.getWorksheet("Signed declarations").getRow(2);
  expect(await bundle.file(declaration.getCell(10).value.hyperlink).async("string")).toContain("<polyline");
  expect(JSON.parse(await bundle.file(declaration.getCell(11).value.hyperlink).async("string"))).toEqual(firstSubmission);

  const again = await intern.request.post("/api/submit", {
    headers: { Origin: origin },
    multipart: { invitation: inviteId },
  });
  expect((await again.json()).reference).toBe(receipt.reference);
  await hr.getByRole("button", { name: /Aarya Test/ }).click();
  await expect(hr.locator(".qr-card")).toHaveCount(0);
  await hr.getByRole("combobox").selectOption({ label: "Aadhaar card" });
  await hr
    .getByLabel("What needs to change?")
    .fill("Please include the back page.");
  await hr.getByRole("button", { name: "Request correction" }).click();
  await expect(
    hr.getByText("Correction requested.", { exact: true }),
  ).toBeVisible();
  await intern.reload();
  await expect(intern.getByText("Please include the back page.")).toBeVisible();
  await intern
    .getByLabel("Upload Aadhaar card")
    .setInputFiles({ ...sample, name: "identity-complete.pdf" });
  await intern.getByRole("button", { name: "Continue to terms" }).click();
  await sign(true);
  await hr.getByRole("button", { name: "Back to documents received" }).click();
  await hr.getByRole("button", { name: /Aarya Test/ }).click();
  const accepted = await (
      await hr.request.get("/api/record?id=" + inviteId)
    ).json(),
    signed = accepted.files.find((f) => f.slot === "signed");
  // Simulate an unavailable source object and restore it for a genuine retry.
  const object = path.join(dir, "files", signed.id);
  await fs.rename(object, object + ".offline");
  await hr
    .getByLabel("I reviewed the submitted offer", { exact: false })
    .check();
  await hr.getByRole("button", { name: "Countersign and issue" }).click();
  await expect(
    hr.getByRole("alert").filter({ hasText: "server could not finish" }),
  ).toBeVisible();
  expect(
    (await (await hr.request.get("/api/record?id=" + inviteId)).json()).status,
  ).toBe("submitted");
  await fs.rename(object + ".offline", object);
  await hr.getByRole("button", { name: "Countersign and issue" }).click();
  await expect(hr.getByRole("alert").filter({ hasText: "stamp could not be loaded" })).toBeVisible();
  const stamp = new PNG({ width: 37, height: 19 });
  stamp.data.fill(255);
  for (let row = 2; row < 16; row++) {
    for (let col = 4; col < 33; col++) {
      const pixel = 4 * (row * stamp.width + col);
      stamp.data.fill(0, pixel, pixel + 3);
    }
  }
  await fs.writeFile(path.join(dir, "test-stamp.png"), PNG.sync.write(stamp));
  await hr.getByRole("button", { name: "Countersign and issue" }).click();
  await expect(
    hr.getByRole("link", { name: "Download stamped offer letter" }),
  ).toBeVisible();
  await intern.getByRole("button", { name: "Refresh status" }).click();
  const download = intern.getByRole("link", {
    name: "Download signed offer letter",
  });
  await expect(download).toBeVisible();
  const issuedRecord = await (await intern.request.get("/api/application")).json();
  const href = "/api/file?id=" + issuedRecord.issued_file + "&download=1";
  const [savedOffer] = await Promise.all([
    intern.waitForEvent("download", { timeout: 10000 }),
    download.click(),
  ]);
  expect(savedOffer.suggestedFilename()).toBe(receipt.reference + "-signed-offer.pdf");
  expect(await savedOffer.failure()).toBeNull();
  const bytes = await fs.readFile(await savedOffer.path());
  const logout = await hr.request.post("/api/logout", {
    headers: { Origin: origin }, multipart: { hr: "1" },
  });
  expect(logout.ok()).toBeTruthy();
  await hr.bringToFront();
  await hr.goto("/hr");
  await hr.getByLabel("Work email").fill(hrEmail);
  await hr.getByLabel("Access key",{exact:true}).fill(accessKey);
  await hr.getByLabel("Password", { exact: true }).fill(password);
  await hr.getByRole("button", { name: "Sign in", exact: true }).click();
  await hr.getByRole("button", { name: /Documents received/ }).click();
  await hr.getByRole("button", { name: /Aarya Test/ }).click();
  const stamped = hr.getByRole("region", { name: "Stamped offer letter" });
  const preview = stamped.getByTitle("Stamped offer letter preview");
  await expect(preview).toBeVisible();
  const hrDownload = stamped.getByRole("link", { name: "Download stamped offer letter" });
  await expect(hrDownload).toHaveAttribute("href", await preview.getAttribute("src"));
  const [hrCopy] = await Promise.all([hr.waitForEvent("download"), hrDownload.click()]);
  expect(await fs.readFile(await hrCopy.path())).toEqual(bytes);
  const issued = await PDFDocument.load(bytes);
  expect(issued.getPageCount()).toBe(1);
  expect(issued.getPage(0).getCropBox()).toEqual((await PDFDocument.load(sample.buffer)).getPage(0).getCropBox());
  const images = issued.getPage(0).node.Resources().lookup(PDFName.of("XObject"));
  expect(images.keys()).toHaveLength(1);
  const embedded = images.lookup(images.keys()[0], PDFRawStream);
  expect(embedded.dict.get(PDFName.of("Subtype")).toString()).toBe("/Image");
  expect(embedded.dict.get(PDFName.of("Width")).asNumber()).toBe(37);
  expect(embedded.dict.get(PDFName.of("Height")).asNumber()).toBe(19);
  const drawing = issued.getPage(0).node.Contents().asArray().at(-1);
  const operators = Buffer.from(decodePDFRawStream(issued.context.lookup(drawing)).decode()).toString();
  const placement = operators.match(/gs\s+1 0 0 1 ([\d.-]+) ([\d.-]+) cm\s+1 0 0 1 0 0 cm\s+([\d.-]+) 0 0 ([\d.-]+) 0 0 cm/);
  expect(placement).toBeTruthy();
  const [x, y, width, height] = placement.slice(1).map(Number);
  const labelFont = await issued.embedFont(StandardFonts.Helvetica);
  const labelCenter = 72 + labelFont.widthOfTextAtSize("SIGNATURE:", 12) / 2;
  expect(Math.abs(x + width / 2 - labelCenter)).toBeLessThan(1);
  expect(y + height * 3 / stamp.height).toBeCloseTo(178 + 8, 0);
  expect(await fs.readFile(object)).toEqual(sample.buffer);
  await hr.request.post("/api/issue", {
    headers: { Origin: origin },
    multipart: { id: inviteId, approved: "yes", reviewed: signed.id },
  });
  expect(
    Buffer.compare(bytes, await (await intern.request.get(href)).body()),
  ).toBe(0);
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM submissions WHERE invitation=$1",
        [inviteId],
      )
    ).rows[0].n,
  ).toBe(2);
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM files WHERE invitation=$1 AND slot='issued'",
        [inviteId],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (await messages()).filter(
      (m) => m.to === email && m.subject.includes("letter is ready"),
    ),
  ).toHaveLength(1);
  await second.close();
});
test("welcome fits phone and desktop, and help and stage details open", async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    const preparation = page.getByRole("checkbox", {
      name: "Access to your registered email",
    });
    await preparation.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("status")).toHaveText("1 of 3 ready");
    await page.reload();
    await expect(preparation).toBeChecked();
    await preparation.uncheck();
    await page.getByRole("button", { name: "Help" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close help" }).click();
    await page.locator("summary").first().click();
    await expect(
      page.locator("details[open]").getByText("Open the shared onboarding link", { exact: false }),
    ).toBeVisible();
  }
});
test("Excel import enables multiple registered interns through one shared link", async ({
  page,
}) => {
  const Excel = require("exceljs");
  await fs.mkdir(path.join(dir, "mail"), { recursive: true });
  const before = (await messages()).length;
  const people = ["Blue Oak", "Green Oak", "Gold Oak"].map((name, i) => ({
    name,
    email: "queue" + i + "@example.test",
  }));
  expect(
    (await page.request.get("/api/roster-xlsx?group=pending")).status(),
  ).toBe(401);
  await page.goto("/hr");
  await page.getByLabel("Work email").fill(hrEmail);
  await page.getByLabel("Access key",{exact:true}).fill(accessKey);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  const template = await page.request.get(
    await page
      .getByRole("link", { name: "Download Excel template" })
      .getAttribute("href"),
  );
  const wb = new Excel.Workbook();
  await wb.xlsx.load(await template.body());
  const sheet = wb.worksheets[0];
  expect(sheet.getRow(1).values.slice(1)).toEqual([
    "Name",
    "Email",
    "Role",
    "Start date",
    "End date",
  ]);
  for (const person of people)
    sheet.addRow([
      person.name,
      person.email,
      "Design intern",
      new Date("2027-02-01T00:00:00Z"),
      "2027-03-31",
    ]);
  const asFile = async () => ({
    name: "interns.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  const invalid = sheet.addRow([
    "Incomplete",
    "",
    "Role",
    "2027-02-01",
    "2027-03-31",
  ]);
  await page.getByLabel("Import Excel workbook").setInputFiles(await asFile());
  await expect(
    page.getByRole("alert").filter({ hasText: "Row 5" }),
  ).toBeVisible();
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM invitations WHERE email=ANY($1)",
        [people.map((p) => p.email)],
      )
    ).rows[0].n,
  ).toBe(0);
  sheet.spliceRows(invalid.number, 1);
  const valid = await asFile();
  await page.getByLabel("Import Excel workbook").setInputFiles(valid);
  await expect(
    page.getByText("3 added to the roster. 0 duplicates skipped."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  await page.getByLabel("Import Excel workbook").setInputFiles(valid);
  await expect(
    page.getByText("0 added to the roster. 3 duplicates skipped."),
  ).toBeVisible();
  expect((await messages()).length).toBe(before);
  const records = (await (await page.request.get("/api/list")).json()).filter(
    (r) => people.some((p) => p.email === r.email),
  );
  const pendingFile = await page.request.get(
    await page.getByRole("link", { name: "Export Excel" }).getAttribute("href"),
  );
  const pendingBook = new Excel.Workbook();
  await pendingBook.xlsx.load(await pendingFile.body());
  expect(pendingBook.worksheets[0].getColumn(2).values).toContain(
    people[2].email,
  );
  const sharedLink=await page.getByRole("link",{name:origin+"/apply"}).getAttribute("href");
  for(const person of people){
    const browser=await page.context().browser().newContext({baseURL:origin});
    const intern=await browser.newPage(); await intern.goto(sharedLink);
    await intern.getByLabel("Registered email address").fill(person.email.toUpperCase());
    await intern.getByRole("button",{name:"Continue",exact:true}).click();
    await expect(intern.getByLabel("Email address")).toHaveValue(person.email);
    await browser.close();
  }
  expect((await messages()).length).toBe(before);
  for (const p of people)
    await expect(
      page.getByRole("button", { name: p.name, exact: true }),
    ).toBeVisible();
  await page.getByRole("button", { name: /Documents received/ }).click();
  await expect(
    page.getByRole("button", { name: people[0].name, exact: true }),
  ).toHaveCount(0);
});

test("HR pages through invitation and received records", async ({ page }) => {
  const rows = ["queued", "submitted"].flatMap(status =>
    Array.from({ length: 12 }, (_, index) => ({
      id: crypto.randomUUID(), name: status + " intern " + (index + 1),
      email: status + index + "@example.test", role: "Design intern",
      starts: "2027-02-01", ends: "2027-03-31", status,
      reference: status === "submitted" ? "ADY-" + index : null,
    })),
  );
  await page.goto("/hr");
  await page.getByLabel("Work email").fill(hrEmail);
  await page.getByLabel("Access key",{exact:true}).fill(accessKey);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.route("**/api/list", route => route.fulfill({ json: rows }));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveTitle("Adyapan | Onboarding Portal");
  const tableRows = page.locator("tbody tr");
  const next = page.getByRole("button", { name: "Next", exact: true });
  await expect(tableRows).toHaveCount(10);
  await next.click();
  await expect(tableRows).toHaveCount(2);
  await page.getByRole("button", { name: /Documents received/ }).click();
  await expect(tableRows).toHaveCount(10);
  await page.getByLabel("Rows per page").selectOption("5");
  await next.click();
  await next.click();
  await expect(tableRows).toHaveCount(2);
  await expect(next).toBeDisabled();
  await page.getByLabel("Search submissions").fill("submitted intern 3");
  await expect(tableRows).toHaveCount(1);
  await expect(tableRows).toContainText("submitted intern 3");
  await expect(page.getByText("Page 1 of 1", { exact: true })).toBeVisible();
});
test("named HR credentials, assignments, freshness and intern revocation", async ({playwright})=>{
  const hr=await playwright.request.newContext({baseURL:origin});
  const reviewer=await playwright.request.newContext({baseURL:origin});
  const intern=await playwright.request.newContext({baseURL:origin});
  const post=(client,action,fields)=>client.post("/api/"+action,{headers:{Origin:origin},multipart:fields});
  const reviewerEmail="reviewer@example.test";
  await db.query("INSERT INTO hr_staff(email,password_hash,access_key_hash,permissions) SELECT $1,password_hash,access_key_hash,ARRAY['review'] FROM hr_staff WHERE email=$2",[reviewerEmail,hrEmail]);
  try {
    expect((await post(hr,"hr-login",{email:hrEmail,password})).ok()).toBeFalsy();
    expect((await post(hr,"hr-login",{email:hrEmail,password,accessKey:"wrong-key"})).status()).toBe(401);
    expect((await post(hr,"hr-login",{email:hrEmail,password,accessKey})).ok()).toBeTruthy();
    expect((await post(reviewer,"hr-login",{email:reviewerEmail,password,accessKey})).ok()).toBeTruthy();
    const invitation=await (await post(hr,"add-intern",{name:"Security Test",email:"scope@example.test",role:"Intern",starts:"2027-02-01",ends:"2027-03-01"})).json();
    const {id}=invitation;
    expect(id).toBeTruthy();
    expect((await reviewer.get("/api/record?id="+id)).status()).toBe(404);
    expect((await reviewer.get("/api/received-export")).status()).toBe(403);
    expect((await post(intern,"roster-login",{email:"scope@example.test"})).ok()).toBeTruthy();
    scanReply="stream: screening-test FOUND";
    expect((await post(intern,"upload",{invitation:id,slot:"resume",file:sample})).status()).toBe(422);
    scanReply="stream: scanner unavailable ERROR";
    expect((await post(intern,"upload",{invitation:id,slot:"resume",file:sample})).status()).toBe(503);
    expect((await db.query("SELECT count(*)::int AS n FROM files WHERE invitation=$1",[id])).rows[0].n).toBe(0);
    scanReply="stream: OK";
    expect((await post(intern,"upload",{invitation:id,slot:"resume",file:sample})).ok()).toBeTruthy();
    const file=(await db.query("SELECT id FROM files WHERE invitation=$1",[id])).rows[0].id;
    expect((await reviewer.get("/api/file?hr=1&id="+file)).status()).toBe(404);
    await db.query("INSERT INTO hr_assignments(staff,invitation) VALUES($1,$2)",[reviewerEmail,id]);
    expect((await post(reviewer,"issue",{id})).status()).toBe(403);
    await db.query("UPDATE invitations SET status='submitted',reference='ADY-SCOPE-CHECK' WHERE id=$1",[id]);
    expect((await reviewer.get("/api/file?hr=1&id="+file)).status()).toBe(200);
    const bundle = await (await hr.get("/api/received-export")).json();
    expect(bundle.files.some(f=>f.id===file)).toBe(true);
    expect((await hr.get("/api/received-export-file?id="+file)).ok()).toBeTruthy();
    expect((await db.query("SELECT staff FROM hr_access_events WHERE action='file exported' AND file_id=$1",[file])).rows[0].staff).toBe(hrEmail);
    expect((await post(hr,"revoke",{id})).ok()).toBeTruthy();
    expect((await intern.get("/api/application")).status()).toBe(401);
    expect((await post(intern,"roster-login",{email:"scope@example.test"})).status()).toBe(401);
    expect((await post(hr,"restore",{id})).ok()).toBeTruthy();
    expect(await (await post(intern,"roster-login",{email:"scope@example.test"})).json()).toEqual({emailSent:true});
    expect((await intern.get("/api/application")).status()).toBe(401);
    await db.query("UPDATE sessions SET verified_at=now()-interval '11 minutes' WHERE staff=$1",[hrEmail]);
    expect((await hr.get("/api/received-export")).status()).toBe(428);
    expect((await post(hr,"issue",{id})).status()).toBe(428);
    await db.query("UPDATE hr_staff SET enabled=false WHERE email=$1",[reviewerEmail]);
    expect((await reviewer.get("/api/list")).status()).toBe(401);
  } finally {
    scanReply="stream: OK";
    await Promise.all([hr.dispose(),reviewer.dispose(),intern.dispose()]);
  }
});
test("private storage maintenance preserves submitted and latest files",async()=>{
  const {execFile}=require("node:child_process"),exec=require("node:util").promisify(execFile);
  const {id}= (await db.query("INSERT INTO invitations(id,token,name,email,role,starts,ends,requirements,status) VALUES($1,$2,'Retention','retention@example.test','Intern',current_date,current_date,'[]','draft') RETURNING id",[crypto.randomUUID(),crypto.randomBytes(24).toString("base64url")])).rows[0];
  const obsolete=crypto.randomUUID(),latest=crypto.randomUUID(),orphan=crypto.randomUUID();
  const folder=path.join(dir,"files"); await fs.mkdir(folder,{recursive:true});
  for(const key of [obsolete,latest,orphan]){
    await fs.writeFile(path.join(folder,key),sample.buffer);
    const old=new Date(Date.now()-40*86400000);
    await fs.utimes(path.join(folder,key),old,old);
  }
  await db.query("INSERT INTO files(id,invitation,slot,name,mime,bytes,created_at) VALUES ($1,$2,'resume','old.pdf','application/pdf',10,now()-interval '40 days'),($3,$2,'resume','latest.pdf','application/pdf',10,now()-interval '35 days')",[obsolete,id,latest]);
  const database=new URL(process.env.DATABASE_URL); database.searchParams.set("options","-c search_path="+schema);
  const env={...process.env,DATABASE_URL:database.toString(),S3_BUCKET:"",PORTAL_MODE:"local",PRIVATE_DIR:folder};
  const dry=await exec(process.execPath,["scripts/reconcile-storage.mjs"],{env});
  expect(JSON.parse(dry.stdout).supersededDraftVersions).toBe(1);
  expect(await fs.readFile(path.join(folder,obsolete))).toEqual(sample.buffer);
  const applied=await exec(process.execPath,["scripts/reconcile-storage.mjs","--apply"],{env});
  expect(JSON.parse(applied.stdout).unreferencedObjects).toBe(2);
  expect(await fs.readFile(path.join(folder,latest))).toEqual(sample.buffer);
  await expect(fs.stat(path.join(folder,orphan))).rejects.toThrow();
  await expect(fs.stat(path.join(folder,obsolete))).rejects.toThrow();
});
