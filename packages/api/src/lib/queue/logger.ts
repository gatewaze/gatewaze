import pino from 'pino';

const brand = process.env.BRAND ?? 'default';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { brand, service: process.env.GATEWAZE_SERVICE ?? 'api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'data.html',
      '*.password',
      '*.token',
      '*.secret',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});

export type QueueLogger = pino.Logger;
