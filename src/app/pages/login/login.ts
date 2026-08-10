import { Component, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthStore } from '../../stores/auth.store';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100dvh;background:var(--color-sw-bg);padding:24px;">
      <div style="width:100%;max-width:400px;display:flex;flex-direction:column;gap:24px;">
        <div>
          <h1 style="font-family:'Geist Sans',sans-serif;font-size:clamp(2.25rem,3.6vw,3.25rem);font-weight:700;line-height:0.95;letter-spacing:-0.02em;color:var(--color-sw-ink);margin:0 0 8px;">Sweep</h1>
          <p style="font-size:15px;line-height:1.5;color:var(--color-sw-ink-mid);margin:0;">Sign in to your account</p>
        </div>

        <form (ngSubmit)="submit()" style="display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;flex-direction:column;gap:6px;">
            <label data-mono for="email" style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);">Email</label>
            <input
              id="email"
              type="email"
              [(ngModel)]="email"
              name="email"
              required
              autocomplete="email"
              [disabled]="submitting()"
              style="height:40px;padding:0 12px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:var(--color-sw-surface-2);font-family:'Geist Sans',sans-serif;font-size:15px;color:var(--color-sw-ink);outline:none;"
            />
          </div>

          <div style="display:flex;flex-direction:column;gap:6px;">
            <label data-mono for="password" style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);">Password</label>
            <input
              id="password"
              type="password"
              [(ngModel)]="password"
              name="password"
              required
              autocomplete="current-password"
              [disabled]="submitting()"
              style="height:40px;padding:0 12px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:var(--color-sw-surface-2);font-family:'Geist Sans',sans-serif;font-size:15px;color:var(--color-sw-ink);outline:none;"
            />
          </div>

          @if (error()) {
            <div style="padding:10px 12px;border-radius:var(--radius-sw-sm);background:var(--color-sw-fail);color:white;font-size:14px;line-height:1.4;">{{ error() }}</div>
          }

          <button
            type="submit"
            [disabled]="submitting()"
            style="display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 24px;border:none;border-radius:var(--radius-sw);background:var(--color-sw-violet);color:white;font-family:'Geist Sans',sans-serif;font-size:15px;font-weight:500;cursor:pointer;margin-top:4px;"
            [style.opacity]="submitting() ? '0.6' : '1'"
          >
            {{ submitting() ? 'Signing in\u2026' : 'Sign in' }}
          </button>
        </form>
      </div>
    </div>
  `,
})
export class Login {
  readonly email = signal('demo@sweep.local');
  readonly password = signal('demo1234!');
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  private authStore = inject(AuthStore);
  private router = inject(Router);

  async submit() {
    this.error.set(null);
    this.submitting.set(true);
    const err = await this.authStore.signIn(this.email(), this.password());
    if (err) {
      this.error.set(err);
      this.submitting.set(false);
    } else {
      this.router.navigate(['/']);
    }
  }
}
