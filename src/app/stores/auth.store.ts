import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, withHooks, patchState } from '@ngrx/signals';
import { Session, User } from '@supabase/auth-js';
import { auth, db } from '../core/supabase.service';

interface AuthState {
  session: Session | null;
  user: User | null;
  tenantId: string | null;
  isDemo: boolean;
  loading: boolean;
}

const initial: AuthState = { session: null, user: null, tenantId: null, isDemo: false, loading: true };

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withComputed(({ user, loading }) => ({
    isAuthenticated: computed(() => !!user() && !loading()),
    email: computed(() => user()?.email ?? null),
  })),
  withMethods((store) => {
    let readyResolve: (() => void) | null = null;
    const readyPromise = new Promise<void>((resolve) => { readyResolve = resolve; });

    return {
      async init() {
        const { data } = await auth.getSession();
        if (data.session) {
          const p = await loadProfile(data.session.user.id);
          patchState(store, { session: data.session, user: data.session.user, tenantId: p?.tenant_id ?? null, isDemo: p?.isDemo ?? false, loading: false });
        } else {
          patchState(store, { loading: false });
        }
        readyResolve?.();

        auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session) {
            const p = await loadProfile(session.user.id);
            patchState(store, { session, user: session.user, tenantId: p?.tenant_id ?? null, isDemo: p?.isDemo ?? false, loading: false });
          } else if (event === 'SIGNED_OUT') {
            patchState(store, { session: null, user: null, tenantId: null, isDemo: false, loading: false });
          }
        });
      },

      whenReady(): Promise<void> {
        return readyPromise;
      },

      async signIn(email: string, password: string): Promise<string | null> {
        const { error } = await auth.signInWithPassword({ email, password });
        return error?.message ?? null;
      },

      async signOut() {
        await auth.signOut();
      },
    };
  }),
  withHooks({
    onInit(store) {
      store.init();
    },
  }),
);

async function loadProfile(userId: string) {
  const { data } = await db
    .from('profiles')
    .select('tenant_id, tenants(is_demo)')
    .eq('id', userId)
    .single();
  if (!data) return null;
  // Supabase's string-parsed types can't see the tenant_id FK is single-valued, so it
  // infers the embed as an array even though PostgREST returns one row for a to-one join.
  const tenantsField: unknown = data.tenants;
  const tenant = (Array.isArray(tenantsField) ? tenantsField[0] : tenantsField) as { is_demo?: boolean } | null;
  return { tenant_id: data.tenant_id, isDemo: tenant?.is_demo ?? false };
}
