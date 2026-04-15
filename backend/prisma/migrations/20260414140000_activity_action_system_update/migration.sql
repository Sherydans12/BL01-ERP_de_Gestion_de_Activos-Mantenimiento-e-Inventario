-- Phase 6C: audit log for catalog link and other system-driven PO updates
ALTER TYPE "ActivityAction" ADD VALUE 'SYSTEM_UPDATE';
