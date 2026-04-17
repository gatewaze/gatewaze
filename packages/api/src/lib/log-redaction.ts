/**
 * Log redaction utility.
 * Scrubs sensitive values from log payloads before they leave the process.
 */

const SENSITIVE_KEYS = new Set([
  'token',
  'token_enc',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'api_key',
  'password',
  'secret',
  'authorization',
  'service_role_key',
  'gatewaze_secrets_key',
  'gatewaze_secrets_key_old',
  'supabase_service_role_key',
  'supabase_access_token',
]);

const SENSITIVE_ENV_VALUES: string[] = [];

// Populate sensitive env values on module load
for (const key of [
  'GATEWAZE_SECRETS_KEY',
  'GATEWAZE_SECRETS_KEY_OLD',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
]) {
  const val = process.env[key];
  if (val && val.length > 4) {
    SENSITIVE_ENV_VALUES.push(val);
  }
}

/**
 * Redact sensitive values from an object (deep).
 * Returns a new object with sensitive values replaced by '****'.
 */
export function redactSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return redactString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitive);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '****';
      } else if (typeof value === 'string' && SENSITIVE_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''))) {
        result[key] = '****';
      } else {
        result[key] = redactSensitive(value);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Redact known sensitive env values from a string.
 */
function redactString(str: string): string {
  let result = str;
  for (const val of SENSITIVE_ENV_VALUES) {
    if (result.includes(val)) {
      result = result.replaceAll(val, '***');
    }
  }
  return result;
}

/**
 * Create a structured logger that automatically redacts sensitive data.
 */
export function createRedactedLogger(moduleId?: string) {
  const base = { module_id: moduleId };

  return {
    info(message: string, meta?: Record<string, unknown>) {
      console.log(JSON.stringify({ level: 'info', message, ...base, ...redactSensitive(meta) as object, ts: new Date().toISOString() }));
    },
    warn(message: string, meta?: Record<string, unknown>) {
      console.warn(JSON.stringify({ level: 'warn', message, ...base, ...redactSensitive(meta) as object, ts: new Date().toISOString() }));
    },
    error(message: string, meta?: Record<string, unknown>) {
      console.error(JSON.stringify({ level: 'error', message, ...base, ...redactSensitive(meta) as object, ts: new Date().toISOString() }));
    },
    debug(message: string, meta?: Record<string, unknown>) {
      if (process.env.LOG_LEVEL === 'debug') {
        console.debug(JSON.stringify({ level: 'debug', message, ...base, ...redactSensitive(meta) as object, ts: new Date().toISOString() }));
      }
    },
  };
}
