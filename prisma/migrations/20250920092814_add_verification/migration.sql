-- CreateEnum
CREATE TYPE "public"."OrgVerificationMethod" AS ENUM ('INVITE', 'DOMAIN', 'ADMIN');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "orgVerificationMethod" "public"."OrgVerificationMethod",
ADD COLUMN     "orgVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."EmailVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrganizationDomain" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "addedById" TEXT,

    CONSTRAINT "OrganizationDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrgInvite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL DEFAULT 'USER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "OrgInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerification_tokenHash_key" ON "public"."EmailVerification"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerification_userId_idx" ON "public"."EmailVerification"("userId");

-- CreateIndex
CREATE INDEX "EmailVerification_expiresAt_idx" ON "public"."EmailVerification"("expiresAt");

-- CreateIndex
CREATE INDEX "OrganizationDomain_orgId_idx" ON "public"."OrganizationDomain"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationDomain_orgId_domain_key" ON "public"."OrganizationDomain"("orgId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvite_tokenHash_key" ON "public"."OrgInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "OrgInvite_orgId_idx" ON "public"."OrgInvite"("orgId");

-- CreateIndex
CREATE INDEX "OrgInvite_email_idx" ON "public"."OrgInvite"("email");

-- CreateIndex
CREATE INDEX "OrgInvite_expiresAt_idx" ON "public"."OrgInvite"("expiresAt");

-- CreateIndex
CREATE INDEX "OrgInvite_acceptedAt_idx" ON "public"."OrgInvite"("acceptedAt");

-- CreateIndex
CREATE INDEX "OrgInvite_revokedAt_idx" ON "public"."OrgInvite"("revokedAt");

-- CreateIndex
CREATE INDEX "User_emailVerifiedAt_idx" ON "public"."User"("emailVerifiedAt");

-- CreateIndex
CREATE INDEX "User_orgVerifiedAt_idx" ON "public"."User"("orgVerifiedAt");

-- AddForeignKey
ALTER TABLE "public"."EmailVerification" ADD CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationDomain" ADD CONSTRAINT "OrganizationDomain_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationDomain" ADD CONSTRAINT "OrganizationDomain_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrgInvite" ADD CONSTRAINT "OrgInvite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrgInvite" ADD CONSTRAINT "OrgInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
