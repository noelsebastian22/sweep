import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/**
 * The one Supabase client instance for the app. AuthStore and every feature store
 * (leads.store.ts, scan.store.ts, ...) import this rather than constructing their own,
 * so they all share one session and one realtime connection.
 */
export const supabase: SupabaseClient = createClient(
  environment.supabaseUrl,
  environment.supabasePublishableKey,
  { auth: { autoRefreshToken: true, persistSession: true } },
);
