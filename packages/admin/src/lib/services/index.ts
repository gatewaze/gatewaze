/**
 * QR Code Contact System - Service Index
 *
 * Central export point for all QR system services
 */

export { PeopleProfileService } from './peopleProfileService';
export { RegistrationService } from './registrationService';

// Re-export utilities
export {
  generateQrCodeId,
  generateQrAccessToken,
  verifyQrAccessToken,
  generateQrCodeUrl,
  generateVCard,
  type MemberVCard,
} from '../qrCode';
