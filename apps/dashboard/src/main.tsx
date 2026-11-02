import { createRoot } from 'react-dom/client';
import { config } from './config';
import './styles/tokens.css';
import './styles/base.css';

// No StrictMode on purpose: a sign-in link works once, and StrictMode runs effects twice in development.
const root = createRoot(document.getElementById('root')!);

if (!config.ok) {
  // A build without its service address is a developer error (scripts/build-staging.mjs refuses to build one); the plan has no wording for it.
  console.error('This build has no VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.');
  root.render(<main />);
} else {
  void import('./App').then(({ App }) => root.render(<App />));
}
