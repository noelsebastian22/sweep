import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

/* ---- WCAG 2.1 contrast ratio ---- */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hex: string, bg = '#FFFFFF'): number {
  const l1 = luminance(hexToRgb(hex));
  const l2 = luminance(hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ---- Token names with known hex values ---- */
interface SwatchInfo {
  name: string;
  hex: string;
  ratio: number;
}
const SWATCH_DATA: SwatchInfo[] = [
  { name: 'sw-bg', hex: '#FFFFFF', ratio: 0 },
  { name: 'sw-surface', hex: '#FBFBFD', ratio: 0 },
  { name: 'sw-surface-2', hex: '#F4F4F8', ratio: 0 },
  { name: 'sw-rule', hex: '#ECEEF5', ratio: 0 },
  { name: 'sw-rule-2', hex: '#D2DCE7', ratio: 0 },
  { name: 'sw-ink', hex: '#2C224E', ratio: 0 },
  { name: 'sw-ink-mid', hex: '#626879', ratio: 0 },
  { name: 'sw-ink-lo', hex: '#7E8497', ratio: 0 },
  { name: 'sw-violet', hex: '#6F58E3', ratio: 0 },
  { name: 'sw-violet-hi', hex: '#5A43D4', ratio: 0 },
  { name: 'sw-violet-soft', hex: '#EFECFC', ratio: 0 },
  { name: 'sw-heat-0', hex: '#C9CBD6', ratio: 0 },
  { name: 'sw-heat-1', hex: '#B3AEE8', ratio: 0 },
  { name: 'sw-heat-2', hex: '#9384EC', ratio: 0 },
  { name: 'sw-heat-3', hex: '#7660E5', ratio: 0 },
  { name: 'sw-heat-4', hex: '#5334C9', ratio: 0 },
  { name: 'sw-warn', hex: '#A06A1C', ratio: 0 },
  { name: 'sw-warn-bg', hex: '#FDF6E9', ratio: 0 },
  { name: 'sw-fail', hex: '#C0392B', ratio: 0 },
  { name: 'sw-ok', hex: '#1E7F5C', ratio: 0 },
].map(s => ({ ...s, ratio: contrastRatio(s.hex) }));

/* ---- Type scale ---- */
interface TypeSpec {
  token: string;
  size: string;
  lh: string;
  weight: number;
  family: 'sans' | 'mono';
  tracking?: string;
  transform?: string;
  use: string;
}

const TYPE_SCALE: TypeSpec[] = [
  { token: 'display-1', size: 'clamp(2.25rem, 3.6vw, 3.25rem)', lh: '0.95', weight: 700, family: 'sans', tracking: '-0.02em', use: 'Marketing hero' },
  { token: 'display-2', size: '36px', lh: '1.1', weight: 700, family: 'sans', use: 'Section headings' },
  { token: 'title', size: '20px', lh: '1.3', weight: 600, family: 'sans', use: 'Panel/screen titles' },
  { token: 'body-lg', size: '18px', lh: '1.5', weight: 400, family: 'sans', use: 'Hero subhead, detail prose' },
  { token: 'body', size: '15px', lh: '1.5', weight: 400, family: 'sans', use: 'Default UI text, nav' },
  { token: 'small', size: '13px', lh: '1.4', weight: 400, family: 'sans', use: 'Table cells, meta' },
  { token: 'label', size: '11px', lh: '1', weight: 500, family: 'mono', tracking: '0.14em', transform: 'uppercase', use: 'Stat labels' },
  { token: 'stat', size: '30px', lh: '1', weight: 500, family: 'mono', use: 'Big numerics' },
];

/* ---- Fake lead data ---- */
interface FakeLead {
  business_name: string;
  trade: string;
  suburb: string;
  rating: number;
  rating_count: number;
  website_kind: string | null;
  psi_score: number | null;
  status: string;
  score: number;
}

function heatSeverity(score: number): number {
  if (score >= 80) return 4;
  if (score >= 65) return 3;
  if (score >= 45) return 2;
  if (score >= 25) return 1;
  return 0;
}

function deriveScore(rating: number, rating_count: number, website_kind: string | null, psi_score: number | null): number {
  let s = (rating / 5) * 50 + (Math.min(rating_count, 100) / 100) * 20;
  if (website_kind === null || website_kind === 'None') s *= 0.5;
  else if (website_kind === 'Facebook only') s *= 0.8;
  if (psi_score !== null) s += (psi_score / 100) * 30;
  else s *= 0.7;
  return Math.round(Math.min(s, 100));
}

const FAKE_LEADS: FakeLead[] = [
  { business_name: 'Blue Mountains Plumbing', trade: 'Plumber', suburb: 'Katoomba', rating: 4.8, rating_count: 142, website_kind: 'Full site', psi_score: 82, status: 'new', score: 0 },
  { business_name: 'Springwood Electrical', trade: 'Electrician', suburb: 'Springwood', rating: 4.6, rating_count: 98, website_kind: 'Full site', psi_score: 74, status: 'shortlisted', score: 0 },
  { business_name: 'Lawson Roof Restorations', trade: 'Roofer', suburb: 'Lawson', rating: 4.9, rating_count: 56, website_kind: 'Full site', psi_score: 91, status: 'new', score: 0 },
  { business_name: 'Hazelbrook Carpentry', trade: 'Carpenter', suburb: 'Hazelbrook', rating: 4.3, rating_count: 34, website_kind: 'Facebook only', psi_score: 45, status: 'contacted', score: 0 },
  { business_name: 'Wentworth Falls Landscaping', trade: 'Landscaper', suburb: 'Wentworth Falls', rating: 4.7, rating_count: 78, website_kind: 'Full site', psi_score: 88, status: 'won', score: 0 },
  { business_name: 'Leura Paint & Decor', trade: 'Painter', suburb: 'Leura', rating: 4.5, rating_count: 112, website_kind: 'Full site', psi_score: 67, status: 'contacted', score: 0 },
  { business_name: 'Blackheath Heating', trade: 'HVAC', suburb: 'Blackheath', rating: 4.4, rating_count: 23, website_kind: 'None', psi_score: null, status: 'new', score: 0 },
  { business_name: 'Faulconbridge Fencing', trade: 'Fencer', suburb: 'Faulconbridge', rating: 4.2, rating_count: 19, website_kind: 'Facebook only', psi_score: 38, status: 'ignored', score: 0 },
  { business_name: 'Glenbrook Garage Doors', trade: 'Garage door installer', suburb: 'Glenbrook', rating: 4.6, rating_count: 67, website_kind: 'Full site', psi_score: 76, status: 'mockup_built', score: 0 },
  { business_name: 'Blaxland Bathroom Renos', trade: 'Bathroom renovator', suburb: 'Blaxland', rating: 4.8, rating_count: 88, website_kind: 'Full site', psi_score: 93, status: 'won', score: 0 },
  { business_name: 'Mount Victoria Stonework', trade: 'Stonemason', suburb: 'Mount Victoria', rating: 4.1, rating_count: 12, website_kind: 'None', psi_score: null, status: 'new', score: 0 },
  { business_name: 'Woodford Window Cleaning', trade: 'Window cleaner', suburb: 'Woodford', rating: 4.9, rating_count: 203, website_kind: 'Full site', psi_score: 59, status: 'contacted', score: 0 },
  { business_name: 'Linden Tree Services', trade: 'Arborist', suburb: 'Linden', rating: 4.3, rating_count: 45, website_kind: 'Facebook only', psi_score: 42, status: 'new', score: 0 },
  { business_name: 'Medlow Bath Masonry', trade: 'Bricklayer', suburb: 'Medlow Bath', rating: 4.7, rating_count: 31, website_kind: 'Full site', psi_score: 85, status: 'lost', score: 0 },
  { business_name: 'Valley Heights Concreting', trade: 'Concreter', suburb: 'Valley Heights', rating: 4.5, rating_count: 89, website_kind: 'Full site', psi_score: 71, status: 'replied', score: 0 },
  { business_name: 'Warrimoo Waterproofing', trade: 'Waterproofer', suburb: 'Warrimoo', rating: 4.0, rating_count: 15, website_kind: 'None', psi_score: null, status: 'rejected', score: 0 },
  { business_name: 'Bullaburra Builders', trade: 'Builder', suburb: 'Bullaburra', rating: 4.4, rating_count: 27, website_kind: 'Full site', psi_score: 63, status: 'new', score: 0 },
  { business_name: 'Sun Valley Security', trade: 'Security installer', suburb: 'Sun Valley', rating: 4.6, rating_count: 44, website_kind: 'Full site', psi_score: 79, status: 'shortlisted', score: 0 },
  { business_name: 'Yellow Rock Yard Care', trade: 'Gardener', suburb: 'Yellow Rock', rating: 4.8, rating_count: 156, website_kind: 'Full site', psi_score: 55, status: 'new', score: 0 },
  { business_name: 'Hawkesbury Heights Home', trade: 'Home theatre installer', suburb: 'Hawkesbury Heights', rating: 4.2, rating_count: 8, website_kind: 'None', psi_score: null, status: 'new', score: 0 },
].map(l => ({ ...l, score: deriveScore(l.rating, l.rating_count, l.website_kind, l.psi_score) }));

/* ---- Status display helper ---- */
function statusLabel(s: string): string {
  return s.replace(/_/g, ' ');
}

@Component({
  selector: 'app-style-tile',
  template: `
    <div class="tile-page">
      <header class="tile-header">
        <h1 class="tile-title" style="font-family: 'Geist Sans', sans-serif; font-size: clamp(2.25rem, 3.6vw, 3.25rem); font-weight: 700; line-height: 0.95; letter-spacing: -0.02em; color: var(--color-sw-ink); margin: 0 0 12px;">Style Tile &mdash; Sweep</h1>
        <p style="font-size: 18px; line-height: 1.5; color: var(--color-sw-ink-mid); margin: 0; max-width: 620px;">Weekend 0 quality gate. Every design token from BUILD-PLAN.md &sect;7 rendered at density.</p>
      </header>

      <main style="display: flex; flex-direction: column; gap: 64px;">

        <!-- Section 1: Colour swatches -->
        <section>
          <h2 style="font-family: 'Geist Sans', sans-serif; font-size: 20px; font-weight: 600; line-height: 1.3; color: var(--color-sw-ink); margin: 0 0 4px;">1. Colour tokens</h2>
          <p style="font-size: 15px; line-height: 1.5; color: var(--color-sw-ink-mid); margin: 0 0 24px;">Computed WCAG 2.1 contrast ratio against white. AA body = 4.5:1.</p>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;">
            @for (swatch of swatches; track swatch.name) {
              <div style="border: 1px solid var(--color-sw-rule); border-radius: var(--radius-sw); overflow: hidden;">
                <div [style.height.px]="56" [style.background]="swatch.hex" style="border-bottom: 1px solid var(--color-sw-rule);"></div>
                <div style="padding: 10px 12px; display: flex; flex-direction: column; gap: 2px;">
                  <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo);">{{ swatch.name }}</span>
                  <span data-mono style="font-size: 13px; color: var(--color-sw-ink-mid);">{{ swatch.hex }}</span>
                  <span data-mono [style.color]="swatch.ratio < 4.5 ? 'var(--color-sw-fail)' : 'var(--color-sw-ink-mid)'" style="font-size: 13px;">
                    {{ swatch.ratio.toFixed(1) }}:1
                    @if (swatch.ratio < 4.5) { <span style="background: var(--color-sw-fail); color: white; padding: 1px 5px; border-radius: 3px; font-size: 10px; margin-left: 4px; font-weight: 600;">FAIL</span> }
                  </span>
                </div>
              </div>
            }
          </div>
        </section>

        <!-- Section 2: Type scale -->
        <section>
          <h2 style="font-family: 'Geist Sans', sans-serif; font-size: 20px; font-weight: 600; line-height: 1.3; color: var(--color-sw-ink); margin: 0 0 4px;">2. Type scale</h2>
          <p style="font-size: 15px; line-height: 1.5; color: var(--color-sw-ink-mid); margin: 0 0 24px;">Geist Sans + Geist Mono, self-hosted. Every weight preloaded.</p>
          <div style="border: 1px solid var(--color-sw-rule); border-radius: var(--radius-sw); overflow: hidden;">
            @for (t of TYPE_SCALE; track t.token) {
              <div style="display: grid; grid-template-columns: 140px 180px 1fr; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--color-sw-rule); min-height: 56px;" [class]="t === TYPE_SCALE[TYPE_SCALE.length - 1] ? '' : ''">
                <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo);">{{ t.token }}</span>
                <span data-mono style="font-size: 13px; color: var(--color-sw-ink-mid);">{{ t.size }} / {{ t.lh }}{{ t.tracking ? ' / ' + t.tracking : '' }}</span>
                <span
                  [style.fontSize]="t.size"
                  [style.lineHeight]="t.lh"
                  [style.fontWeight]="t.weight"
                  [style.fontFamily]="fontFamily(t)"
                  [style.letterSpacing]="t.tracking ?? 'normal'"
                  [style.textTransform]="t.transform ?? 'none'"
                  style="color: var(--color-sw-ink); overflow: hidden; white-space: nowrap;"
                >{{ t.use }}</span>
              </div>
            }
          </div>
        </section>

        <!-- Section 3: Buttons -->
        <section>
          <h2 style="font-family: 'Geist Sans', sans-serif; font-size: 20px; font-weight: 600; line-height: 1.3; color: var(--color-sw-ink); margin: 0 0 4px;">3. Buttons</h2>
          <p style="font-size: 15px; line-height: 1.5; color: var(--color-sw-ink-mid); margin: 0 0 24px;">Primary and secondary, 56px marketing and 40px in-app heights. Rest, hover, focus visible, disabled.</p>

          @for (h of [56, 40]; track h) {
            <h3 style="font-family: 'Geist Sans', sans-serif; font-size: 15px; font-weight: 600; line-height: 1.5; color: var(--color-sw-ink); margin: 24px 0 12px;">{{ h }}px height</h3>
            <div style="display: flex; flex-wrap: wrap; gap: 24px; margin-bottom: 8px;">
              <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px;">
                <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo);">Rest</span>
                <button class="btn-primary" [style.height.px]="h">Primary</button>
                <button class="btn-secondary" [style.height.px]="h">Secondary</button>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px;">
                <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo);">Hover</span>
                <button class="btn-primary btn-primary-hover" [style.height.px]="h">Primary</button>
                <button class="btn-secondary btn-secondary-hover" [style.height.px]="h">Secondary</button>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px;">
                <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo);">Focus</span>
                <button class="btn-primary" [style.height.px]="h" style="outline: 2px solid var(--color-sw-violet); outline-offset: 2px;">Primary</button>
                <button class="btn-secondary" [style.height.px]="h" style="outline: 2px solid var(--color-sw-violet); outline-offset: 2px;">Secondary</button>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px;">
                <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo);">Disabled</span>
                <button class="btn-primary" [style.height.px]="h" disabled>Primary</button>
                <button class="btn-secondary" [style.height.px]="h" disabled>Secondary</button>
              </div>
            </div>
          }
        </section>

        <!-- Section 4: Inputs -->
        <section>
          <h2 style="font-family: 'Geist Sans', sans-serif; font-size: 20px; font-weight: 600; line-height: 1.3; color: var(--color-sw-ink); margin: 0 0 4px;">4. Inputs</h2>
          <p style="font-size: 15px; line-height: 1.5; color: var(--color-sw-ink-mid); margin: 0 0 24px;">Text input, select, checkbox, eyebrow pill. Each has a visible focus ring.</p>

          <div style="display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-end;">
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo);">Text input</span>
              <input type="text" class="tile-input" placeholder="Business name" value="Blue Mountains Plumbing">
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo);">Select</span>
              <select class="tile-input tile-select">
                <option>All trades</option>
                <option>Plumber</option>
                <option>Electrician</option>
              </select>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo);">Checkbox</span>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--color-sw-ink-mid); cursor: pointer;">
                <input type="checkbox" checked class="tile-checkbox">
                <span>Include contacted</span>
              </label>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 16px; margin-top: 24px;">
            <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo);">Eyebrow pill</span>
            <span class="eyebrow-pill">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L9 5l4.5.7L10.3 9.5 11 14 7 12 3 14l.7-4.5L1.5 5.7 6 5 7 1z" fill="#6F58E3"/></svg>
              Prospecting tool for local trades
            </span>
          </div>
        </section>

        <!-- Section 5: Hairline table -->
        <section>
          <h2 style="font-family: 'Geist Sans', sans-serif; font-size: 20px; font-weight: 600; line-height: 1.3; color: var(--color-sw-ink); margin: 0 0 4px;">5. Leads table</h2>
          <p style="font-size: 15px; line-height: 1.5; color: var(--color-sw-ink-mid); margin: 0 0 24px;">20 rows of realistic fake lead data. 44px rows, hairline separated, mono tabular numerics. Row 7 (Blackheath) has null PSI; row 20 has no website.</p>

          <div style="overflow-x: auto; border: 1px solid var(--color-sw-rule); border-radius: var(--radius-sw);">
            <table class="leads-table" style="width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.4;">
              <thead>
                <tr>
                  <th style="text-align: left; padding: 10px 12px; font-weight: 600; color: var(--color-sw-ink-lo); border-bottom: 1px solid var(--color-sw-rule); background: var(--color-sw-surface); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;">Business</th>
                  <th style="text-align: left; padding: 10px 12px; font-weight: 600; color: var(--color-sw-ink-lo); border-bottom: 1px solid var(--color-sw-rule); background: var(--color-sw-surface); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;">Trade</th>
                  <th style="text-align: left; padding: 10px 12px; font-weight: 600; color: var(--color-sw-ink-lo); border-bottom: 1px solid var(--color-sw-rule); background: var(--color-sw-surface); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;">Suburb</th>
                  <th style="text-align: right; padding: 10px 12px; font-weight: 600; color: var(--color-sw-ink-lo); border-bottom: 1px solid var(--color-sw-rule); background: var(--color-sw-surface); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;">Reviews</th>
                  <th style="text-align: right; padding: 10px 12px; font-weight: 600; color: var(--color-sw-ink-lo); border-bottom: 1px solid var(--color-sw-rule); background: var(--color-sw-surface); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;">Rating</th>
                  <th style="text-align: left; padding: 10px 12px; font-weight: 600; color: var(--color-sw-ink-lo); border-bottom: 1px solid var(--color-sw-rule); background: var(--color-sw-surface); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;">Website</th>
                  <th style="text-align: right; padding: 10px 12px; font-weight: 600; color: var(--color-sw-ink-lo); border-bottom: 1px solid var(--color-sw-rule); background: var(--color-sw-surface); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;">PSI</th>
                  <th style="text-align: right; padding: 10px 12px; font-weight: 600; color: var(--color-sw-ink-lo); border-bottom: 1px solid var(--color-sw-rule); background: var(--color-sw-surface); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;">Score</th>
                  <th style="text-align: left; padding: 10px 12px; font-weight: 600; color: var(--color-sw-ink-lo); border-bottom: 1px solid var(--color-sw-rule); background: var(--color-sw-surface); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;">Heat</th>
                  <th style="text-align: left; padding: 10px 12px; font-weight: 600; color: var(--color-sw-ink-lo); border-bottom: 1px solid var(--color-sw-rule); background: var(--color-sw-surface); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;">Status</th>
                </tr>
              </thead>
              <tbody>
                @for (lead of FAKE_LEADS; track lead.business_name) {
                  <tr>
                    <td style="padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-sw-rule); color: var(--color-sw-ink); vertical-align: middle; white-space: nowrap; font-weight: 500;">{{ lead.business_name }}</td>
                    <td style="padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-sw-rule); color: var(--color-sw-ink); vertical-align: middle; white-space: nowrap;">{{ lead.trade }}</td>
                    <td style="padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-sw-rule); color: var(--color-sw-ink); vertical-align: middle; white-space: nowrap;">{{ lead.suburb }}</td>
                    <td data-mono style="padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-sw-rule); color: var(--color-sw-ink); vertical-align: middle; white-space: nowrap; text-align: right;">{{ lead.rating_count }}</td>
                    <td data-mono style="padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-sw-rule); color: var(--color-sw-ink); vertical-align: middle; white-space: nowrap; text-align: right;">{{ lead.rating.toFixed(1) }}</td>
                    <td style="padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-sw-rule); color: var(--color-sw-ink); vertical-align: middle; white-space: nowrap;">{{ lead.website_kind ?? 'No website' }}</td>
                    <td data-mono style="padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-sw-rule); color: var(--color-sw-ink); vertical-align: middle; white-space: nowrap; text-align: right;">{{ lead.psi_score !== null ? lead.psi_score : '\u2014' }}</td>
                    <td data-mono style="padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-sw-rule); color: var(--color-sw-ink); vertical-align: middle; white-space: nowrap; text-align: right;">{{ lead.score }}</td>
                    <td style="padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-sw-rule); vertical-align: middle; white-space: nowrap;">
                      <span style="display: inline-block; width: 20px; height: 20px; border-radius: 4px; text-align: center; line-height: 20px; font-size: 11px; font-weight: 600; color: white;" [style.background]="'var(--color-sw-heat-' + heatSeverity(lead.score) + ')'">{{ heatSeverity(lead.score) }}</span>
                    </td>
                    <td style="padding: 0 12px; height: 44px; border-bottom: 1px solid var(--color-sw-rule); color: var(--color-sw-ink-mid); vertical-align: middle; white-space: nowrap; font-size: 12px; text-transform: capitalize;">{{ statusLabel(lead.status) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- Section 6: Stat blocks -->
        <section>
          <h2 style="font-family: 'Geist Sans', sans-serif; font-size: 20px; font-weight: 600; line-height: 1.3; color: var(--color-sw-ink); margin: 0 0 4px;">6. Stat blocks</h2>
          <p style="font-size: 15px; line-height: 1.5; color: var(--color-sw-ink-mid); margin: 0 0 24px;">11px uppercase tracked mono label above 30px mono number, four across.</p>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo); line-height: 1;">Total leads</span>
              <span data-mono style="font-size: 30px; font-weight: 500; color: var(--color-sw-ink); line-height: 1;">2,847</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo); line-height: 1;">Scans this month</span>
              <span data-mono style="font-size: 30px; font-weight: 500; color: var(--color-sw-ink); line-height: 1;">12</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo); line-height: 1;">Queries remaining</span>
              <span data-mono style="font-size: 30px; font-weight: 500; color: var(--color-sw-ink); line-height: 1;">856</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span data-mono style="font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--color-sw-ink-lo); line-height: 1;">Free allowance</span>
              <span data-mono style="font-size: 30px; font-weight: 500; color: var(--color-sw-ink); line-height: 1;">$0.00</span>
            </div>
          </div>
        </section>

        <!-- Section 7: Radar sweep -->
        <section>
          <h2 style="font-family: 'Geist Sans', sans-serif; font-size: 20px; font-weight: 600; line-height: 1.3; color: var(--color-sw-ink); margin: 0 0 4px;">7. Radar sweep</h2>
          <p style="font-size: 15px; line-height: 1.5; color: var(--color-sw-ink-mid); margin: 0 0 24px;">SVG conic gradient, 4s linear infinite. Two panels for honest readability comparison.</p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
            <div style="padding: 24px; border: 1px solid var(--color-sw-rule); border-radius: var(--radius-sw); display: flex; flex-direction: column; align-items: center; gap: 16px;">
              <svg viewBox="0 0 200 200" style="width: 200px; height: 200px;">
                <defs>
                  <radialGradient id="radar-fade" cx="50%" cy="50%">
                    <stop offset="0%" stop-color="rgba(111,88,227,0)" />
                    <stop offset="100%" stop-color="rgba(111,88,227,0.12)" />
                  </radialGradient>
                </defs>
                <circle cx="100" cy="100" r="96" fill="none" stroke="var(--color-sw-rule)" stroke-width="1"/>
                <circle cx="100" cy="100" r="96" fill="url(#radar-fade)"/>
                <g style="transform-origin: 100px 100px; animation: radar-spin 4s linear infinite;">
                  <line x1="100" y1="100" x2="100" y2="4" stroke="rgba(111,88,227,0.55)" stroke-width="2"/>
                  <circle cx="100" cy="4" r="4" fill="#6F58E3"/>
                </g>
              </svg>
              <p style="font-size: 14px; line-height: 1.5; color: var(--color-sw-ink-mid); text-align: center; max-width: 320px; margin: 0;">Light panel: the sweep reads but is subtle. Acceptable for a live scan indicator where the map carries the real information.</p>
            </div>
            <div style="padding: 24px; border: 1px solid var(--color-sw-rule); border-radius: var(--radius-sw); background: var(--color-sw-violet-soft); display: flex; flex-direction: column; align-items: center; gap: 16px;">
              <svg viewBox="0 0 200 200" style="width: 200px; height: 200px;">
                <defs>
                  <radialGradient id="radar-fade-2" cx="50%" cy="50%">
                    <stop offset="0%" stop-color="rgba(111,88,227,0)" />
                    <stop offset="100%" stop-color="rgba(111,88,227,0.18)" />
                  </radialGradient>
                </defs>
                <circle cx="100" cy="100" r="96" fill="none" stroke="var(--color-sw-rule)" stroke-width="1"/>
                <circle cx="100" cy="100" r="96" fill="url(#radar-fade-2)"/>
                <g style="transform-origin: 100px 100px; animation: radar-spin 4s linear infinite;">
                  <line x1="100" y1="100" x2="100" y2="4" stroke="rgba(111,88,227,0.7)" stroke-width="2"/>
                  <circle cx="100" cy="4" r="4" fill="#6F58E3"/>
                </g>
              </svg>
              <p style="font-size: 14px; line-height: 1.5; color: var(--color-sw-ink-mid); text-align: center; max-width: 320px; margin: 0;">Violet tinted panel: more readable against the light palette. This is the recommended variant for the live scan screen in Weekend 4.</p>
            </div>
          </div>
        </section>

      </main>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .tile-page {
      max-width: 1280px;
      margin: 0 auto;
      padding: 40px 64px 80px;
    }

    .btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 24px;
      border: none;
      border-radius: var(--radius-sw);
      background: var(--color-sw-violet);
      color: white;
      font-family: 'Geist Sans', sans-serif;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      min-width: 120px;
    }

    .btn-primary-hover {
      background: var(--color-sw-violet-hi);
    }

    .btn-primary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .btn-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 24px;
      border: 1px solid var(--color-sw-rule-2);
      border-radius: var(--radius-sw);
      background: white;
      color: var(--color-sw-violet);
      font-family: 'Geist Sans', sans-serif;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      min-width: 120px;
    }

    .btn-secondary-hover {
      background: var(--color-sw-surface-2);
    }

    .btn-secondary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .tile-input {
      height: 40px;
      padding: 0 12px;
      border: 1px solid var(--color-sw-rule-2);
      border-radius: var(--radius-sw-sm);
      background: var(--color-sw-surface-2);
      font-family: 'Geist Sans', sans-serif;
      font-size: 15px;
      color: var(--color-sw-ink);
      min-width: 200px;
      outline: none;
    }

    .tile-input:focus-visible {
      outline: 2px solid var(--color-sw-violet);
      outline-offset: 0;
      border-color: var(--color-sw-violet);
    }

    .tile-select {
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23626879' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 32px;
    }

    .tile-checkbox {
      width: 18px;
      height: 18px;
      accent-color: var(--color-sw-violet);
      cursor: pointer;
    }

    .tile-checkbox:focus-visible {
      outline: 2px solid var(--color-sw-violet);
      outline-offset: 2px;
    }

    .eyebrow-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 38px;
      padding: 0 16px;
      border: 1px solid #E9E9E9;
      border-radius: var(--radius-sw-pill);
      background: white;
      font-size: 14px;
      color: var(--color-sw-ink-mid);
    }

    button:focus-visible {
      outline: 2px solid var(--color-sw-violet);
      outline-offset: 2px;
    }

    @keyframes radar-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @media (max-width: 780px) {
      .tile-page {
        padding: 24px 20px 48px;
      }
    }
  `],
})
export class StyleTile implements OnInit {
  swatches = SWATCH_DATA;
  TYPE_SCALE = TYPE_SCALE;
  FAKE_LEADS = FAKE_LEADS;

  heatSeverity = heatSeverity;
  statusLabel = statusLabel;

  fontFamily(t: TypeSpec): string {
    return t.family === 'mono' ? '"Geist Mono", monospace' : '"Geist Sans", sans-serif';
  }

  ngOnInit() {
    // Swatch contrast already computed at module init
  }
}
