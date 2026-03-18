// Load environment variables before any other modules
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// Check if we're running with a specific brand
const brandId = process.env.VITE_BRAND_ID || process.env.BRAND;

if (brandId) {
  // In Docker, env vars are injected via env_file - check if they're already loaded
  if (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY) {
    console.log(`✅ Environment variables already loaded (brand: ${brandId})`);
  } else {
    // Load brand-specific environment file with override to ensure correct values
    const brandEnvFile = `.env.${brandId}.local`;
    const brandResult = dotenv.config({ path: resolve(rootDir, brandEnvFile), override: true });

    if (brandResult.error) {
      console.error(`❌ Error loading ${brandEnvFile}:`, brandResult.error);
      process.exit(1);
    } else {
      console.log(`✅ Loaded ${Object.keys(brandResult.parsed).length} environment variables from ${brandEnvFile} (with override)`);
    }
  }
} else {
  // Legacy behavior: try .env and .env.local
  // Load .env from project root
  const result = dotenv.config({ path: resolve(rootDir, '.env') });

  if (result.error) {
    // Don't exit if .env doesn't exist, just log it
    if (result.error.code === 'ENOENT') {
      console.log('📝 No .env file found, using brand-specific environment files');
    } else {
      console.error('❌ Error loading .env file:', result.error);
      process.exit(1);
    }
  } else if (!result.parsed) {
    console.warn('⚠️  No environment variables loaded from .env file');
  } else {
    console.log(`✅ Loaded ${Object.keys(result.parsed).length} environment variables from .env`);
  }

  // Also try to load .env.local (overrides .env) - but only if no brand is specified
  // This prevents .env.local from overwriting brand-specific values
  const localResult = dotenv.config({ path: resolve(rootDir, '.env.local'), override: false });
  if (localResult.parsed) {
    console.log(`✅ Loaded ${Object.keys(localResult.parsed).length} environment variables from .env.local (no override)`);
  }
}
