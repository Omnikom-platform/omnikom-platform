import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// One client for the whole app. The session lives in this browser's storage; the sign-in link is handled by /auth/confirm
// (verifyOtp with the token hash), so the client does not read tokens out of the address bar.
export const supabase = createClient(config.url, config.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'omnikom-dashboard-auth' },
});
