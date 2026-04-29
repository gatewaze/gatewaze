// Set environment variables before any imports
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
// Bypass requireJwt() for whole-app integration tests. The auth-specific
// tests in src/lib/auth/__tests__/require-jwt.test.ts clear this var to
// exercise the real verification path.
process.env.GATEWAZE_TEST_DISABLE_AUTH = '1';
process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod-do-not-use-do-not-use';
