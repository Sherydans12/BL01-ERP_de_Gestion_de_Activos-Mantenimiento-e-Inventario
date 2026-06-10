-- CreateTable: fault_report_attachments
-- Evidencia multimedia adjunta a reportes de falla.
-- Límite de negocio: 3 archivos / reporte, 10 MB cada uno (validado en aplicación).

CREATE TABLE "fault_report_attachments" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "fault_report_id" UUID         NOT NULL,
    "storage_key"     VARCHAR(500) NOT NULL,
    "file_name"       VARCHAR(255) NOT NULL,
    "file_type"       VARCHAR(100) NOT NULL,
    "size_bytes"      INTEGER      NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fault_report_attachments_pkey" PRIMARY KEY ("id")
);

-- Index
CREATE INDEX "fault_report_attachments_fault_report_id_idx"
    ON "fault_report_attachments"("fault_report_id");

-- FK → fault_reports (Cascade delete)
ALTER TABLE "fault_report_attachments"
    ADD CONSTRAINT "fault_report_attachments_fault_report_id_fkey"
    FOREIGN KEY ("fault_report_id")
    REFERENCES "fault_reports"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
