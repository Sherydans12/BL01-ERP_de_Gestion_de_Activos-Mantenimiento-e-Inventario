import {
  Component,
  computed,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { resolveUploadPublicUrl } from '../../../core/utils/media-url';

/**
 * Paleta con **alto contraste** (aprox. ≥ 7:1 sobre iniciales pequeñas en círculo).
 * Fondos oscuros saturados + texto blanco o casi blanco.
 */
const AVATAR_INITIAL_PALETTES: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#0b3d5c', fg: '#ffffff' },
  { bg: '#0d4f3c', fg: '#ffffff' },
  { bg: '#4a0e6e', fg: '#ffffff' },
  { bg: '#7c2d12', fg: '#ffffff' },
  { bg: '#14532d', fg: '#ffffff' },
  { bg: '#6b0f2a', fg: '#ffffff' },
  { bg: '#0c4a6e', fg: '#ffffff' },
  { bg: '#312e81', fg: '#ffffff' },
  { bg: '#713f12', fg: '#ffffff' },
  { bg: '#115e59', fg: '#ffffff' },
  { bg: '#0f172a', fg: '#f8fafc' },
  { bg: '#78350f', fg: '#ffffff' },
];

function stableHash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

@Component({
  selector: 'app-avatar',
  standalone: true,
  imports: [NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (resolvedUrl() && !imageBroken()) {
      <img
        [src]="resolvedUrl()"
        alt=""
        (error)="imageBroken.set(true)"
        [ngClass]="sizeClass()"
        class="rounded-full object-cover shrink-0 ring-1 ring-border"
      />
    } @else {
      <div
        class="rounded-full flex items-center justify-center font-semibold shrink-0 ring-1 ring-border select-none"
        [ngClass]="sizeClass()"
        [style.background-color]="palette().bg"
        [style.color]="palette().fg"
        [attr.aria-hidden]="true"
      >
        {{ initials() }}
      </div>
    }
  `,
})
export class AvatarComponent {
  /** Nombre de pila (perfil). */
  firstName = input<string | null | undefined>(undefined);
  /** Apellido(s) (perfil). */
  lastName = input<string | null | undefined>(undefined);
  /** Nombre completo legado / display (requerido como respaldo). */
  displayName = input.required<string>();
  /** Ruta o URL de imagen (backend suele guardar `/uploads/...`). */
  avatarUrl = input<string | null | undefined>(undefined);
  /** Clases Tailwind de tamaño, ej. `h-9 w-9` o `h-8 w-8`. */
  sizeClass = input<string>('h-9 w-9');
  /** Texto extra para colorear iniciales de forma estable (ej. email). */
  colorSeed = input<string | null | undefined>(undefined);

  imageBroken = signal(false);

  resolvedUrl = computed(() => resolveUploadPublicUrl(this.avatarUrl() ?? null));

  initials = computed(() => {
    const fn = (this.firstName() ?? '').trim();
    const ln = (this.lastName() ?? '').trim();
    let a = '';
    let b = '';
    if (fn.length) a = fn.charAt(0);
    if (ln.length) b = ln.charAt(0);
    if (!a && !b) {
      const name = (this.displayName() ?? '').trim();
      if (name.length >= 2) {
        const parts = name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
          a = parts[0].charAt(0);
          b = parts[parts.length - 1].charAt(0);
        } else {
          a = name.charAt(0);
          b = name.charAt(1);
        }
      } else if (name.length === 1) {
        a = name.charAt(0);
        b = name.charAt(0);
      } else {
        a = 'U';
        b = '';
      }
    }
    return (a + b).toUpperCase();
  });

  palette = computed(() => {
    const seed =
      `${this.firstName() ?? ''}|${this.lastName() ?? ''}|${this.displayName()}|${this.colorSeed() ?? ''}`;
    const idx = stableHash(seed) % AVATAR_INITIAL_PALETTES.length;
    return AVATAR_INITIAL_PALETTES[idx]!;
  });
}
