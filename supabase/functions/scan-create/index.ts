// scan-create — spec 0003 AC-1.
// Authenticated (the caller's own JWT). Derives region_id from suburb_ids, inserts the
// scans row, expands trade x suburb into scan_queries. Does NOT enqueue sweep_search —
// tick is the only place messages ever get enqueued (AC-2), which is what keeps exactly
// one scan's work in flight system-wide.

import { createClient } from 'jsr:@supabase/supabase-js@2';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing bearer token' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  let body: { trade_ids?: unknown; suburb_ids?: unknown; top_n?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const tradeIds = body.trade_ids;
  const suburbIds = body.suburb_ids;
  const topN = Number.isInteger(body.top_n) && (body.top_n as number) > 0 ? (body.top_n as number) : 50;

  if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
    return json({ error: 'trade_ids must be a non-empty array' }, 422);
  }
  if (!Array.isArray(suburbIds) || suburbIds.length === 0) {
    return json({ error: 'suburb_ids must be a non-empty array' }, 422);
  }

  // Resolve the caller's tenant explicitly — never a request body field, so it cannot be
  // spoofed. The scans_insert RLS policy re-checks this; this is what actually populates
  // the not-null column.
  const { data: tenantId, error: tenantErr } = await supabase.rpc('current_tenant');
  if (tenantErr || !tenantId) {
    return json({ error: 'Unable to resolve tenant for this token' }, 403);
  }

  const { data: suburbs, error: suburbErr } = await supabase
    .from('suburbs')
    .select('id, region_id')
    .in('id', suburbIds as string[]);
  if (suburbErr) return json({ error: suburbErr.message }, 500);
  if (!suburbs || suburbs.length !== (suburbIds as string[]).length) {
    return json({ error: 'One or more suburb_ids not found' }, 422);
  }
  const regionIds = [...new Set(suburbs.map((s) => s.region_id))];
  if (regionIds.length > 1) {
    return json({ error: 'suburb_ids must all belong to one region' }, 422);
  }
  const regionId = regionIds[0];

  const { data: trades, error: tradeErr } = await supabase
    .from('trades')
    .select('id')
    .in('id', tradeIds as string[]);
  if (tradeErr) return json({ error: tradeErr.message }, 500);
  if (!trades || trades.length !== (tradeIds as string[]).length) {
    return json({ error: 'One or more trade_ids not found' }, 422);
  }

  const totalQueries = (tradeIds as string[]).length * (suburbIds as string[]).length;

  const { data: scan, error: scanErr } = await supabase
    .from('scans')
    .insert({
      tenant_id: tenantId,
      region_id: regionId,
      status: 'queued',
      total_queries: totalQueries,
      config: { top_n: topN },
    })
    .select('id')
    .single();

  if (scanErr) {
    // The demo tenant's insert is rejected by RLS (not application code) — surfaces here
    // as a generic Postgres policy violation.
    const isRls = scanErr.message?.toLowerCase().includes('row-level security');
    return json({ error: scanErr.message }, isRls ? 403 : 500);
  }

  const queryRows = (tradeIds as string[]).flatMap((tradeId) =>
    (suburbIds as string[]).map((suburbId) => ({
      scan_id: scan.id,
      trade_id: tradeId,
      suburb_id: suburbId,
    })));

  const { error: queriesErr } = await supabase.from('scan_queries').insert(queryRows);
  if (queriesErr) {
    return json({ error: queriesErr.message }, 500);
  }

  return json({ scan_id: scan.id }, 200);
});
