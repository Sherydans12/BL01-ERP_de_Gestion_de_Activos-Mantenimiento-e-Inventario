import { CanDeactivateFn } from '@angular/router';
import { RegistroHorasComponent } from './registro-horas.component';

/**
 * Evita salir de registro masivo si hay borrador local o lecturas pendientes de subir.
 */
export const registroHorasCanDeactivate: CanDeactivateFn<
  RegistroHorasComponent
> = (component) => {
  return component.confirmLeaveIfDraft();
};
