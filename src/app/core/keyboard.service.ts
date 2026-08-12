import { Injectable, signal } from '@angular/core';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export type PaletteActionProvider = (query: string) => PaletteAction[];

/** Returns true if it handled the key (stops it reaching any other handler). */
export type ShortcutHandler = (event: KeyboardEvent) => boolean;

/**
 * Global shortcut registry (BUILD-PLAN.md §9's core/keyboard.service.ts). Owns the
 * Cmd/Ctrl+K palette toggle and a scoped-shortcut registry that mounted features (the
 * leads grid's j/k/enter) add to and remove from as they mount/unmount, so later
 * weekends' screens can register their own shortcuts without re-touching this file.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardService {
  readonly paletteOpen = signal(false);
  readonly paletteQuery = signal('');

  private actionProvider: PaletteActionProvider | null = null;
  private readonly shortcutHandlers = new Set<ShortcutHandler>();
  private listenerBound = false;
  private readonly onKeydown = (event: KeyboardEvent) => this.handleKeydown(event);

  /** Called once, by the app shell, while it's mounted (never on the public/login routes). */
  bindGlobalListener(): void {
    if (this.listenerBound) return;
    document.addEventListener('keydown', this.onKeydown);
    this.listenerBound = true;
  }

  unbindGlobalListener(): void {
    if (!this.listenerBound) return;
    document.removeEventListener('keydown', this.onKeydown);
    this.listenerBound = false;
  }

  openPalette(): void {
    this.paletteQuery.set('');
    this.paletteOpen.set(true);
  }

  closePalette(): void {
    this.paletteOpen.set(false);
  }

  togglePalette(): void {
    this.paletteOpen() ? this.closePalette() : this.openPalette();
  }

  /** The mounted feature's action list (jump-to-lead, status change, quick filters, ...).
   * Only one feature registers at a time in this app; the palette shows nothing if none has. */
  setActionProvider(provider: PaletteActionProvider | null): void {
    this.actionProvider = provider;
  }

  actionsFor(query: string): PaletteAction[] {
    return this.actionProvider ? this.actionProvider(query) : [];
  }

  /** Registers a scoped handler (e.g. j/k/enter for grid row focus). Returns an
   * unregister function to call on the owning component's destroy. */
  registerShortcuts(handler: ShortcutHandler): () => void {
    this.shortcutHandlers.add(handler);
    return () => this.shortcutHandlers.delete(handler);
  }

  private handleKeydown(event: KeyboardEvent): void {
    const isMod = event.metaKey || event.ctrlKey;
    if (isMod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.togglePalette();
      return;
    }
    if (this.paletteOpen()) {
      if (event.key === 'Escape') this.closePalette();
      return; // the palette owns its own input/list navigation otherwise
    }
    const target = event.target as HTMLElement | null;
    const typing = !!target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
    if (typing) return;
    for (const handler of this.shortcutHandlers) {
      if (handler(event)) {
        event.preventDefault();
        break;
      }
    }
  }
}
