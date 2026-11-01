/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_FUNCTIONS_BASE?: string;
  readonly VITE_ASK_EMAIL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
