/**
 * Canonicalise an Indian mobile number to "+91XXXXXXXXXX" (a 10-digit number
 * starting 6–9), or return null when it isn't a valid Indian mobile.
 *
 * Mirrors the API's IN_MOBILE rule (auth/dto.ts) so the OTP key is IDENTICAL no
 * matter which login path is used — a bare 10-digit and a +91-prefixed number
 * must never resolve to two different accounts. Accepts the common shapes a user
 * might type: with/without +91, a leading 0, or spaces/dashes.
 */
export function normalizeMobile(raw: string): string | null {
  const digits = raw
    .replace(/[\s-]/g, '') // drop spaces and dashes
    .replace(/^\+?91/, '') // drop a leading +91 / 91 country code
    .replace(/^0/, ''); // drop a single leading trunk 0
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}
