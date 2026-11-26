# Adyapan Onboarding Portal

A mobile onboarding portal and a password-protected HR workspace. Next.js 16 and React serve both workflows. PostgreSQL stores invitations, drafts, file references, immutable declaration snapshots, review events and issuance records. The project-local Node.js runtime is pinned to 26.13.1.

## Project structure

| Directory | Responsibility |
| --- | --- |
| `frontend/app` | Next.js pages, layouts, styles and the route entry point for `/api/[action]`. |
| `frontend/components`, `frontend/public` | Intern and HR interfaces, browser API calls, and public brand assets. |
| `backend/api` | HTTP handlers for onboarding, HR review, exports and file access. |
| `backend/services` | Authentication, database queries, private storage, email delivery and offer issuance. |
| `backend/database` | PostgreSQL schema used by local setup and production provisioning. |
| `shared` | Types, document requirements and signature validation used by the frontend and backend. |
| `scripts`, `tests` | Startup, local provisioning and end-to-end tests. |

The portal deploys as one Next.js application. Browser components call the same-origin API. The API route and the server-rendered invitation page call the backend on the server. Run npm commands from the repository root, where the package manifest, lockfile and environment configuration live. The production build is written to `frontend/.next`.

## Run the local pilot

From the project folder in PowerShell, use an installed Node.js 24 or 26 and PostgreSQL 18 command-line tools.

```powershell
npm.cmd ci
npm.cmd run setup:local
npm.cmd run build
npm.cmd start -- -H 0.0.0.0 -p 3000
```

For live editing use `npm.cmd run dev -- -H 0.0.0.0 -p 3000` in place of build and start. Local setup starts a separate password-protected PostgreSQL cluster under `.local/postgres` on loopback port 55439. It leaves the installed PostgreSQL service alone. Set `PG_BIN` before setup if PostgreSQL is installed outside the default Windows path. Run setup again after restarting the computer to start the cluster and regenerate the sample QR.

1. Open `http://localhost:3000` on the host. For a phone, scan `.local/sample-invite.png` while connected to the same Wi-Fi. The fallback link is in `.local/sample-invite.txt`. Phone access requires the host firewall to allow the app’s port on that network. If the Wi-Fi address changes, update `APP_ORIGIN` in `.env.local`, run setup again and restart the app.
2. HR imports the Excel roster and shares the common /apply URL or QR. Enter a listed email to start. The first sign-in starts a single 30-day access period on the roster record. Signing out, changing browsers, or confirming an inbox link keeps that deadline. On a shared computer, uncheck Remember this personal browser before signing out. Entering a roster email never sends mail automatically. To reopen a saved record on an unrecognized browser, request inbox confirmation if recovery email is available. A remembered browser can reopen the record directly until the account deadline. Local delivery writes recovery and status messages to .local/outbox.
3. Complete three application screens. First confirm your name and invited email, enter your employee ID, phone and college, and upload your résumé as a PDF. Next upload your 10th, intermediate and degree marksheets (the latest semester marksheet is accepted in place of the degree marksheet), Aadhaar card, PAN card and signed offer letter. Finally read the configured terms, tick the agreement and draw or type an electronic signature. A reference appears after submission.
4. Open `/hr`. The local email and password are in `.local/hr-access.txt`. The separately generated access key is in `.local/hr-access-key.txt`. The workspace supports importing the roster, copying the shared link and downloading its QR code.
5. Open the submission in HR to review the signed copy the intern uploaded. Request a correction on one file, or authorize issuance. Selecting **Countersign and issue** centers the stamp immediately above the SIGNATURE label in the HR signature block on the last page of the reviewed upload. If that block cannot be located or has insufficient space, the stamp goes in a separate footer. Reopen the intern receipt or refresh its status to retrieve the stored PDF. The release email points to the shared portal.

The original orange brand image comes from the existing Adyapan project at `F:\Adyapan AI\frontend\public\assets\logo.png`. Set `HR_STAMP_PATH` to the private signed-stamp PNG (the configured local file is `.local/hr-manager-stamp.png`). Files, local mail, credentials and database state live outside the public web directory and are Git-ignored.

## Intern roster and received documents

Download the Excel template from **Import Excel**, fill its first sheet with Name, Email, Role, Start date and End date, and upload the .xlsx file. Excel date cells and YYYY-MM-DD text are accepted. Rows sharing an email and start date with an existing invitation are skipped. An invalid row reports its row number before any records are added.

After import, the listed addresses are eligible immediately. Copy the shared link or download its QR from **Intern roster** and distribute it yourself. If an email has multiple internships, the shared page selects the most recent start date.

**Documents received** lists submitted applications, including submissions under correction and issued letters. Click the intern’s name to review. **Export Excel + documents** downloads a ZIP with the Excel workbook, uploaded files, and signed submission records for the entire received list. Extract the ZIP before opening the workbook so its document links work. The invitation lists export as .xlsx files.

## Production pilot

Set the environment values listed in `.env.example` through the host's secret manager. Set `PORTAL_MODE=production` and serve the configured `APP_ORIGIN` over HTTPS. Local filesystem document storage, sample terms and the file outbox are enabled only in local mode. Use a dedicated production database and an empty private bucket. Keep the development invitation and local credentials on the development machine.

- **PostgreSQL**. Provision the database, apply `backend/database/schema.sql` with `psql -v ON_ERROR_STOP=1 -f backend/database/schema.sql` against the selected database, and set a scoped app connection in `DATABASE_URL`. Configure encrypted backups and a restore drill. Restore a matching private-object backup when restoring database references.
- **Storage**. Set `S3_BUCKET`, region and optional S3-compatible endpoint. Use an IAM role or a scoped access key with get/put permissions for the private bucket. Enable versioning and backups. Every preview and download is served by the authorized application endpoint.
- **HR and terms**. Provision individual staff accounts and assignments using the access controls below. Interns review the Confidentiality Agreement and Liquidated Damages Addendum before signing. Use `TERMS_TEXT` for an additional declaration and `TERMS_VERSION` for an optional version prefix. Each acceptance records the displayed clauses and the hashes of both original PDFs. New invitations use the standard seven-file checklist. Existing submitted applications keep their original checklist during HR review and corrections.
- **Transactional mail**. Set the SMTP connection URL and verified sender. Exercise invitation, sign-in, correction and release delivery in the provider sandbox before switching to live recipients. HR can retry a failed release notification from the issued record.
- **Offer issuance**. On Vercel, set the Production secret `HR_STAMP_BASE64` to the base64 contents of the approved PNG, then deploy the updated code. A mounted private PNG can alternatively be configured with `HR_STAMP_PATH`. For provider-managed signing, configure an authorized HTTPS adapter in `SIGNING_URL` and its bearer token in `SIGNING_TOKEN`. A configured signing provider takes precedence over the PNG. The adapter receives a POST containing the reviewed intern-signed PDF, an `X-Offer-Reference` and an `Idempotency-Key` bound to the invitation and source file version. It must preserve all source pages, apply the approved HR signing method and official stamp, and return the complete issued PDF. Repeated requests with the same key must return identical bytes. If the provider uses a different contract, supply an adapter before enabling production issuance.
- **Release**. Build with `npm run build` and serve with `npm start`. Route the production HTTPS origin to the Node process and allow uploads slightly larger than the 8 MB file limit for multipart overhead. Keep database and bucket access private. Validate a printed QR, email sign-in and final PDF on actual iPhone and Android devices.

The intern-signed upload and the declaration are separate records. Each declaration stores the authenticated invitation, email, name, electronic signature, accepted terms and version, timestamp, exact draft and file versions. Corrections preserve earlier submissions and keep the reference stable. A database row lock serializes issuance. The issued file is stored before the application transitions to ready, and download reads the same stored object each time.

## Verification

With Chrome installed, use an initialized local pilot and a current production build.

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
```

Playwright runs a separate server on loopback port 3019, creates a unique database schema and temporary private storage and outbox for each run, then removes those fixtures. It exercises email and password login, QR decoding, automatic invitation email, inbox-link sign-in, expiry, replay rejection, uninvited email rejection, mobile-sized sessions, saved drafts, cross-intern file isolation, submission retries, file corrections, signing failure recovery, release email and byte-identical downloads. Phone profiles use Chromium emulation. Physical handset, provider and backup restore checks belong to the live pilot.

## Staff access and production migration

Apply `backend/database/schema.sql` to the target database first. Provision individual accounts and assignments before switching traffic to this release. The upgraded routes reject old shared HR sessions and legacy intern sessions. Existing submissions, files and issued offers retain their IDs. Interns can reopen their records from their invited inbox.

Run the following from the repository root on a trusted administration machine with the target `DATABASE_URL` set. Replace the example email, private path and invitation UUID. Use a private directory outside the repository and web root for credential delivery.

```text
node scripts/hr-staff.mjs create staff@example.org invite,review /private/credentials/staff
node scripts/hr-staff.mjs assign staff@example.org INVITATION_UUID
node scripts/hr-staff.mjs unassign staff@example.org INVITATION_UUID
node scripts/hr-staff.mjs permissions staff@example.org review,issue
node scripts/hr-staff.mjs rotate staff@example.org /private/credentials/staff-new
node scripts/hr-staff.mjs disable staff@example.org
```

Creation and rotation write a new password and a random 256-bit access key to separate files ending in `.password` and `.key`. Deliver them separately to the account holder. The database stores a salted scrypt password hash and an access-key digest. Rotation, disabling an account or changing its permissions invalidates its sessions. Use a database administrator identity for provisioning and limit the runtime database role to the operations the portal needs.

- **invite** manages an assigned invitation queue. Each newly created or imported record is assigned to its creator. Use the assignment command to add the reviewer or signer.
- **review** opens assigned submissions and requests corrections.
- **issue** reviews the submitted offer and countersigns it for an assigned intern.
- **export** permits bulk downloads for assigned records. Grant it explicitly. Exports and countersigning require a login within the past ten minutes. HR access events record who requested a document or export. Issuance events record the signing account.
- The local pilot links existing interns to the local manager during first-time migration and enables invitation management, review and signing. Use the permissions command to grant export to the designated account. Administer production accounts separately.
- **Revoke intern access** disables that record and its sessions. **Restore intern access** reopens it through the same shared portal.

### Document screening and retention

Configure `CLAMD_URL` for a ClamAV daemon using the INSTREAM protocol. Use `tls://scanner.internal.example:3310` with a trusted TLS tunnel in front of the daemon, or `tcp://127.0.0.1:3310` for a colocated scanner. Keep definitions current and set ClamAV limits to cover the allowed documents. A Windows local pilot can use Microsoft Defender. Uploads and previously stored documents without a scan digest must receive a clean result before use. During an outage (including an unconfigured scanner), uploads with a supported file signature can be saved privately with a pending status. Opening the file or submitting retries both scanning and full format validation before releasing any bytes or accepting the application. Production requires CLAMD_URL to complete screening. A changed stored digest blocks delivery.

Uploads are limited to 8 MiB each, 48 uploaded versions and 128 MiB per intern. PDF files may have up to 200 pages. PNG and JPEG uploads must decode within 20 megapixels. The HR-stamped PDF is screened before issuance.

Run `node scripts/reconcile-storage.mjs` against the matching database and dedicated store for a dry run. To apply the retention policy, run the same command with `--apply` in a maintenance window. It prunes superseded draft versions older than 30 days only for applications that have never been submitted. It reconciles unreferenced UUID objects older than 48 hours and preserves submitted records and issuance references. S3 bucket version retention is managed separately by the storage administrator. Use the dry run and review the counts before scheduling cleanup.

For production, confirm that preview deployments are access-controlled, the bucket blocks public access, database sessions use verified TLS, and hosting logs redact invitation URLs. Check real document screening and both credential fields on a preview deployment before switching production traffic.
