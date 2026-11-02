// eslint-config-next 16 ships native flat configs, so no FlatCompat bridge.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default [
  { ignores: ['.next/**', '.open-next/**', '.wrangler/**', 'node_modules/**', 'next-env.d.ts', 'public/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Style/pre-existing noise -> warnings so lint runs green; tighten over time.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@next/next/no-img-element': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      // Intentional in error/404 boundaries (a full-reload <a href="/"> recovers
      // from a broken client state better than <Link>) and specific inline
      // scripts. Warn rather than error; revisit case-by-case.
      '@next/next/no-html-link-for-pages': 'warn',
      '@next/next/no-sync-scripts': 'warn',
      // React Compiler rules that eslint-plugin-react-hooks 7 turned on with
      // eslint-config-next 16. They flag existing code (76 sites at the
      // upgrade), so warn for now and fix them as those files are touched.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
];
