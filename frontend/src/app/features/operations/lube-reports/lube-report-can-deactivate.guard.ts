import { CanDeactivateFn } from '@angular/router';
import { LubeReportFormComponent } from './lube-report-form.component';

/**
 * Evita salir del formulario de despacho si hay líneas cargadas sin guardar.
 * Delega al componente para poder usar el modal reactivo del proyecto.
 */
export const lubeReportCanDeactivate: CanDeactivateFn<LubeReportFormComponent> = (component) =>
  component.confirmLeaveIfDirty();
