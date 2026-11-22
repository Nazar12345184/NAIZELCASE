import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://jnrpjwvmruwbnovlurcu.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rx9UIQaKoxVQzRwrVStrDg_Q_jA5mkK";
export const STEAM_AUTH_URL = `${SUPABASE_URL}/functions/v1/steam-auth`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
