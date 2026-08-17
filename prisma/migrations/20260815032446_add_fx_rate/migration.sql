-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "currencyPair" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FxRate_currencyPair_fetchedAt_idx" ON "FxRate"("currencyPair", "fetchedAt");
