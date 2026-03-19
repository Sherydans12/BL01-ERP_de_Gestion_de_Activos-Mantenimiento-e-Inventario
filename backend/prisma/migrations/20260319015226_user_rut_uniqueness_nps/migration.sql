/*
  Warnings:

  - A unique constraint covering the columns `[tenant_id,rut]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_rut_key" ON "users"("tenant_id", "rut");
