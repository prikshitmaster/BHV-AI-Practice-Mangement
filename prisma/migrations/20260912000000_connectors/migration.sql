-- CreateEnum
CREATE TYPE "ConnectorEnvironment" AS ENUM ('DEVELOPMENT', 'TEST', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ConnectorTestResult" AS ENUM ('PASSED', 'FAILED', 'REFUSED');

-- CreateTable
CREATE TABLE "ConnectorConfig" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "environment" "ConnectorEnvironment" NOT NULL,
    "scope" TEXT[],
    "credentialRef" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "credentialRotatedAt" TIMESTAMP(3),
    "status" "ConnectorStatus" NOT NULL DEFAULT 'DRAFT',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestResult" "ConnectorTestResult",
    "lastTestMessage" TEXT,
    "lastTestCredentialVersion" INTEGER,
    "createdByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorCredentialRotation" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "previousRef" TEXT NOT NULL,
    "newRef" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "rotatedByUserId" TEXT NOT NULL,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorCredentialRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorTestRun" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "result" "ConnectorTestResult" NOT NULL,
    "message" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "runtimeEnvironment" "ConnectorEnvironment" NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "testedByUserId" TEXT NOT NULL,
    "testedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorTestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorConfig_credentialRef_key" ON "ConnectorConfig"("credentialRef");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorConfig_practiceId_name_environment_key" ON "ConnectorConfig"("practiceId", "name", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorConfig_id_practiceId_key" ON "ConnectorConfig"("id", "practiceId");

-- CreateIndex
CREATE INDEX "ConnectorCredentialRotation_previousRef_idx" ON "ConnectorCredentialRotation"("previousRef");

-- AddForeignKey
ALTER TABLE "ConnectorConfig" ADD CONSTRAINT "ConnectorConfig_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorCredentialRotation" ADD CONSTRAINT "ConnectorCredentialRotation_connectorId_practiceId_fkey" FOREIGN KEY ("connectorId", "practiceId") REFERENCES "ConnectorConfig"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorTestRun" ADD CONSTRAINT "ConnectorTestRun_connectorId_practiceId_fkey" FOREIGN KEY ("connectorId", "practiceId") REFERENCES "ConnectorConfig"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

