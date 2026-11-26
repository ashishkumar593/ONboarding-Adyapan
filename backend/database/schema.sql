CREATE TABLE IF NOT EXISTS invitations (
 id uuid PRIMARY KEY, token text NOT NULL UNIQUE, name text NOT NULL, email text NOT NULL,
 role text NOT NULL, starts date NOT NULL, ends date NOT NULL,
 requirements jsonb NOT NULL, draft jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'invited', reference text UNIQUE, correction jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), issued_file uuid, notified_at timestamptz
);
CREATE INDEX IF NOT EXISTS invitation_email ON invitations(email, created_at DESC);
CREATE TABLE IF NOT EXISTS files (
 id uuid PRIMARY KEY, invitation uuid NOT NULL REFERENCES invitations(id), slot text NOT NULL,
 name text NOT NULL, mime text NOT NULL, bytes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_by_slot ON files(invitation, slot, created_at DESC);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invitation_email_sent_at timestamptz;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS last_access_request_at timestamptz;
CREATE TABLE IF NOT EXISTS email_access_links (
 digest text PRIMARY KEY, invitation uuid NOT NULL REFERENCES invitations(id),
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS email_access_invitation ON email_access_links(invitation, expires_at);
CREATE TABLE IF NOT EXISTS sessions (
 digest text PRIMARY KEY, invitation uuid REFERENCES invitations(id), hr boolean NOT NULL DEFAULT false,
 expires timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
 id uuid PRIMARY KEY, invitation uuid NOT NULL REFERENCES invitations(id), snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_by_invitation ON submissions(invitation, created_at DESC);
CREATE TABLE IF NOT EXISTS events (
 id bigserial PRIMARY KEY, invitation uuid REFERENCES invitations(id), action text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hr_login (account text PRIMARY KEY, failures integer DEFAULT 0, since timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS hr_staff (
 email text PRIMARY KEY, password_hash text NOT NULL, access_key_hash text NOT NULL,
 permissions text[] NOT NULL DEFAULT '{}', enabled boolean NOT NULL DEFAULT true,
 credential_version integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS hr_assignments (
 staff text NOT NULL REFERENCES hr_staff(email), invitation uuid NOT NULL REFERENCES invitations(id),
 PRIMARY KEY(staff, invitation)
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS staff text REFERENCES hr_staff(email);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS credential_version integer;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS access_revoked_at timestamptz;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS qr_expires_at timestamptz;
ALTER TABLE files ADD COLUMN IF NOT EXISTS clean_digest text;
CREATE TABLE IF NOT EXISTS hr_access_events (
 id bigserial PRIMARY KEY, staff text NOT NULL, action text NOT NULL,
 invitation uuid, file_id uuid, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS method text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS draft_progress jsonb NOT NULL DEFAULT '{}';
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS intern_access_expires_at timestamptz;
-- Older versions kept the 30-day deadline on remembered-browser grants.
-- When no grant remains, use the earliest recorded intern activity.
UPDATE invitations i SET intern_access_expires_at = COALESCE(
  LEAST(
    (SELECT min(expires) FROM sessions WHERE invitation=i.id AND method='remember-browser'),
    (SELECT min(created_at) + interval '720 hours' FROM files WHERE invitation=i.id AND slot NOT IN ('original','issued')),
    (SELECT min(created_at) + interval '720 hours' FROM submissions WHERE invitation=i.id)
  ), i.created_at + interval '720 hours'
) WHERE intern_access_expires_at IS NULL AND (
  status IN ('draft','submitted','correction','issued')
  OR EXISTS (SELECT 1 FROM sessions WHERE invitation=i.id AND NOT hr)
);
