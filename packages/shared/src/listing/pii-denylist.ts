/**
 * Per spec-platform-listing-pattern.md §20.4 — column-name denylist.
 * Modules MUST NOT include any of these in publicApi/mcp/portal
 * projections without a structured `piiExposureAcknowledgement` entry.
 *
 * Match is case-insensitive on the bare column name (after `<table>.`
 * stripping). Modules with field aliases (`{ col: 'email', as: 'foo' }`)
 * still trip the check because the underlying column is `email`.
 */

export const PII_DENYLIST: ReadonlyArray<string> = [
  'email',
  'email_address',
  'personal_email',
  'work_email',
  'phone',
  'phone_number',
  'mobile',
  'ssn',
  'social_security_number',
  'tax_id',
  'date_of_birth',
  'dob',
  'home_address',
  'street_address',
  'address_line_1',
  'address_line_2',
  'postal_code',
  'zip_code',
  'credit_card',
  'credit_card_number',
  'cc_number',
  'cvv',
  'iban',
  'bank_account',
  'passport_number',
  'driver_license',
  'national_id',
  'ip_address',
  'password',
  'password_hash',
  'api_key_secret',
  'api_token',
  'access_token',
  'refresh_token',
  'session_token',
  'auth_token',
  'private_key',
  'two_factor_secret',
  'mfa_secret',
];

/**
 * Returns true if the given column name (case-insensitive) is on the
 * PII denylist.
 */
export function isPiiColumn(column: string): boolean {
  const c = column.toLowerCase().trim();
  return PII_DENYLIST.includes(c);
}
