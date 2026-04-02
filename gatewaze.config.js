const config = {
    name: process.env.INSTANCE_NAME || 'Gatewaze',
    platformVersion: '1.0.0',
    auth: {
        provider: process.env.AUTH_PROVIDER || 'supabase',
        oidc: {
            issuerUrl: process.env.OIDC_ISSUER_URL,
            clientId: process.env.OIDC_CLIENT_ID,
            clientSecret: process.env.OIDC_CLIENT_SECRET,
        },
    },
    email: {
        provider: process.env.EMAIL_PROVIDER || 'sendgrid',
    },
    // Module sources — directories containing module packages.
    // Can be local paths (relative to project root) or git repo URLs.
    // Examples:
    //   '../gatewaze-modules/modules'              — local sibling folder (default)
    //   './custom-modules'                          — local folder in project
    //   'https://github.com/org/modules.git'        — git repo (cloned at build time)
    //   { url: 'https://github.com/gatewaze/gatewaze-modules.git', path: 'modules', branch: 'main' }
    moduleSources: [
        // Local sibling repos (development — skipped if not present)
        '../gatewaze-modules/modules',
        // Git source for production — seeded into module_sources DB table on first run
        { url: 'https://github.com/gatewaze/gatewaze-modules.git', path: 'modules', branch: 'main' },
    ],
    // All modules found in moduleSources are included automatically.
    // To limit to a subset, add a "modules" array with specific package names.
    // Enable/disable per-instance is controlled via the Modules admin page.
};
export default config;
//# sourceMappingURL=gatewaze.config.js.map