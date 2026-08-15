import {
  Component, ChangeDetectionStrategy, input, model, signal, computed,
  ElementRef, inject, DestroyRef, viewChild, effect,
} from '@angular/core';
import { Listbox, Option } from '@angular/aria/listbox';

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * A compact multiselect dropdown: a trigger that states what is currently selected, and a
 * popup list of toggleable options.
 *
 * The list itself is Angular Aria's `Listbox` with `multi` and `selectionMode="explicit"`,
 * which *is* checkbox behaviour — arrows move without selecting, space or click toggles —
 * and brings roving focus, typeahead and the right ARIA wiring with it (AC-20).
 *
 * It deliberately does **not** use Aria's `Combobox`, despite spec 0005b's prose naming it.
 * `Combobox` is built around an input's text value (`value: ModelSignal<string>`, with
 * inline suggestions), so it fights a trigger whose job is to summarise a selection rather
 * than to be typed into. The disclosure below is a button, which is what this control
 * actually is. AC-20 asks for `Listbox` with those two settings, and that is what carries
 * the keyboard behaviour.
 *
 * The trigger always states the active selection, so no filter is ever hidden behind a
 * closed control.
 */
@Component({
  selector: 'app-multi-select',
  standalone: true,
  imports: [Listbox, Option],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div style="position:relative;">
      <button
        #trigger
        type="button"
        [attr.aria-expanded]="open()"
        aria-haspopup="listbox"
        [disabled]="disabled()"
        (click)="toggle()"
        (keydown)="onTriggerKeydown($event)"
        [style]="triggerStyle()"
      >
        <span data-mono style="font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-sw-ink-lo);">{{ label() }}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;">{{ summary() }}</span>
        <span aria-hidden="true" style="color:var(--color-sw-ink-lo);font-size:10px;">▾</span>
      </button>

      @if (open()) {
        <ul
          ngListbox
          [multi]="true"
          selectionMode="explicit"
          [(value)]="selected"
          [attr.aria-label]="label()"
          (keydown)="onListKeydown($event)"
          style="position:absolute;z-index:30;top:calc(100% + 4px);left:0;min-width:100%;max-width:280px;max-height:280px;overflow-y:auto;margin:0;padding:4px;list-style:none;background:white;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw);box-shadow:0 1px 2px rgba(44,34,78,.06),0 8px 24px rgba(44,34,78,.06);"
        >
          @for (o of options(); track o.value) {
            <li
              ngOption
              [value]="o.value"
              [label]="o.label"
              [style.background]="isSelected(o.value) ? 'var(--color-sw-violet-soft)' : 'transparent'"
              [style.color]="isSelected(o.value) ? 'var(--color-sw-violet-hi)' : 'var(--color-sw-ink)'"
              style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--radius-sw-sm);font-size:13px;cursor:pointer;white-space:nowrap;"
            >
              <span aria-hidden="true" data-mono style="width:12px;display:inline-block;">{{ isSelected(o.value) ? '✓' : '' }}</span>
              {{ o.label }}
            </li>
          }
          @if (options().length === 0) {
            <li style="padding:7px 10px;font-size:13px;color:var(--color-sw-ink-lo);">Nothing to filter on</li>
          }
        </ul>
      }
    </div>
  `,
})
export class MultiSelect {
  readonly label = input.required<string>();
  readonly options = input.required<MultiSelectOption[]>();
  readonly selected = model<string[]>([]);
  readonly disabled = input(false);

  readonly open = signal(false);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  /** Active selection, stated on the closed control so nothing hides state. */
  readonly summary = computed(() => {
    const sel = this.selected();
    if (sel.length === 0) return 'Any';
    if (sel.length === 1) {
      return this.options().find((o) => o.value === sel[0])?.label ?? sel[0];
    }
    return `${sel.length} selected`;
  });

  readonly triggerStyle = computed(() => {
    const active = this.selected().length > 0;
    return `display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 10px;`
      + `border:1px solid ${active ? 'var(--color-sw-violet)' : 'var(--color-sw-rule-2)'};`
      + `border-radius:var(--radius-sw-sm);`
      + `background:${active ? 'var(--color-sw-violet-soft)' : 'white'};`
      + `color:${active ? 'var(--color-sw-violet-hi)' : 'var(--color-sw-ink-mid)'};`
      + `font-family:'Geist Sans',sans-serif;font-size:13px;`
      + `cursor:${this.disabled() ? 'not-allowed' : 'pointer'};`;
  });

  private readonly onDocumentPointerDown = (event: Event) => {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  };

  constructor() {
    // Only listen while open. A permanently bound document listener per filter control
    // would be seven of them on a screen that is meant to feel light.
    effect((onCleanup) => {
      if (!this.open()) return;
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
      onCleanup(() => document.removeEventListener('pointerdown', this.onDocumentPointerDown, true));
    });

    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('pointerdown', this.onDocumentPointerDown, true));
  }

  isSelected(value: string): boolean {
    return this.selected().includes(value);
  }

  toggle(): void {
    if (this.disabled()) return;
    this.open.update((v) => !v);
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      if (!this.open()) {
        event.preventDefault();
        this.open.set(true);
      }
    } else if (event.key === 'Escape') {
      this.open.set(false);
    }
  }

  /** Escape closes and returns focus to the trigger, so keyboard use never strands you
   * inside a popup that is no longer there. */
  onListKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }
}
