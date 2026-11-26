import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const [command, email, arg, output] = process.argv.slice(2);
const credentialFile = command === "rotate" ? arg : output;
const available = ["invite", "review", "issue", "export"];
function permissions(value = "") {
  const items = value.split(",").filter(Boolean);
  if (!items.every((p) => available.includes(p)))
    throw Error("Use invite, review, issue or export.");
  return [...new Set(items)];
}
if (
  !email ||
  email !== email.toLowerCase() ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
)
  throw Error("Enter a lowercase staff email.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  if (command === "create" || command === "rotate") {
    const roles = command === "create" ? permissions(arg) : [];
    if (!credentialFile)
      throw Error("Supply a new private credential file path.");
    const destination = await fs.realpath(
      path.dirname(path.resolve(credentialFile)),
    );
    const repository = await fs.realpath(
      fileURLToPath(new URL("../", import.meta.url)),
    );
    const inside = path.relative(repository, destination);
    if (
      !path.isAbsolute(inside) &&
      inside !== ".." &&
      !inside.startsWith(".." + path.sep) &&
      !(
        process.env.PORTAL_MODE === "local" &&
        (inside === ".local" || inside.startsWith(".local" + path.sep))
      )
    ) {
      throw Error("Use a private credential directory outside the repository.");
    }
    const password = crypto.randomBytes(24).toString("base64url"),
      key = crypto.randomBytes(32).toString("base64url");
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash =
      salt + ":" + crypto.scryptSync(password, salt, 32).toString("hex");
    const keyHash = crypto.createHash("sha256").update(key).digest("hex");
    if (command === "create") {
      await db.query(
        "INSERT INTO hr_staff(email,password_hash,access_key_hash,permissions) VALUES($1,$2,$3,$4)",
        [email, passwordHash, keyHash, roles],
      );
    } else {
      const result = await db.query(
        "UPDATE hr_staff SET password_hash=$2,access_key_hash=$3,credential_version=credential_version+1 WHERE email=$1",
        [email, passwordHash, keyHash],
      );
      if (!result.rowCount) throw Error("Unknown staff account.");
    }
    await fs.writeFile(
      credentialFile + ".password",
      "Email: " + email + "\nPassword: " + password + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await fs.writeFile(credentialFile + ".key", key + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  } else if (command === "assign" || command === "unassign") {
    if (command === "assign")
      await db.query(
        "INSERT INTO hr_assignments(staff,invitation) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [email, arg],
      );
    else
      await db.query(
        "DELETE FROM hr_assignments WHERE staff=$1 AND invitation=$2",
        [email, arg],
      );
  } else if (command === "permissions" || command === "disable") {
    const result =
      command === "disable"
        ? await db.query(
            "UPDATE hr_staff SET enabled=false,credential_version=credential_version+1 WHERE email=$1",
            [email],
          )
        : await db.query(
            "UPDATE hr_staff SET permissions=$2,credential_version=credential_version+1 WHERE email=$1",
            [email, permissions(arg)],
          );
    if (!result.rowCount) throw Error("Unknown staff account.");
  } else
    throw Error(
      "Use create, rotate, permissions, assign, unassign or disable.",
    );
  await db.query("COMMIT");
  console.log("Staff account updated.");
} finally {
  await db.end();
}
