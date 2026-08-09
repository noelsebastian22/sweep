import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'style',
    loadComponent: () => import('./style-tile/style-tile').then(m => m.StyleTile),
  },
  { path: '', redirectTo: '/style', pathMatch: 'full' },
];
