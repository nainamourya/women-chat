// The admin dashboard is restricted to this single address, independent of
// the `admin` role check — role controls API access, this controls who
// sees the admin UI at all.
const ALLOWED_ADMIN_EMAILS = ["nainam6025@gmail.com"];

export function isAllowedAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return ALLOWED_ADMIN_EMAILS.includes(email.toLowerCase());
}
