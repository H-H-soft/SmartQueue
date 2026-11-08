-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "avgMinutes" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextNumber" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Service_avgMinutes_positive" CHECK ("avgMinutes" > 0)
);

-- CreateTable
CREATE TABLE "Desk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLOSED'
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "serviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "profile" TEXT NOT NULL DEFAULT 'standard',
    "tokenHash" TEXT NOT NULL,
    "deskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" DATETIME,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    CONSTRAINT "Ticket_active_requires_desk" CHECK ("status" NOT IN ('CALLED', 'SERVING') OR "deskId" IS NOT NULL),
    CONSTRAINT "Ticket_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ticket_deskId_fkey" FOREIGN KEY ("deskId") REFERENCES "Desk" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_DeskToService" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_DeskToService_A_fkey" FOREIGN KEY ("A") REFERENCES "Desk" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_DeskToService_B_fkey" FOREIGN KEY ("B") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Service_prefix_key" ON "Service"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");

-- CreateIndex
CREATE INDEX "Ticket_serviceId_status_sequence_idx" ON "Ticket"("serviceId", "status", "sequence");

-- CreateIndex
CREATE INDEX "Ticket_deskId_status_idx" ON "Ticket"("deskId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_serviceId_sequence_key" ON "Ticket"("serviceId", "sequence");

-- A desk can hold at most one active ticket, even if another writer bypasses the API.
CREATE UNIQUE INDEX "Ticket_active_desk_key" ON "Ticket"("deskId")
WHERE "status" IN ('CALLED', 'SERVING');

-- CreateIndex
CREATE UNIQUE INDEX "_DeskToService_AB_unique" ON "_DeskToService"("A", "B");

-- CreateIndex
CREATE INDEX "_DeskToService_B_index" ON "_DeskToService"("B");
