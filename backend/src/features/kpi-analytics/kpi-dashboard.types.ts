/** Respuesta agregada GET /analytics/kpi-dashboard */
export type KpiDashboardResponse = {
  period: { from: string; to: string };
  contractId: string | null;
  kpis: {
    /** M2 — turnos disponibles / turnos reportados (ponderado 12 h/turno). */
    physicalAvailabilityPct: number | null;
    /** OT correctivas cerradas — media horas de detención. */
    mttrHours: number | null;
    /** Fallas HIGH (M3) — media horas entre eventos consecutivos por equipo. */
    mtbfHours: number | null;
  };
  physicalAvailability: {
    operationalShiftHours: number;
    totalShiftHours: number;
    reportedShifts: number;
    operationalShifts: number;
  };
  mttr: {
    correctiveOtCount: number;
    totalRepairHours: number;
  };
  mtbf: {
    criticalFaultCount: number;
    intervalCount: number;
  };
  lubeTrendMonthly: LubeTrendMonthPoint[];
  meta: {
    cached: boolean;
    generatedAt: string;
  };
};

export type LubeTrendMonthPoint = {
  /** YYYY-MM */
  month: string;
  totalLiters: number;
  machineHours: number;
  litersPerMachineHour: number | null;
};
