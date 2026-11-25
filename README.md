# Adyapan Onboarding Portal

A mobile onboarding portal and a password-protected HR workspace. Next.js 16 and React serve both workflows. PostgreSQL stores invitations, drafts, file references, immutable declaration snapshots, review events and issuance records. The project-local Node.js runtime is pinned to 26.13.1.

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
2. Open the personal link in the invitation email and select **Open my application**. HR creating an invitation sends that email automatically. For the seeded **intern@adyapan.test** account or a returning device, open the personal invitation or QR code and enter the matching email address to continue immediately. Local delivery writes each message to `.local/outbox`. Initial invitations, correction emails and letter-ready emails have a single-use link valid for 48 hours. Loading the URL alone does not consume the link.
3. Complete three application screens. First confirm your name and invited email, enter your employee ID, phone and college, and upload your résumé as a PDF. Next upload your 10th, intermediate and degree marksheets (the latest semester marksheet is accepted in place of the degree marksheet), Aadhaar card, PAN card and signed offer letter. Finally read the configured terms, tick the agreement and draw or type an electronic signature. A reference appears after submission.
4. Open `/hr`. The generated development email and password are in `.local/hr-access.txt`. The workspace supports sending onboarding invitations, copying links and printing QR codes.
5. Open the submission in HR to review the signed copy the intern uploaded. Request a correction on one file, or authorize issuance. Selecting **Countersign and issue** centers the stamp immediately above the SIGNATURE label in the HR signature block on the last page of the reviewed upload. If that block cannot be located or has insufficient space, the stamp goes in a separate footer. Reopen the intern receipt or refresh its status to retrieve the stored PDF. The release email includes its own personal sign-in link.

The original orange brand image comes from the existing Adyapan project at `F:\Adyapan AI\frontend\public\assets\logo.png`. Set `HR_STAMP_PATH` to the private signed-stamp PNG (the configured local file is `.local/hr-manager-stamp.png`). Files, local mail, credentials and database state live outside the public web directory and are Git-ignored.

## HR invitation queue and received documents

Use **Invitation queue → To invite** to create one intern or import a roster. Download the Excel template from **Import Excel**, fill its first sheet with Name, Email, Role, Start date and End date, and upload the .xlsx file. Excel date cells and YYYY-MM-DD text are accepted. Rows sharing an email and start date with an existing invitation are skipped. An invalid row reports its row number before any records are added.

Use **Send** for one person or select multiple interns and choose **Send selected**. Importing queues the interns for HR to invite. Successfully sent rows move to **Awaiting documents**. A failed send stays in the queue for retry. The existing **Create invitation → Send now** option also sends one invitation directly.

**Documents received** lists submitted applications, including submissions under correction and issued letters. Click the intern’s name to review. **Export Excel + documents** downloads a ZIP with the Excel workbook, uploaded files, and signed submission records for the entire received list. Extract the ZIP before opening the workbook so its document links work. The invitation lists export as .xlsx files.

## Production pilot

Set the environment values listed in `.env.example` through the host's secret manager. Set `PORTAL_MODE=production` and serve the configured `APP_ORIGIN` over HTTPS. Local filesystem document storage, sample terms and the file outbox are enabled only in local mode. Use a dedicated production database and an empty private bucket. Keep the development invitation and local credentials on the development machine.

- **PostgreSQL**. Provision the database, apply `lib/schema.sql` with `psql -v ON_ERROR_STOP=1 -f lib/schema.sql` against the selected database, and set a scoped app connection in `DATABASE_URL`. Configure encrypted backups and a restore drill. Restore a matching private-object backup when restoring database references.
- **Storage**. Set `S3_BUCKET`, region and optional S3-compatible endpoint. Use an IAM role or a scoped access key with get/put permissions for the private bucket. Enable versioning and backups. Every preview and download is served by the authorized application endpoint.
- **HR and terms**. The pilot provisions one authorized HR account. Set its lowercase email and a password hash. Password hashes use `salt:hexDigest` with Node’s `scryptSync(password, salt, 32)`. Set the approved declaration in `TERMS_TEXT` and its identifier in `TERMS_VERSION`. New invitations use the standard seven-file checklist. Existing submitted applications keep their original checklist during HR review and corrections.
- **Transactional mail**. Set the SMTP connection URL and verified sender. Exercise invitation, sign-in, correction and release delivery in the provider sandbox before switching to live recipients. HR can retry a failed release notification from the issued record.
- **Offer issuance**. Mount the HR manager�s approved PNG as a private readable file and set `HR_STAMP_PATH` to its path to use the visible stamp. For provider-managed signing, configure an authorized HTTPS adapter in `SIGNING_URL` and its bearer token in `SIGNING_TOKEN`. A configured signing provider takes precedence over the PNG. The adapter receives a POST containing the reviewed intern-signed PDF, an `X-Offer-Reference` and an `Idempotency-Key` bound to the invitation and source file version. It must preserve all source pages, apply the approved HR signing method and official stamp, and return the complete issued PDF. Repeated requests with the same key must return identical bytes. If the provider uses a different contract, supply an adapter before enabling production issuance.
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
