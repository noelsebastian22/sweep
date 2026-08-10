import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error } = await supabase.from('tenants').select('id').limit(1);
    if (error) throw error;
    return new Response(JSON.stringify({ status: 'ok', version: '1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ status: 'error', version: '1' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
