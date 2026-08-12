import { Component, inject, ChangeDetectionStrategy, DestroyRef } from '@angular/core';
import { RouterModule, RouterOutlet } from '@angular/router';
import { AuthStore } from '../stores/auth.store';
import { KeyboardService } from '../core/keyboard.service';
import { CommandPalette } from '../shared/ui/command-palette/command-palette';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterModule, RouterOutlet, CommandPalette],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div style="min-height:100dvh;display:flex;flex-direction:column;">
      <header style="display:flex;align-items:center;justify-content:space-between;height:56px;padding:0 24px;border-bottom:1px solid var(--color-sw-rule);background:var(--color-sw-surface);flex-shrink:0;">
        <a routerLink="/" style="font-family:'Geist Sans',sans-serif;font-size:18px;font-weight:600;color:var(--color-sw-ink);text-decoration:none;">Sweep</a>
        <nav style="display:flex;align-items:center;gap:20px;">
          <a routerLink="/leads" style="font-family:'Geist Sans',sans-serif;font-size:14px;color:var(--color-sw-ink-mid);text-decoration:none;">Leads</a>
        </nav>
        <div style="display:flex;align-items:center;gap:16px;">
          <span data-mono style="font-size:13px;color:var(--color-sw-ink-mid);">{{ authStore.email() }}</span>
          <button
            (click)="signOut()"
            style="display:inline-flex;align-items:center;height:32px;padding:0 12px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:white;color:var(--color-sw-violet);font-family:'Geist Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;"
          >Sign out</button>
        </div>
      </header>
      <main style="flex:1;padding:32px;">
        <router-outlet />
      </main>
      <app-command-palette />
    </div>
  `,
})
export class AppLayout {
  readonly authStore = inject(AuthStore);
  private readonly keyboard = inject(KeyboardService);

  constructor() {
    this.keyboard.bindGlobalListener();
    inject(DestroyRef).onDestroy(() => this.keyboard.unbindGlobalListener());
  }

  async signOut() {
    await this.authStore.signOut();
  }
}
