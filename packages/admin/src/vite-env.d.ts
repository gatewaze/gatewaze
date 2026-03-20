/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_API_BASE_URL: string
  readonly VITE_APP_URL: string
  readonly VITE_CUSTOMERIO_SITE_ID: string
  readonly VITE_CUSTOMERIO_API_KEY: string
  readonly VITE_BRAND_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// SVG imports with ?react query
declare module '*.svg?react' {
  import * as React from 'react';
  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

// Regular SVG imports
declare module '*.svg' {
  const content: string;
  export default content;
}
