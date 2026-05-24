-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'admin', 'cm', 'exec', 'analyst');

-- CreateEnum
CREATE TYPE "PromiseStatus" AS ENUM ('Open', 'Kept', 'Broken', 'Cancelled');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('Candidate', 'Active', 'Released');

-- CreateEnum
CREATE TYPE "PlanInstStatus" AS ENUM ('Pending', 'Received', 'Broken', 'Cancelled');

-- CreateEnum
CREATE TYPE "LegalStatus" AS ENUM ('NoticeSent', 'Filed', 'InCourt', 'Settled', 'Dropped', 'Recovered', 'WrittenOff');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "execId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'exec',
    "badge" TEXT NOT NULL DEFAULT 'Executive',
    "team" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "scoreboard" BOOLEAN NOT NULL DEFAULT false,
    "viewPerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "viewReadOnly" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "totpSecret" TEXT,
    "totpEnrolledAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "family" TEXT,
    "exec" TEXT,
    "cm" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'A',
    "tierOverride" TEXT,
    "alert" TEXT,
    "alertOverride" TEXT,
    "bill" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "d30" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "d60" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "d90" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "d90p" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stage" TEXT,
    "stageCalls" INTEGER NOT NULL DEFAULT 0,
    "stageSince" TIMESTAMP(3),
    "recentCall" TIMESTAMP(3),
    "callOutcome" TEXT,
    "nextFu" TIMESTAMP(3),
    "payExpected" TIMESTAMP(3),
    "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditPeriod" TEXT,
    "onTimePct" TEXT,
    "history" TEXT,
    "mgtNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "onHold" TEXT,
    "branch" TEXT,
    "lastTouched" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMaster" (
    "id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "family" TEXT,
    "segment" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "owner" TEXT,
    "ap" TEXT,
    "admin" TEXT,
    "address" TEXT,
    "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditTerms" INTEGER NOT NULL DEFAULT 0,
    "vip" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promise" (
    "id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "family" TEXT,
    "expectedBy" TIMESTAMP(3) NOT NULL,
    "exec" TEXT,
    "outstandingAt" DECIMAL(14,2) NOT NULL,
    "status" "PromiseStatus" NOT NULL DEFAULT 'Open',
    "settledOn" TIMESTAMP(3),
    "amountReceived" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoldRecord" (
    "id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "family" TEXT,
    "outstanding" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'Candidate',
    "confirmedBy" TEXT,
    "confirmedOn" TIMESTAMP(3),
    "releasedBy" TEXT,
    "releasedOn" TIMESTAMP(3),
    "addedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoldRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "family" TEXT,
    "planTotal" DECIMAL(14,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanInstalment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "instNo" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "PlanInstStatus" NOT NULL DEFAULT 'Pending',
    "received" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "settledOn" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "PlanInstalment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalCase" (
    "id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "family" TEXT,
    "filedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outstanding" DECIMAL(14,2) NOT NULL,
    "status" "LegalStatus" NOT NULL DEFAULT 'NoticeSent',
    "lawyer" TEXT,
    "caseRef" TEXT,
    "nextHearing" TIMESTAMP(3),
    "notes" TEXT,
    "closedOn" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionLog" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "party" TEXT NOT NULL,
    "family" TEXT,
    "exec" TEXT,
    "cm" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "prevOutstanding" DECIMAL(14,2) NOT NULL,
    "newOutstanding" DECIMAL(14,2) NOT NULL,
    "trigger" TEXT,
    "notes" TEXT,

    CONSTRAINT "CollectionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountHistory" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "party" TEXT NOT NULL,
    "exec" TEXT,
    "cm" TEXT,
    "action" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "outstanding" DECIMAL(14,2),
    "source" TEXT,

    CONSTRAINT "AccountHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "execId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshLog" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byWhom" TEXT NOT NULL,
    "accountCount" INTEGER NOT NULL,
    "totalOutstanding" DECIMAL(14,2) NOT NULL,
    "delta" DECIMAL(14,2) NOT NULL,
    "promisesKept" INTEGER NOT NULL DEFAULT 0,
    "promisesBroken" INTEGER NOT NULL DEFAULT 0,
    "newHoldCandidates" INTEGER NOT NULL DEFAULT 0,
    "newCollections" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "RefreshLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointEvent" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exec" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "party" TEXT,
    "points" INTEGER NOT NULL,
    "detail" TEXT,

    CONSTRAINT "PointEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'misc',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_execId_key" ON "User"("execId");

-- CreateIndex
CREATE INDEX "User_execId_idx" ON "User"("execId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_party_key" ON "Account"("party");

-- CreateIndex
CREATE INDEX "Account_exec_idx" ON "Account"("exec");

-- CreateIndex
CREATE INDEX "Account_cm_idx" ON "Account"("cm");

-- CreateIndex
CREATE INDEX "Account_tier_idx" ON "Account"("tier");

-- CreateIndex
CREATE INDEX "Account_onHold_idx" ON "Account"("onHold");

-- CreateIndex
CREATE INDEX "Account_status_idx" ON "Account"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientMaster_party_key" ON "ClientMaster"("party");

-- CreateIndex
CREATE INDEX "ClientMaster_party_idx" ON "ClientMaster"("party");

-- CreateIndex
CREATE INDEX "ClientMaster_segment_idx" ON "ClientMaster"("segment");

-- CreateIndex
CREATE INDEX "Promise_party_idx" ON "Promise"("party");

-- CreateIndex
CREATE INDEX "Promise_status_idx" ON "Promise"("status");

-- CreateIndex
CREATE INDEX "Promise_expectedBy_idx" ON "Promise"("expectedBy");

-- CreateIndex
CREATE INDEX "HoldRecord_party_idx" ON "HoldRecord"("party");

-- CreateIndex
CREATE INDEX "HoldRecord_status_idx" ON "HoldRecord"("status");

-- CreateIndex
CREATE INDEX "PaymentPlan_party_idx" ON "PaymentPlan"("party");

-- CreateIndex
CREATE INDEX "PlanInstalment_planId_idx" ON "PlanInstalment"("planId");

-- CreateIndex
CREATE INDEX "PlanInstalment_status_idx" ON "PlanInstalment"("status");

-- CreateIndex
CREATE INDEX "PlanInstalment_dueDate_idx" ON "PlanInstalment"("dueDate");

-- CreateIndex
CREATE INDEX "LegalCase_party_idx" ON "LegalCase"("party");

-- CreateIndex
CREATE INDEX "LegalCase_status_idx" ON "LegalCase"("status");

-- CreateIndex
CREATE INDEX "CollectionLog_party_idx" ON "CollectionLog"("party");

-- CreateIndex
CREATE INDEX "CollectionLog_exec_idx" ON "CollectionLog"("exec");

-- CreateIndex
CREATE INDEX "CollectionLog_date_idx" ON "CollectionLog"("date");

-- CreateIndex
CREATE INDEX "AccountHistory_party_idx" ON "AccountHistory"("party");

-- CreateIndex
CREATE INDEX "AccountHistory_ts_idx" ON "AccountHistory"("ts");

-- CreateIndex
CREATE INDEX "AuditLog_ts_idx" ON "AuditLog"("ts");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_target_idx" ON "AuditLog"("target");

-- CreateIndex
CREATE INDEX "RefreshLog_ts_idx" ON "RefreshLog"("ts");

-- CreateIndex
CREATE INDEX "PointEvent_exec_idx" ON "PointEvent"("exec");

-- CreateIndex
CREATE INDEX "PointEvent_ts_idx" ON "PointEvent"("ts");

-- CreateIndex
CREATE INDEX "PointEvent_event_idx" ON "PointEvent"("event");

-- AddForeignKey
ALTER TABLE "Promise" ADD CONSTRAINT "Promise_party_fkey" FOREIGN KEY ("party") REFERENCES "Account"("party") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HoldRecord" ADD CONSTRAINT "HoldRecord_party_fkey" FOREIGN KEY ("party") REFERENCES "Account"("party") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_party_fkey" FOREIGN KEY ("party") REFERENCES "Account"("party") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PlanInstalment" ADD CONSTRAINT "PlanInstalment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PaymentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_party_fkey" FOREIGN KEY ("party") REFERENCES "Account"("party") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CollectionLog" ADD CONSTRAINT "CollectionLog_party_fkey" FOREIGN KEY ("party") REFERENCES "Account"("party") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AccountHistory" ADD CONSTRAINT "AccountHistory_party_fkey" FOREIGN KEY ("party") REFERENCES "Account"("party") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PointEvent" ADD CONSTRAINT "PointEvent_party_fkey" FOREIGN KEY ("party") REFERENCES "Account"("party") ON DELETE NO ACTION ON UPDATE NO ACTION;
