/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set at build time in the Docker image: refuse the browser-only demo fallback. */
  readonly VITE_REQUIRE_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
