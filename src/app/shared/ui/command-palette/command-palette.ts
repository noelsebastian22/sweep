import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { Combobox, ComboboxPopup, ComboboxWidget } from '@angular/aria/combobox';
import { Listbox, Option } from '@angular/aria/listbox';
import { KeyboardService } from '../../../core/keyboard.service';

/**
 * The global ⌘K palette (AC-9). Content is entirely driven by whichever feature has
 * registered an action provider with `KeyboardService` (the leads grid, for now); this
 * component only owns the overlay chrome and the Angular Aria combobox/listbox wiring.
 */
@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [Combobox, ComboboxPopup, ComboboxWidget, Listbox, Option],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (keyboard.paletteOpen()) {
      <div
        (click)="keyboard.closePalette()"
        style="position:fixed;inset:0;background:rgba(44,34,78,.24);z-index:50;display:flex;align-items:flex-start;justify-content:center;padding-top:120px;"
      >
        <div
          (click)="$event.stopPropagation()"
          style="width:100%;max-width:560px;background:white;border-radius:var(--radius-sw-lg);border:1px solid var(--color-sw-rule);box-shadow:0 1px 2px rgba(44,34,78,.06),0 8px 24px rgba(44,34,78,.06);overflow:hidden;"
        >
          <input
            ngCombobox
            #combobox="ngCombobox"
            [(value)]="query"
            [(expanded)]="expanded"
            autofocus
            aria-label="Command palette"
            placeholder="Jump to a lead, change status, or filter…"
            style="width:100%;height:52px;padding:0 16px;border:none;outline:none;font-family:'Geist Sans',sans-serif;font-size:15px;color:var(--color-sw-ink);box-sizing:border-box;border-bottom:1px solid var(--color-sw-rule);"
          />
          <ng-template ngComboboxPopup [combobox]="combobox">
            <div
              ngComboboxWidget
              #listbox="ngListbox"
              ngListbox
              [(value)]="selectedIds"
              selectionMode="explicit"
              [activeDescendant]="listbox.activeDescendant()"
              style="max-height:320px;overflow-y:auto;padding:8px;"
            >
              @for (action of actions(); track action.id) {
                <div
                  ngOption
                  #opt="ngOption"
                  [value]="action.id"
                  [label]="action.label"
                  (click)="selectedIds.set([action.id])"
                  [style.background]="opt.active() ? 'var(--color-sw-violet-soft)' : 'transparent'"
                  style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--radius-sw-sm);cursor:pointer;font-size:14px;color:var(--color-sw-ink);"
                >
                  <span>{{ action.label }}</span>
                  @if (action.hint) {
                    <span data-mono style="font-size:11px;color:var(--color-sw-ink-lo);">{{ action.hint }}</span>
                  }
                </div>
              } @empty {
                <div style="padding:16px 12px;font-size:13px;color:var(--color-sw-ink-lo);">No matches.</div>
              }
            </div>
          </ng-template>
        </div>
      </div>
    }
  `,
})
export class CommandPalette {
  readonly keyboard = inject(KeyboardService);

  readonly query = this.keyboard.paletteQuery;
  readonly expanded = signal(true);
  readonly selectedIds = signal<string[]>([]);

  readonly actions = computed(() => this.keyboard.actionsFor(this.query()));

  constructor() {
    // The aria pattern can collapse itself (e.g. on blur); keep our overlay in sync.
    effect(() => {
      if (!this.expanded()) this.keyboard.closePalette();
    });
    // Explicit selection (Enter/click on an option) runs that action, then resets.
    effect(() => {
      const ids = this.selectedIds();
      if (ids.length === 0) return;
      const id = ids[ids.length - 1];
      const action = this.actions().find((a) => a.id === id);
      this.selectedIds.set([]);
      if (action) {
        action.run();
        this.keyboard.closePalette();
      }
    });
  }
}
