import { environment } from '../../../environments/environment';

/**
 * Public URL for a `site_snapshots.storage_path`.
 *
 * The bucket is public read, so this is a plain `<img src>` with no client and no signing:
 * the contents are captures of websites already reachable by anyone, and a private bucket
 * would need the storage client `core/supabase.service.ts` deliberately dropped on 13 Aug
 * to get ~98 kB out of the initial bundle.
 *
 * It lives here rather than in `core/supabase.service.ts` because that file exports exactly
 * `auth` and `db` and widening it invites the next person to reach for a storage client.
 */
export function snapshotUrl(storagePath: string): string {
  return `${environment.supabaseUrl}/storage/v1/object/public/site-snapshots/${storagePath}`;
}
