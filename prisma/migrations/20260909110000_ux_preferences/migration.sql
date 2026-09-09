-- T16 -- Per-user display preferences (PRD 38, UX01/UX02).
--
-- Purely ADDITIVE: two new enums and two new User columns, both with
-- defaults, so every existing row is valid the moment this applies. Nothing
-- is dropped or retyped.
--
-- These are presentation preferences only. They carry no authority and are
-- deliberately not consulted by any access decision.
--
-- Written idempotently; Prisma does not wrap a migration in a transaction.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "Density" AS ENUM ('COMFORTABLE', 'COMPACT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "densityPreference" "Density" NOT NULL DEFAULT 'COMFORTABLE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themePreference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM';
