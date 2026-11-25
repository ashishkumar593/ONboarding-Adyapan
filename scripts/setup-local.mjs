import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";
import QRCode from "qrcode";

const dir = path.resolve(".local");
await fs.mkdir(dir, { recursive: true });
await fs.mkdir(path.join(dir, "outbox"), { recursive: true });
const config = path.resolve(".env.local");
const ip =
  Object.entries(os.networkInterfaces())
    .filter(([k]) => !/vmnet|vethernet|virtual|bluetooth/i.test(k))
    .flatMap(([, v]) => v ?? [])
    .find(
      (v) =>
        v.family === "IPv4" && !v.internal && !v.address.startsWith("169.254."),
    )?.address || "localhost";
const origin = process.env.APP_ORIGIN || "http://" + ip + ":3000";
const port = process.env.LOCAL_PG_PORT || "55439";
const hrFile = path.join(dir, "hr-access.txt");
if (!existsSync(config)) {
  const password = crypto.randomBytes(20).toString("base64url");
  const salt = crypto.randomBytes(16).toString("hex");
  const dbPassword = crypto.randomBytes(24).toString("hex");
  const email = "hr@adyapan.test";
  await fs.writeFile(
    config,
    [
      "PORTAL_MODE=local",
      "APP_ORIGIN=" + origin,
      "DATABASE_URL=postgresql://portal:" +
        dbPassword +
        "@127.0.0.1:" +
        port +
        "/postgres",
      "HR_EMAIL=" + email,
      "HR_PASSWORD_HASH=" +
        salt +
        ":" +
        crypto.scryptSync(password, salt, 32).toString("hex"),
    ].join("\n"),
    { flag: "wx" },
  );
  await fs.writeFile(
    hrFile,
    "Local HR account\nEmail: " + email + "\nPassword: " + password + "\n",
  );
}
process.loadEnvFile(config);
if (process.env.PORTAL_MODE !== "local")
  throw new Error("Local setup requires PORTAL_MODE=local.");
const connection = new URL(process.env.DATABASE_URL);
if (connection.hostname !== "127.0.0.1" || connection.username !== "portal")
  throw new Error("Local setup expects its own loopback database.");
const binary =
  process.env.PG_BIN ||
  (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "");
const pgtool = (name, args, options = {}) =>
  execFileSync(
    path.join(binary, name + (process.platform === "win32" ? ".exe" : "")),
    args,
    { stdio: "pipe", windowsHide: true, ...options },
  );
const cluster = path.join(dir, "postgres");
if (!existsSync(path.join(cluster, "PG_VERSION"))) {
  const pw = path.join(dir, "init-password.tmp");
  await fs.writeFile(pw, connection.password);
  try {
    pgtool("initdb", [
      "-D",
      cluster,
      "-U",
      "portal",
      "-A",
      "scram-sha-256",
      "--pwfile",
      pw,
      "--encoding=UTF8",
      "--locale=C",
    ]);
  } finally {
    await fs.unlink(pw);
  }
  await fs.appendFile(
    path.join(cluster, "postgresql.conf"),
    "\nlisten_addresses = '127.0.0.1'\nport = " +
      Number(connection.port) +
      "\n",
  );
}
try {
  pgtool("pg_ctl", ["-D", cluster, "status"]);
} catch {
  pgtool(
    "pg_ctl",
    ["-D", cluster, "-l", path.join(dir, "postgres.log"), "-w", "start"],
    { stdio: "ignore" },
  );
}
const db = new pg.Client({ connectionString: connection.toString() });
await db.connect();
try {
  await db.query(await fs.readFile("lib/schema.sql", "utf8"));
  const email = "intern@adyapan.test";
  let row = (
    await db.query(
      "SELECT token FROM invitations WHERE email=$1 ORDER BY created_at LIMIT 1",
      [email],
    )
  ).rows[0];
  if (!row) {
    const id = crypto.randomUUID(),
      token = crypto.randomBytes(24).toString("base64url");
    await db.query(
      "INSERT INTO invitations(id,token,name,email,role,starts,ends,requirements) VALUES($1,$2,$3,$4,$5,current_date+7,current_date+97,$6)",
      [
        id,
        token,
        "Aarya Sharma",
        email,
        "Product Design Intern",
        await fs.readFile("lib/intern-documents.json", "utf8"),
      ],
    );
    row = { token };
  }
  const url = process.env.APP_ORIGIN + "/i/" + row.token;
  await QRCode.toFile(path.join(dir, "sample-invite.png"), url, {
    width: 480,
    margin: 4,
  });
  await fs.writeFile(
    path.join(dir, "sample-invite.txt"),
    "Sample intern: " +
      email +
      "\nInvitation: " +
      url +
      "\nSign-in mail: .local/outbox\n",
  );
  console.log(
    "Ready. Sample invitation and QR in .local. HR sign-in details are in .local/hr-access.txt.",
  );
} finally {
  await db.end();
}
