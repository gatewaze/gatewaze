import QRCodeStyling from 'qr-code-styling';

export interface QRCodeOptions {
  data: string;
  size?: number;
  margin?: number;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  logo?: string;
  color?: string;
  backgroundColor?: string;
}

export class QRCodeService {
  /**
   * Generate a QR code as a data URL
   * This method is client-side only and doesn't require any external API
   */
  static async generateQRCode(options: QRCodeOptions): Promise<string> {
    const {
      data,
      size = 300,
      margin = 0,
      errorCorrectionLevel = 'L',
      logo,
      color = '#000000',
      backgroundColor = '#ffffff',
    } = options;

    const qrCode = new QRCodeStyling({
      width: size,
      height: size,
      type: 'canvas',
      shape: 'square',
      data: data,
      margin: margin,
      qrOptions: {
        typeNumber: 0,
        mode: 'Byte',
        errorCorrectionLevel: errorCorrectionLevel,
      },
      imageOptions: {
        saveAsBlob: true,
        hideBackgroundDots: false,
        imageSize: 0.4,
        margin: 0,
        crossOrigin: 'anonymous',
      },
      dotsOptions: {
        type: 'dots', // Circular dots instead of squares
        color: color,
        roundSize: true,
      },
      backgroundOptions: {
        round: 0,
        color: backgroundColor,
      },
      cornersSquareOptions: {
        type: 'dot', // Circular corner squares
        color: '#ff0000', // Red corner markers
      },
      cornersDotOptions: {
        type: 'dot', // Circular corner dots
        color: '#ff0000', // Red corner markers
      },
      ...(logo && {
        image: logo,
      }),
    });

    // Generate and return as data URL
    return new Promise((resolve, reject) => {
      qrCode.getRawData('png').then((blob) => {
        if (!blob) {
          reject(new Error('Failed to generate QR code'));
          return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result as string);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }).catch(reject);
    });
  }

  /**
   * Generate a QR code for event check-in
   * Uses the event code to create a URL-based QR code
   * URL is configured via VITE_APP_URL environment variable
   */
  static async generateEventQRCode(
    eventCode: string,
    options?: Partial<QRCodeOptions>
  ): Promise<string> {
    const appUrl = import.meta.env.VITE_APP_URL || 'https://www.tech.tickets';
    const url = `${appUrl}/event/${eventCode}`;

    return this.generateQRCode({
      data: url,
      size: 300,
      margin: 0,
      errorCorrectionLevel: 'M',
      ...options,
    });
  }

  /**
   * Download a QR code as PNG
   * URL is configured via VITE_APP_URL environment variable
   */
  static async downloadQRCode(
    eventCode: string,
    filename: string,
    size: number = 1000
  ): Promise<void> {
    const appUrl = import.meta.env.VITE_APP_URL || 'https://www.tech.tickets';
    const url = `${appUrl}/event/${eventCode}`;

    const qrCode = new QRCodeStyling({
      width: size,
      height: size,
      type: 'canvas',
      shape: 'square',
      data: url,
      margin: 20,
      qrOptions: {
        typeNumber: 0,
        mode: 'Byte',
        errorCorrectionLevel: 'M',
      },
      dotsOptions: {
        type: 'dots',
        color: '#000000',
        roundSize: true,
      },
      backgroundOptions: {
        round: 0,
        color: '#ffffff',
      },
      cornersSquareOptions: {
        type: 'dot',
        color: '#ff0000',
      },
      cornersDotOptions: {
        type: 'dot',
        color: '#ff0000',
      },
    });

    await qrCode.download({
      name: filename,
      extension: 'png',
    });
  }
}
