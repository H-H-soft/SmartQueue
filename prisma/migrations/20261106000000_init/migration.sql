-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'CANCELLED', 'MISSED');

-- CreateEnum
CREATE TYPE "DeskStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "avgMinutes" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Desk" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "DeskStatus" NOT NULL DEFAULT 'CLOSED',

    CONSTRAINT "Desk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "serviceId" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'WAITING',
    "profile" TEXT NOT NULL DEFAULT 'standard',
    "tokenHash" TEXT NOT NULL,
    "deskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DeskToService" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DeskToService_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Service_prefix_key" ON "Service"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");

-- A desk can hold at most one active ticket, even if another writer bypasses the API.
CREATE UNIQUE INDEX "Ticket_active_desk_key" ON "Ticket"("deskId")
WHERE "status" IN ('CALLED', 'SERVING');

ALTER TABLE "Service" ADD CONSTRAINT "Service_avgMinutes_positive" CHECK ("avgMinutes" > 0);
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_active_requires_desk"
CHECK ("status" NOT IN ('CALLED', 'SERVING') OR "deskId" IS NOT NULL);

-- CreateIndex
CREATE INDEX "Ticket_serviceId_status_sequence_idx" ON "Ticket"("serviceId", "status", "sequence");

-- CreateIndex
CREATE INDEX "Ticket_deskId_status_idx" ON "Ticket"("deskId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_serviceId_sequence_key" ON "Ticket"("serviceId", "sequence");

-- CreateIndex
CREATE INDEX "_DeskToService_B_index" ON "_DeskToService"("B");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_deskId_fkey" FOREIGN KEY ("deskId") REFERENCES "Desk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DeskToService" ADD CONSTRAINT "_DeskToService_A_fkey" FOREIGN KEY ("A") REFERENCES "Desk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DeskToService" ADD CONSTRAINT "_DeskToService_B_fkey" FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
