import "server-only";
import { Pool, types, type PoolClient } from "pg";
import crypto from "node:crypto";
import { signingPolicies } from "./signing-policies";
import { currentRequirements, type Invitation } from "@shared/model";
types.setTypeParser(1082, (value) => value);
const globals = globalThis as typeof globalThis & { adyPool?: Pool };
export const pool = (globals.adyPool ??= new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
}));
export async function transaction<T>(work: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export class Problem extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function requireThat(
  ok: unknown,
  message: string,
  status = 400,
): asserts ok {
  if (!ok) throw new Problem(message, status);
}
export const demo = () => process.env.PORTAL_MODE === "local";
export const terms = () => {
  const declaration = process.env.TERMS_TEXT ||
    (demo() ? "I confirm that my details and uploaded documents are accurate. I agree that Adyapan may review these records for my internship onboarding." : "");
  const digest = hash(JSON.stringify([declaration, signingPolicies])).slice(0, 16);
  return {
    terms: declaration,
    policies: signingPolicies,
    version: [process.env.TERMS_VERSION, digest].filter(Boolean).join("-"),
  };
};
export const hash = (s: string) =>
  crypto.createHash("sha256").update(s).digest("hex");
export const safeEqual = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function details(
  db: Pick<PoolClient, "query">,
  id: string,
  lock = false,
): Promise<Invitation> {
  const row = (
    await db.query(
      "SELECT * FROM invitations WHERE id=$1 AND status <> 'removed'" + (lock ? " FOR UPDATE" : ""),
      [id],
    )
  ).rows[0];
  requireThat(row, "Invitation unavailable.", 404);
  const files = (
    await db.query(
      "SELECT DISTINCT ON(slot) id,slot,name,mime,bytes,(clean_digest IS NULL) AS pending FROM files WHERE invitation=$1 AND slot <> 'original' ORDER BY slot,created_at DESC",
      [id],
    )
  ).rows;
  const requirements = row.reference
    ? row.requirements
    : currentRequirements(row.requirements);
  const agreement = terms();
  const revision = hash(
    JSON.stringify([
      requirements,
      row.draft,
      files.filter((f) => f.slot !== "issued").map((f) => f.id),
      row.correction,
      agreement,
    ]),
  );
  return { ...row, requirements, files, revision, ...agreement };
}
export async function event(
  db: PoolClient,
  id: string,
  action: string,
  detail: object,
) {
  await db.query(
    "INSERT INTO events(invitation,action,detail) VALUES($1,$2,$3)",
    [id, action, detail],
  );
}
