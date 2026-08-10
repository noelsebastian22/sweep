import { Component, inject } from '@angular/core';
import { AuthStore } from '../../stores/auth.store';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  template: `
    <div style="max-width:960px;">
      <h1 style="font-family:'Geist Sans',sans-serif;font-size:20px;font-weight:600;line-height:1.3;color:var(--color-sw-ink);margin:0 0 4px;">Welcome{{ authStore.email() ? ', ' + authStore.email() : '' }}</h1>
      <p style="font-size:15px;line-height:1.5;color:var(--color-sw-ink-mid);margin:0 0 32px;">Your sweep dashboard is ready.</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px;">
        <div style="padding:24px;border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);display:flex;flex-direction:column;gap:4px;">
          <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);line-height:1;">Scans run</span>
          <span data-mono style="font-size:30px;font-weight:500;color:var(--color-sw-ink);line-height:1;">0</span>
        </div>
        <div style="padding:24px;border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);display:flex;flex-direction:column;gap:4px;">
          <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);line-height:1;">Leads found</span>
          <span data-mono style="font-size:30px;font-weight:500;color:var(--color-sw-ink);line-height:1;">0</span>
        </div>
        <div style="padding:24px;border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);display:flex;flex-direction:column;gap:4px;">
          <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);line-height:1;">Free allowance</span>
          <span data-mono style="font-size:30px;font-weight:500;color:var(--color-sw-ink);line-height:1;">1,000</span>
        </div>
      </div>
    </div>
  `,
})
export class Dashboard {
  readonly authStore = inject(AuthStore);
}
