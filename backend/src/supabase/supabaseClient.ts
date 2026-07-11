import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// Service-role key, not anon: settlement writes across predictions/
// model_event_results/event_payouts from trusted backend code. Distinct from
// the read-only role CLAUDE.md describes for LLM/MCP consumption of this DB.
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }
  return client;
}

export interface SupabasePingResult {
  reachable: true;
  models_count: number | null;
}

// Connectivity check with no side effects: head:true asks PostgREST for just
// a row count via the Prefer header, so this never fetches or writes actual
// rows. Targets `models` (small, seeded at migration time) purely because it
// confirms the schema migrations were applied too, not just that the URL/key
// are valid.
export async function pingSupabase(): Promise<SupabasePingResult> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("models")
    .select("model_name", { count: "exact", head: true });
  if (error) {
    throw new Error(`Supabase ping failed: ${error.message}`);
  }
  return { reachable: true, models_count: count };
}
