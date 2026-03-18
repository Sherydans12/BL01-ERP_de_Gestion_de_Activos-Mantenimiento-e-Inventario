import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';

@Injectable({
  providedIn: 'root',
})
export class ExportService {
  /**
   * Exporta un array de objetos a un archivo Excel (.xlsx)
   * @param data Array de datos
   * @param fileName Nombre del archivo (sin extensión)
   * @param headersMap Mapeo opcional de llaves base a nombres legibles (ej: { internalId: 'N° Interno' })
   */
  exportToExcel(
    data: any[],
    fileName: string,
    headersMap?: Record<string, string>,
  ) {
    // 1. Preprocesar data (Formateo de fechas y traducciones)
    const processedData = data.map((item) => {
      const newItem: any = {};

      const keys = headersMap ? Object.keys(headersMap) : Object.keys(item);

      keys.forEach((key) => {
        let value = item[key];
        const label = headersMap ? headersMap[key] : key;

        // Formateo de Fechas
        if (
          value instanceof Date ||
          (typeof value === 'string' &&
            this.isValidDate(value) &&
            value.includes('-'))
        ) {
          value = this.formatDate(value);
        }

        // Traducciones de Status y Tipos
        if (key === 'status') value = this.translateStatus(value);
        if (key === 'maintenanceType')
          value = this.translateMaintenanceType(value);
        if (key === 'type') value = this.translateType(value);
        if (key === 'category') value = this.translateCategory(value);

        // Caso especial de relación Equipment en OT
        if (key === 'equipment' && value?.internalId) {
          value = value.internalId;
        }

        newItem[label] = value;
      });

      return newItem;
    });

    // 2. Crear Libro y Hoja
    const worksheet = XLSX.utils.json_to_sheet(processedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Datos');

    // 3. Generar y Descargar
    XLSX.writeFile(workbook, `${fileName}_${new Date().getTime()}.xlsx`);
  }

  private isValidDate(val: any): boolean {
    const d = new Date(val);
    return d instanceof Date && !isNaN(d.getTime());
  }

  private formatDate(dateStr: any): string {
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private translateStatus(val: string): string {
    const mapping: Record<string, string> = {
      OPEN: 'ABIERTA',
      IN_PROGRESS: 'EN PROGRESO',
      ON_HOLD: 'EN ESPERA',
      CLOSED: 'CERRADA',
      ACTIVE: 'ACTIVO',
      INACTIVE: 'INACTIVO',
      MAINTENANCE: 'EN TALLER',
    };
    return mapping[val] || val;
  }

  private translateMaintenanceType(val: string): string {
    const mapping: Record<string, string> = {
      PREVENTIVO: 'PREVENTIVO',
      CORRECTIVO: 'CORRECTIVO',
    };
    return mapping[val] || val;
  }

  private translateType(val: string): string {
    const mapping: Record<string, string> = {
      TRUCK: 'CAMIÓN',
      TRAILER: 'REMOLQUE',
      VAN: 'FURGÓN',
      PICKUP: 'CAMIONETA',
      MACHINE: 'MAQUINARIA',
    };
    return mapping[val] || val;
  }

  private translateCategory(val: string): string {
    const mapping: Record<string, string> = {
      PROGRAMADA: 'PROGRAMADA',
      NO_PROGRAMADA: 'NO PROGRAMADA',
      ACCIDENTE: 'ACCIDENTE',
    };
    return mapping[val] || val;
  }
}
