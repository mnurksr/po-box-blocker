-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoHold" BOOLEAN NOT NULL DEFAULT true,
    "autoTag" BOOLEAN NOT NULL DEFAULT true,
    "tagName" TEXT NOT NULL DEFAULT 'PO_BOX_ERROR',
    "sendEmail" BOOLEAN NOT NULL DEFAULT false,
    "emailSubject" TEXT NOT NULL DEFAULT 'Action Required: Please Update Your Shipping Address',
    "emailBody" TEXT,
    "customPatterns" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FlaggedOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "flaggedAddress" TEXT NOT NULL,
    "matchedPattern" TEXT NOT NULL,
    "addressType" TEXT NOT NULL DEFAULT 'shipping',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actionsTaken" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE INDEX "FlaggedOrder_shop_idx" ON "FlaggedOrder"("shop");

-- CreateIndex
CREATE INDEX "FlaggedOrder_orderId_idx" ON "FlaggedOrder"("orderId");

-- CreateIndex
CREATE INDEX "FlaggedOrder_status_idx" ON "FlaggedOrder"("status");

-- CreateIndex
CREATE INDEX "FlaggedOrder_createdAt_idx" ON "FlaggedOrder"("createdAt");
