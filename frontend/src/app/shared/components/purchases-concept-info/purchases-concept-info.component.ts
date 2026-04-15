import { Component, input, signal, HostListener, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-purchases-concept-info',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './purchases-concept-info.component.html',
})
export class PurchasesConceptInfoComponent {
  private host = inject(ElementRef<HTMLElement>);

  /** Título corto para accesibilidad (ej. "3-Way Match"). */
  label = input.required<string>();
  /** Texto explicativo completo. */
  text = input.required<string>();

  open = signal(false);

  toggle() {
    this.open.update((v) => !v);
  }

  close() {
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent) {
    if (!this.open()) return;
    const t = ev.target as Node | null;
    if (t && this.host.nativeElement.contains(t)) return;
    this.close();
  }
}
