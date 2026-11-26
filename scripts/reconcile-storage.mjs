import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const apply = process.argv.includes("--apply");
if (!process.env.DATABASE_URL)
  throw Error("Set DATABASE_URL for the selected private store.");
const bucket = process.env.S3_BUCKET;
if (!bucket && process.env.PORTAL_MODE !== "local")
  throw Error("Set the production private bucket.");
const directory = path.resolve(process.env.PRIVATE_DIR || ".local/private");
const s3 =
  bucket &&
  new S3Client({
    region: process.env.AWS_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: !!process.env.S3_ENDPOINT,
  });
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const cutoff = Date.now() - 48 * 60 * 60 * 1000;
async function* oldObjects() {
  if (s3) {
    let cursor;
    do {
      const page = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: cursor }),
      );
      for (const item of page.Contents || [])
        if (uuid.test(item.Key) && item.LastModified?.getTime() < cutoff)
          yield item.Key;
      cursor = page.NextContinuationToken;
    } while (cursor);
  } else {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      if (!item.isFile() || !uuid.test(item.name)) continue;
      if ((await fs.stat(path.join(directory, item.name))).mtimeMs < cutoff)
        yield item.name;
    }
  }
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  // Serialize the maintenance decision with upload and submission transactions.
  // A committed metadata deletion can leave an orphan for the next run after an interruption.
  await db.query("BEGIN");
  await db.query("LOCK TABLE invitations IN EXCLUSIVE MODE");
  const superseded =
    await db.query(`SELECT f.id FROM files f JOIN invitations i ON i.id=f.invitation
    WHERE i.reference IS NULL AND i.status IN ('invited','draft') AND f.slot NOT IN ('original','issued')
    AND f.created_at < now()-interval '30 days' AND i.issued_file IS DISTINCT FROM f.id
    AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.invitation=i.id)
    AND EXISTS(SELECT 1 FROM files newer WHERE newer.invitation=i.id AND newer.slot=f.slot
               AND (newer.created_at,newer.id)>(f.created_at,f.id))`);
  if (apply && superseded.rowCount)
    await db.query("DELETE FROM files WHERE id=ANY($1::uuid[])", [
      superseded.rows.map((r) => r.id),
    ]);
  await db.query("COMMIT");
  let orphans = 0;
  for await (const id of oldObjects()) {
    await db.query("BEGIN");
    await db.query("LOCK TABLE invitations IN EXCLUSIVE MODE");
    const referenced = await db.query(
      `SELECT EXISTS(SELECT 1 FROM files WHERE id=$1)
      OR EXISTS(SELECT 1 FROM invitations WHERE issued_file=$1)
      OR EXISTS(SELECT 1 FROM submissions WHERE snapshot->'files' ? $2)
      OR EXISTS(SELECT 1 FROM events WHERE detail->>'source'=$2 OR detail->>'issued'=$2 OR detail->>'previous'=$2) AS found`,
      [id, id],
    );
    if (!referenced.rows[0].found) {
      orphans++;
      if (apply) {
        if (s3)
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: id }));
        else await fs.unlink(path.join(directory, id));
      }
    }
    await db.query("COMMIT");
  }
  console.log(
    JSON.stringify({
      mode: apply ? "applied" : "dry-run",
      supersededDraftVersions: superseded.rowCount,
      unreferencedObjects: orphans,
    }),
  );
} finally {
  await db.end();
}
