import {
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  inject,
  effect,
} from '@angular/core';
import { AuthService } from '../../core/services/auth/auth.service';

/**
 * Directiva estructural: muestra el template solo si `AuthService.hasPermission` es true.
 * Uso: `<button *appHasPermission="'purchases:order:approve'">…</button>`
 */
@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);

  private required: string | string[] = [];

  @Input()
  set appHasPermission(value: string | string[]) {
    this.required = value;
    this.render();
  }

  constructor() {
    effect(() => {
      this.auth.currentUser();
      this.auth.userPermissions();
      this.render();
    });
  }

  private render(): void {
    this.viewContainer.clear();
    if (this.auth.hasPermission(this.required)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    }
  }
}

/**
 * Muestra el template si el usuario tiene **al menos uno** de los permisos (OR).
 * Uso: `<button *appHasAnyPermission="editPerms">…</button>`
 */
@Directive({
  selector: '[appHasAnyPermission]',
  standalone: true,
})
export class HasAnyPermissionDirective {
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);

  private required: string | string[] = [];

  @Input()
  set appHasAnyPermission(value: string | string[]) {
    this.required = value;
    this.render();
  }

  constructor() {
    effect(() => {
      this.auth.currentUser();
      this.auth.userPermissions();
      this.render();
    });
  }

  private render(): void {
    this.viewContainer.clear();
    if (this.auth.hasPermissionAny(this.required)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    }
  }
}
