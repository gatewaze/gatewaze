// @ts-nocheck
/**
 * QR Code Contact System - Service Index
 *
 * Central export point for all QR system services
 */

export { MemberService } from './memberService';
export { RegistrationService } from './registrationService';
export { BadgePrintingService } from './badgePrintingService';

// Re-export utilities
export {
  generateQrCodeId,
  generateQrAccessToken,
  verifyQrAccessToken,
  generateQrCodeUrl,
  generateVCard,
  type MemberVCard,
} from '../qrCode';

export {
  generateBadgeImage,
  generateBadgePdf,
  DEFAULT_BADGE_TEMPLATE,
  type MemberProfile as BadgeMemberProfile,
  type EventInfo as BadgeEventInfo,
  type BadgeTemplate,
} from '../badgeGenerator';

export {
  printBadge,
  printBadgeBatch,
  getAvailablePrinters,
  getDefaultPrinter,
  testPrinterConnection,
  type PrinterConfig,
  type PrintJob,
} from '../printerIntegration';
