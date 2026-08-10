import { createClient } from 'jsr:@supabase/supabase-js@2';

const TRADES: [string, string | null][] = [
  ['Electrician', 'electrician'], ['Plumber', 'plumber'], ['Builder', 'general_contractor'],
  ['Carpenter', null], ['Landscaper', null], ['Painter', 'painter'],
  ['Roofer', 'roofing_contractor'], ['Concreter', null], ['Tiler', null],
  ['Plasterer', null], ['Bricklayer', null], ['Fencing', null],
  ['Arborist', null], ['Excavation', null], ['Joinery', null], ['Handyman', null],
];

interface SuburbSeed {
  name: string;
  lat: number;
  lng: number;
}

const SUBURBS: SuburbSeed[] = [
  { name: 'Katoomba',          lat: -33.7148, lng: 150.3114 },
  { name: 'Leura',             lat: -33.7167, lng: 150.3333 },
  { name: 'Blackheath',        lat: -33.6356, lng: 150.2847 },
  { name: 'Wentworth Falls',   lat: -33.7100, lng: 150.3767 },
  { name: 'Springwood',        lat: -33.6997, lng: 150.5622 },
  { name: 'Winmalee',          lat: -33.6725, lng: 150.6033 },
  { name: 'Faulconbridge',     lat: -33.6861, lng: 150.5314 },
  { name: 'Lawson',            lat: -33.7206, lng: 150.4303 },
  { name: 'Hazelbrook',        lat: -33.7236, lng: 150.4542 },
  { name: 'Woodford',          lat: -33.7333, lng: 150.4833 },
  { name: 'Glenbrook',         lat: -33.7667, lng: 150.6181 },
  { name: 'Blaxland',          lat: -33.7442, lng: 150.5956 },
  { name: 'Warrimoo',          lat: -33.7231, lng: 150.5892 },
  { name: 'Mount Victoria',    lat: -33.5908, lng: 150.2556 },
  { name: 'Medlow Bath',       lat: -33.6706, lng: 150.2897 },
  { name: 'Bullaburra',        lat: -33.7278, lng: 150.4167 },
  { name: 'Linden',            lat: -33.7156, lng: 150.4981 },
  { name: 'Valley Heights',    lat: -33.7017, lng: 150.5806 },
];

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function readAuthHeader(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new Response(JSON.stringify({ error: 'Missing service role bearer token' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  return auth.slice(7);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = await readAuthHeader(req);
  if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return new Response(JSON.stringify({ error: 'Invalid bearer token' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = serviceClient();

  // Check if already seeded
  const { count } = await supabase.from('tenants').select('*', { count: 'exact', head: true });
  if (count && count > 0) {
    return new Response(JSON.stringify({ error: 'Already seeded', tenants: count }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create tenants
  const { data: tenants } = await supabase
    .from('tenants')
    .insert([
      { name: 'Noel', is_demo: false },
      { name: 'Demo',  is_demo: true },
    ])
    .select();
  if (!tenants) throw new Error('Failed to create tenants');
  const [noelTenant, demoTenant] = tenants;

  // Create auth users
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const noelEmail = 'noel@nooel-sebastian.com';
  const demoEmail = 'demo@sweep.local';
  // TODO: move to Supabase secrets once CLI is logged in
  const demoPassword = 'demo1234!';

  // Check existing users (idempotent)
  const { data: existingUsers } = await adminClient.auth.admin.listUsers();

  let noelUser = existingUsers?.users.find((u) => u.email === noelEmail);
  if (!noelUser) {
    const { data: created } = await adminClient.auth.admin.createUser({
      email: noelEmail,
      email_confirm: true,
      password: Deno.env.get('NOEL_PASSWORD') || demoPassword,
    });
    if (created.user) noelUser = created.user;
  }

  let demoUser = existingUsers?.users.find((u) => u.email === demoEmail);
  if (!demoUser) {
    const { data: created } = await adminClient.auth.admin.createUser({
      email: demoEmail,
      email_confirm: true,
      password: demoPassword,
    });
    if (created.user) demoUser = created.user;
  }

  if (!noelUser || !demoUser) throw new Error('Failed to create or find auth users');

  // Create profiles (idempotent)
  await supabase
    .from('profiles')
    .upsert([
      { id: noelUser.id, tenant_id: noelTenant.id, email: noelEmail },
      { id: demoUser.id, tenant_id: demoTenant.id, email: demoEmail },
    ], { onConflict: 'id' });

  // Create Blue Mountains region
  const { data: regions } = await supabase
    .from('regions')
    .insert({ tenant_id: noelTenant.id, name: 'Blue Mountains' })
    .select();
  if (!regions) throw new Error('Failed to create region');
  const region = regions[0];

  // Create trades
  const tradeRows = TRADES.map(([name, google_type]) => ({
    tenant_id: noelTenant.id,
    name,
    google_type,
    active: true,
  }));
  const { data: trades } = await supabase
    .from('trades')
    .upsert(tradeRows, { onConflict: 'tenant_id, name', ignoreDuplicates: true })
    .select();

  // Create suburbs
  const suburbRows = SUBURBS.map((s) => ({
    region_id: region.id,
    name: s.name,
    state: 'NSW',
    lat: s.lat,
    lng: s.lng,
  }));
  const { data: suburbs } = await supabase
    .from('suburbs')
    .upsert(suburbRows, { onConflict: 'region_id, name', ignoreDuplicates: true })
    .select();

  // Create api_budgets
  const budgetsFor = (tenantId: string) => [
    {
      tenant_id: tenantId, api: 'places_text_search', sku: 'enterprise',
      unit_cost_usd: 0.035, free_allowance: 1000,
      allow_paid: false, granted_usd: 0,
    },
    {
      tenant_id: tenantId, api: 'psi', sku: 'free',
      unit_cost_usd: 0, free_allowance: 25000,
      allow_paid: true, granted_usd: 0,
    },
  ];

  await supabase
    .from('api_budgets')
    .upsert(
      [...budgetsFor(noelTenant.id), ...budgetsFor(demoTenant.id)],
      { onConflict: 'tenant_id, api, sku', ignoreDuplicates: true },
    );

  return new Response(JSON.stringify({
    tenants: 2,
    trades: tradeRows.length,
    suburbs: suburbRows.length,
    budgets: 4,
    users: 2,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
