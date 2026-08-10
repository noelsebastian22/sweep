import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../stores/auth.store';

export function authGuard() {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  return authStore.whenReady().then(() => {
    return authStore.user() ? true : router.parseUrl('/login');
  });
}
