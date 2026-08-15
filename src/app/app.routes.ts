import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'style',
    loadComponent: () => import('./style-tile/style-tile').then((m) => m.StyleTile),
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [() => authGuard()],
    loadComponent: () => import('./layout/app-layout').then((m) => m.AppLayout),
    children: [
      { path: '', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard) },
      { path: 'leads', loadComponent: () => import('./features/leads/leads-grid/leads-grid').then((m) => m.LeadsGrid) },

      // The deep link for one lead. `?lead=` retired with spec 0005 — the drawer is now a
      // read-only preview and this page is the only place status and notes are written.
      { path: 'leads/:id', loadComponent: () => import('./features/leads/lead-detail/lead-detail').then((m) => m.LeadDetail) },

      // `new` must be declared before `:id`, or the builder route is swallowed as a scan
      // whose id is the literal string "new".
      { path: 'scans/new', loadComponent: () => import('./features/scans/scan-builder/scan-builder').then((m) => m.ScanBuilder) },

      // Realtime lives behind this lazy boundary. `@supabase/realtime-js` is imported
      // dynamically inside features/scans/realtime.ts so it lands in this route's chunk
      // and never in `main` — see AGENTS.md on the composed Supabase client.
      { path: 'scans/:id', loadComponent: () => import('./features/scans/live-scan/live-scan').then((m) => m.LiveScan) },
    ],
  },
];
