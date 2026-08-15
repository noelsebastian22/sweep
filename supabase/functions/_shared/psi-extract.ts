// The PageSpeed call, the metric extraction, the screenshot decode and the Storage upload.
// Shared by `tick/psi.ts` (measures a whole scan) and `recheck-psi` (measures one business
// on demand), so the two can never disagree about what a measurement *is*.
//
// AGENTS.md hard rule 4: never store raw PageSpeed JSON — a single response is ~600 KB
// against a 500 MB tier. The parsed response is local to runPsi() and is discarded when it
// returns; only the six metric values and the screenshot bytes survive.
//
// See db.ts on redeploying both functions when anything here changes.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PsiOutcome {
  httpStatus: number | null;
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  siMs: number | null;
  error: string | null;
  /**
   * Decoded `final-screenshot` JPEG bytes, or null when the audit was absent/undecodable.
   *
   * Explicitly `Uint8Array<ArrayBuffer>`, not the bare `Uint8Array` (which widens to
   * `ArrayBufferLike` and so includes `SharedArrayBuffer`). `BodyInit` accepts only the
   * former, so the narrower type is what lets these bytes be handed straight to `fetch`
   * without a cast.
   */
  screenshot: Uint8Array<ArrayBuffer> | null;
}

/**
 * Lighthouse returns the screenshot as a data URI inside the `final-screenshot` audit.
 * It is always JPEG in practice, and the bucket only allows `image/jpeg`, so anything
 * else is treated as "no screenshot" rather than uploaded and rejected at the far end.
 */
function decodeFinalScreenshot(audits: Record<string, unknown>): Uint8Array<ArrayBuffer> | null {
  const audit = audits['final-screenshot'] as { details?: { data?: unknown } } | undefined;
  const data = audit?.details?.data;
  if (typeof data !== 'string') return null;

  const match = /^data:image\/jpeg;base64,(.+)$/s.exec(data);
  if (!match) return null;

  try {
    const binary = atob(match[1]);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null; // a truncated or malformed payload is not worth failing a measurement over
  }
}

// Two-attempt retry, 4xx early exit — ported verbatim from harvest.mjs's psi().
export async function runPsi(url: string): Promise<PsiOutcome> {
  const q = new URLSearchParams({
    url, strategy: 'mobile', category: 'performance', key: Deno.env.get('GOOGLE_PSI_API_KEY')!,
  });
  let last: string | null = null;
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`);
      lastStatus = res.status;
      if (res.ok) {
        const json = await res.json();
        const audits = json?.lighthouseResult?.audits ?? {};
        const s = json?.lighthouseResult?.categories?.performance?.score;
        return {
          httpStatus: res.status,
          score: s == null ? null : Math.round(s * 100),
          lcpMs: audits['largest-contentful-paint']?.numericValue != null ? Math.round(audits['largest-contentful-paint'].numericValue) : null,
          cls: audits['cumulative-layout-shift']?.numericValue ?? null,
          tbtMs: audits['total-blocking-time']?.numericValue != null ? Math.round(audits['total-blocking-time'].numericValue) : null,
          fcpMs: audits['first-contentful-paint']?.numericValue != null ? Math.round(audits['first-contentful-paint'].numericValue) : null,
          siMs: audits['speed-index']?.numericValue != null ? Math.round(audits['speed-index'].numericValue) : null,
          error: s == null ? 'no score returned' : null,
          screenshot: decodeFinalScreenshot(audits),
        };
      }
      last = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break; // 4xx won't fix itself
    } catch (e) {
      last = String(e).slice(0, 40);
    }
    await sleep(3000);
  }
  return {
    httpStatus: lastStatus, score: null, lcpMs: null, cls: null, tbtMs: null, fcpMs: null,
    siMs: null, error: last || 'unreachable', screenshot: null,
  };
}

/** `<tenant_id>/<business_id>/<psi_result_id>.jpg` — unique per measurement by construction. */
export function snapshotPath(tenantId: string, businessId: string, psiResultId: string | number): string {
  return `${tenantId}/${businessId}/${psiResultId}.jpg`;
}

/**
 * Uploads the JPEG exactly as PageSpeed returned it. No WebP conversion: it would save
 * ~20 kB a capture (~9 MB against a 1 GB tier) in exchange for a pinned WASM codec and its
 * cold start inside the function that gates spending. Deferred with a trigger at 300 MB of
 * Storage — see spec 0005's Follow-up.
 *
 * `POST`, not `PUT`. In the Storage REST API `POST /object/{bucket}/{path}` creates and
 * `PUT` replaces something that already exists, so a `PUT` fails on every first capture.
 * `?upsert=true` as a query parameter is ignored — upsert is the `x-upsert` header. Paths
 * are unique per psi_result_id anyway, so the header is belt and braces.
 *
 * A raw fetch rather than a storage client: the functions import only `postgres` and
 * `supabase-js`, and pulling in storage-js for one POST is not worth the bundle.
 *
 * Returns null on success, or a short error string. An upload failure is never fatal — the
 * measurement itself stands.
 */
export async function uploadSnapshot(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return 'storage not configured';

  try {
    const res = await fetch(`${url}/storage/v1/object/site-snapshots/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
      },
      body: bytes,
    });
    if (!res.ok) return `HTTP ${res.status}`.slice(0, 60);
    return null;
  } catch (e) {
    return String(e).slice(0, 60);
  }
}
