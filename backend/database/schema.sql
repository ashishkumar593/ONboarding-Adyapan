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
