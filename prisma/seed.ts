// prisma/seed.ts
/* eslint-disable no-console */
import { PrismaClient, Role, CollaborationRole, JobStatus, JobType, ConnectorType, AuditActorType, OrgVerificationMethod } from "@prisma/client";
import argon2 from "argon2";
import crypto from "node:crypto";

const prisma = new PrismaClient();

/** Generate a URL-safe random token and its SHA-256 hex hash (store hash only). */
function mintToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(24).toString("base64url"); // raw token to email/display
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

/** Helper to log a section */
function banner(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  banner("Seeding Outliers baseline data");

  // ---------- 1) Create (or find) an Organization ----------
  const orgName = "Outliers Labs";
  let org = await prisma.organization.findFirst({ where: { name: orgName } });

  if (!org) {
    org = await prisma.organization.create({
      data: { name: orgName },
    });
    console.log("Created Organization:", org.name, org.id);
  } else {
    console.log("Found existing Organization:", org.name, org.id);
  }

  // ---------- 2) Create OWNER user (idempotent by email) ----------
  const ownerEmail = "owner@outliers.test";
  const ownerPassword = "ChangeMe!123"; // for local dev only
  const passwordHash = await argon2.hash(ownerPassword);

  let owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        orgId: org.id,
        email: ownerEmail,
        passwordHash,
        role: Role.OWNER,
        // We'll verify both email & org membership below to demo flows
      },
    });
    console.log("Created OWNER user:", owner.email, owner.id);
  } else {
    // If user exists but belongs to a different org (edge case), move them for local dev convenience
    if (owner.orgId !== org.id) {
      owner = await prisma.user.update({
        where: { id: owner.id },
        data: { orgId: org.id },
      });
    }
    console.log("Found existing OWNER user:", owner.email, owner.id);
  }

  // ---------- 3) Email verification token for OWNER (store hash only) ----------
  // We create a fresh token that expires in 24h if the user isn't already verified.
  if (!owner.emailVerifiedAt) {
    const { token: emailVerifyToken, tokenHash: emailVerifyHash } = mintToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Invalidate prior tokens (optional) for a clean slate in local dev
    await prisma.emailVerification.deleteMany({ where: { userId: owner.id } });

    await prisma.emailVerification.create({
      data: {
        userId: owner.id,
        tokenHash: emailVerifyHash,
        expiresAt,
      },
    });

    console.log("Email verification token (RAW, display only in dev):", emailVerifyToken);
    console.log("Use this token in your verification callback flow.");
  } else {
    console.log("OWNER email already verified at:", owner.emailVerifiedAt.toISOString());
  }

  // ---------- 4) Organization domain (verified) ----------
  // Useful for auto-verifying org membership by email domain later.
  const domain = "outliers.test";
  const existingDomain = await prisma.organizationDomain.findUnique({
    where: { orgId_domain: { orgId: org.id, domain } },
  });

  if (!existingDomain) {
    await prisma.organizationDomain.create({
      data: {
        orgId: org.id,
        domain,
        verifiedAt: new Date(),
        addedById: owner.id,
      },
    });
    console.log("Added verified OrganizationDomain:", domain);
  } else {
    console.log("Found OrganizationDomain:", domain);
  }

  // ---------- 5) OrgInvite for a new member ----------
  // Create an invite for a second user you'll test with.
  const inviteeEmail = "analyst@outliers.test";
  const { token: inviteToken, tokenHash: inviteHash } = mintToken();
  const inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Clean up stale invites for this email (local dev convenience)
  await prisma.orgInvite.deleteMany({
    where: { orgId: org.id, email: inviteeEmail },
  });

  await prisma.orgInvite.create({
    data: {
      orgId: org.id,
      email: inviteeEmail,
      role: Role.USER,
      tokenHash: inviteHash,
      expiresAt: inviteExpires,
      createdById: owner.id,
    },
  });

  console.log("Org invite (RAW token, display only in dev):", inviteToken);
  console.log("Invite email:", inviteeEmail);

  // ---------- 6) Mark OWNER as verified (email + org) to demo completed state ----------
  // (In a real flow, you'll set these during the actual verify/accept handlers.)
  if (!owner.emailVerifiedAt) {
    owner = await prisma.user.update({
      where: { id: owner.id },
      data: {
        emailVerifiedAt: new Date(),
      },
    });
    console.log("Marked OWNER emailVerifiedAt now.");
  }
  if (!owner.orgVerifiedAt) {
    owner = await prisma.user.update({
      where: { id: owner.id },
      data: {
        orgVerifiedAt: new Date(),
        orgVerificationMethod: OrgVerificationMethod.ADMIN,
      },
    });
    console.log("Marked OWNER orgVerifiedAt via ADMIN override.");
  }

  // ---------- 7) Sample Dataset + Consent (metadata only, no PII) ----------
  let dataset = await prisma.dataset.findFirst({
    where: { orgId: org.id, name: "Example Transactions" },
  });
  if (!dataset) {
    dataset = await prisma.dataset.create({
      data: {
        orgId: org.id,
        name: "Example Transactions",
        connectorType: ConnectorType.S3,
        resourceUri: "s3://outliers-example/txns.parquet",
        description: "Sample dataset for local dev; contains no real PII.",
        encManifest: { alg: "AES-GCM", kid: "local-dev", note: "placeholder only" },
      },
    });
    console.log("Created Dataset:", dataset.name);
    await prisma.consent.create({
      data: {
        datasetId: dataset.id,
        purpose: "aggregate analytics",
        jurisdiction: "MW",
        retentionDays: 90,
      },
    });
    console.log("Attached Consent: aggregate analytics (MW, 90 days)");
  } else {
    console.log("Found existing Dataset:", dataset.name);
  }

  // ---------- 8) A simple Collaboration with two org participants (owner org twice for demo) ----------
  // (In real life you'd have two different orgs. For local dev we demonstrate structure.)
  let collab = await prisma.collaboration.findFirst({
    where: { ownerOrgId: org.id, name: "Demo Analytics Collaboration" },
  });
  if (!collab) {
    collab = await prisma.collaboration.create({
      data: {
        ownerOrgId: org.id,
        name: "Demo Analytics Collaboration",
        purpose: "Run privacy-preserving aggregates for benchmarking",
      },
    });
    console.log("Created Collaboration:", collab.name);

    await prisma.collaborationParticipant.createMany({
      data: [
        { collaborationId: collab.id, orgId: org.id, role: CollaborationRole.PROVIDER },
        { collaborationId: collab.id, orgId: org.id, role: CollaborationRole.CONSUMER }, // same org twice just for dev shape
      ],
      skipDuplicates: true,
    });
    console.log("Added CollaborationParticipants (PROVIDER, CONSUMER) for demo.");
  } else {
    console.log("Found Collaboration:", collab.name);
  }

  // ---------- 9) A demo SMPC job + event trail ----------
  const job = await prisma.job.create({
    data: {
      collaborationId: collab.id,
      type: JobType.SMPC,
      status: JobStatus.PENDING,
      input: {
        query: "SUM(amount) BY month",
        datasets: [{ id: dataset.id, fields: ["amount", "ts"] }],
      },
    },
  });
  console.log("Created Job:", job.id);

  await prisma.jobEvent.createMany({
    data: [
      { jobId: job.id, type: "QUEUED", newStatus: JobStatus.PENDING, data: { note: "job created" } },
      { jobId: job.id, type: "STARTED", oldStatus: JobStatus.PENDING, newStatus: JobStatus.RUNNING },
      {
        jobId: job.id,
        type: "PROGRESS",
        data: { step: "smpc_init", message: "session established" },
      },
      {
        jobId: job.id,
        type: "COMPLETED",
        oldStatus: JobStatus.RUNNING,
        newStatus: JobStatus.SUCCEEDED,
        data: { resultPreview: { month: "2025-01", total: 12345 } },
      },
    ],
    skipDuplicates: true,
  });

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: JobStatus.SUCCEEDED,
      artifactUri: "s3://outliers-example/jobs/" + job.id + "/artifact.json",
      result: { totals: [{ month: "2025-01", total: 12345 }] },
    },
  });
  console.log("Updated Job to SUCCEEDED with artifactUri and result.");

  // ---------- 10) A couple of AuditLog rows ----------
  await prisma.auditLog.createMany({
    data: [
      {
        orgId: org.id,
        actorType: AuditActorType.USER,
        actorUserId: owner.id,
        action: "DATASET_CREATE",
        details: { datasetId: dataset.id, name: dataset.name },
      },
      {
        orgId: org.id,
        actorType: AuditActorType.USER,
        actorUserId: owner.id,
        action: "JOB_STATUS_CHANGE",
        details: { jobId: job.id, to: "SUCCEEDED" },
      },
    ],
    skipDuplicates: true,
  });
  console.log("Wrote sample AuditLogs.");
}

main()
  .then(async () => {
    banner("Seed complete");
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
