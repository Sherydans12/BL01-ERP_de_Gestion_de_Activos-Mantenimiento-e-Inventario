import { CanDeactivateFn } from '@angular/router';
import { FaultReportFormComponent } from './fault-report-form.component';

/**
 * Evita salir del formulario de registro de falla si el operador
 * ha ingresado datos sin guardar. Delega al componente para usar
 * el modal reactivo del proyecto.
 */
export const faultReportCanDeactivate: CanDeactivateFn<FaultReportFormComponent> = (component) =>
  component.confirmLeaveIfDirty();
