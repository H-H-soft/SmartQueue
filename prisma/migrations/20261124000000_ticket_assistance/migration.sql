CREATE TABLE "AdminSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME
);
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
ALTER TABLE "Ticket" ADD COLUMN "helpSummary" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "helpRequirements" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "requesterLocationId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "claimedById" TEXT REFERENCES "AdminSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD COLUMN "claimedAt" DATETIME;
ALTER TABLE "Ticket" ADD COLUMN "helpCompletedAt" DATETIME;
