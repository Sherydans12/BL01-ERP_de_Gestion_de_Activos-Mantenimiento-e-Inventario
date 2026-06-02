import { CanDeactivateFn } from '@angular/router';
import { AvailabilityFormComponent } from './availability-form.component';

/**
 * Evita salir del formulario de disponibilidad si hay datos sin guardar.
 * Delega al componente para usar el modal reactivo del proyecto.
 */
export const availabilityFormCanDeactivate: CanDeactivateFn<AvailabilityFormComponent> =
  (component) => component.confirmLeaveIfDirty();
