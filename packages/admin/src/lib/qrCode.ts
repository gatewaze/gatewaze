/**
 * QR Code Generation Utilities
 * Handles QR code generation for member profiles
 */

import crypto from 'crypto';

/**
 * Generate a short, unique QR code ID (12 characters)
 * Excludes ambiguous characters (0, O, I, 1, etc.)
 */
export function generateQrCodeId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars
  let result = '';

  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

/**
 * Generate a secure token for QR code access
 * Returns both the token and its SHA-256 hash
 */
export function generateQrAccessToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  return { token, hash };
}

/**
 * Verify a QR access token against its hash
 */
export function verifyQrAccessToken(token: string, hash: string): boolean {
  const computedHash = crypto.createHash('sha256').update(token).digest('hex');
  return computedHash === hash;
}

/**
 * Member data to embed in QR code for offline scanning
 */
export interface EmbeddedMemberData {
  n: string;  // name (first + last)
  c?: string; // company
  t?: string; // title
  e?: string; // email
}

/**
 * Encode member data as base64 JSON for embedding in QR code URL
 */
export function encodeMemberData(data: EmbeddedMemberData): string {
  const json = JSON.stringify(data);
  // Use base64url encoding (URL-safe)
  return Buffer.from(json).toString('base64url');
}

/**
 * Decode embedded member data from QR code URL
 */
export function decodeMemberData(encoded: string): EmbeddedMemberData | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf-8');
    return JSON.parse(json) as EmbeddedMemberData;
  } catch {
    return null;
  }
}

/**
 * Generate a QR code URL for a member
 * Optionally includes embedded member data for offline scanning
 */
export function generateQrCodeUrl(
  qrCodeId: string,
  token?: string,
  memberData?: EmbeddedMemberData
): string {
  const baseUrl = process.env.NEXT_PUBLIC_QR_BASE_URL || 'https://events.yourdomain.com';
  const url = `${baseUrl}/m/${qrCodeId}`;
  const params: string[] = [];

  if (token) {
    params.push(`t=${token}`);
  }

  if (memberData) {
    params.push(`d=${encodeMemberData(memberData)}`);
  }

  if (params.length > 0) {
    return `${url}?${params.join('&')}`;
  }

  return url;
}

/**
 * Generate vCard data for a member profile
 */
export interface MemberVCard {
  fullName: string;
  email: string;
  company?: string;
  jobTitle?: string;
  phone?: string;
  linkedinUrl?: string;
  twitterHandle?: string;
}

export function generateVCard(member: MemberVCard): string {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${member.fullName}`,
    `EMAIL:${member.email}`,
  ];

  if (member.company) {
    lines.push(`ORG:${member.company}`);
  }

  if (member.jobTitle) {
    lines.push(`TITLE:${member.jobTitle}`);
  }

  if (member.phone) {
    lines.push(`TEL:${member.phone}`);
  }

  if (member.linkedinUrl) {
    lines.push(`URL:${member.linkedinUrl}`);
  }

  if (member.twitterHandle) {
    lines.push(`X-SOCIALPROFILE;TYPE=twitter:${member.twitterHandle}`);
  }

  lines.push('END:VCARD');

  return lines.join('\r\n');
}
