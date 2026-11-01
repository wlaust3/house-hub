-- The Google account a member signs in with when they open the hub from outside the house
-- (through Cloudflare Access). Matched case-insensitively; NULL = can't sign in from outside.
ALTER TABLE members ADD COLUMN email TEXT;
CREATE UNIQUE INDEX members_email ON members (lower(email)) WHERE email IS NOT NULL AND removed_at IS NULL;
