import type { Request, Response, NextFunction, RequestHandler } from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { prisma } from "../../db/prisma";
import { getInput } from "../../middleware/validate";
import { shareIdParamSchema, uploadShareBodySchema } from "../../schemas/shares";
import { jobIdParamSchema } from "../../schemas/jobs";
import { writeAudit } from "../../lib/audit";
import { appendJobEvent } from "../../lib/jobs-events";
import { JobEventType, JobStatus, CollaborationRole } from "@prisma/client";
import { shareConfig } from "../../config/env";



// Configure multer for in-memory storage (we'll write to disk ourselves)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    // Accept any file type for now, but could restrict to .txt, .bin, etc.
    if (file.mimetype === 'text/plain' || 
        file.mimetype === 'application/octet-stream' ||
        file.originalname.match(/\.(txt|bin|data)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only text or binary files are allowed'));
    }
  },
});

/**
 * Get or create the share upload directory for a job
 */
async function ensureShareDirectory(jobId: string): Promise<string> {
  // Use config instead of hardcoded /tmp
  const shareDir = path.join(shareConfig.storageRoot, `job_${jobId}`);
  
  try {
    await fs.access(shareDir);
  } catch {
    await fs.mkdir(shareDir, { recursive: true });
    await fs.chmod(shareDir, 0o700); // Secure permissions: owner only
  }
  
  return shareDir;
}

/**
 * Determine party ID for an organization in a collaboration
 */
async function getPartyIdForOrg(
  collaborationId: string, 
  orgId: string
): Promise<number> {
  // Get all participants in order (owner first, then participants by createdAt)
  const collaboration = await prisma.collaboration.findUnique({
    where: { id: collaborationId },
    select: {
      ownerOrgId: true,
      participants: {
        orderBy: { createdAt: 'asc' },
        select: { orgId: true }
      }
    }
  });

  if (!collaboration) {
    throw new Error("Collaboration not found");
  }

  // Create ordered list: owner first, then participants
  const orderedOrgs = [
    collaboration.ownerOrgId,
    ...collaboration.participants.map(p => p.orgId)
  ];

  // Remove duplicates
  const uniqueOrgs = Array.from(new Set(orderedOrgs));
  
  const partyId = uniqueOrgs.indexOf(orgId);
  if (partyId === -1) {
    throw new Error("Organization is not a participant in this collaboration");
  }

  return partyId;
}

/**
 * Check if all required shares have been uploaded
 */
async function checkAllSharesUploaded(jobId: string, totalParties: number): Promise<boolean> {
  const shareDir = path.join("/tmp", `job_${jobId}`, "Player-Data");
  
  try {
    await fs.access(shareDir);
    const files = await fs.readdir(shareDir);
    
    // Check for Input-P{partyId}-0 files
    const uploadedParties = new Set<number>();
    
    for (const file of files) {
      const match = file.match(/^Input-P(\d+)-0$/);
      if (match) {
        uploadedParties.add(parseInt(match[1], 10));
      }
    }
    
    return uploadedParties.size >= totalParties;
  } catch {
    return false;
  }
}

/** POST /v1/jobs/:id/shares - Upload a share file */
export async function uploadShare(req: Request, res: Response, next: NextFunction) {
  try {
    const { params, body } = getInput<{
      params: typeof jobIdParamSchema;
      body: typeof uploadShareBodySchema;
    }>(res);
    
    const jobId = params!.id;
    const callerOrgId = (res.locals as any).orgId as string;
    const file = (req as any).file;
    
    if (!file) {
      return res.status(400).json({
        error: { code: "NO_FILE", message: "No file uploaded" }
      });
    }

    // Get job with collaboration details
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        collaboration: {
          OR: [
            { ownerOrgId: callerOrgId },
            { participants: { some: { orgId: callerOrgId } } }
          ]
        },
      },
      select: {
        id: true,
        status: true,
        collaborationId: true,
        collaboration: {
          select: {
            ownerOrgId: true,
            participants: {
              select: { orgId: true }
            }
          }
        }
      },
    });

    if (!job) {
      return res.status(404).json({
        error: { code: "JOB_NOT_FOUND", message: "Job not found or not authorized" }
      });
    }

    // Check job status
    if (job.status !== JobStatus.PENDING) {
      return res.status(409).json({
        error: { 
          code: "INVALID_STATE", 
          message: `Cannot upload shares for job in ${job.status} state` 
        }
      });
    }

    // Determine party ID
    let partyId: number;
    if (body?.partyId !== undefined) {
      // Use provided partyId if authorized
      partyId = body.partyId;
      // Verify this org can use this partyId
      const expectedPartyId = await getPartyIdForOrg(job.collaborationId, callerOrgId);
      if (partyId !== expectedPartyId) {
        return res.status(403).json({
          error: { 
            code: "INVALID_PARTY", 
            message: `Your organization is assigned to party ${expectedPartyId}, not ${partyId}` 
          }
        });
      }
    } else {
      // Auto-assign partyId
      partyId = await getPartyIdForOrg(job.collaborationId, callerOrgId);
    }

    // Ensure share directory exists
    const shareDir = await ensureShareDirectory(jobId);
    const playerDataDir = path.join(shareDir, "Player-Data");
    
    try {
      await fs.access(playerDataDir);
    } catch {
      await fs.mkdir(playerDataDir, { recursive: true });
      await fs.chmod(playerDataDir, 0o700);
    }

    // Save the file with MP-SPDZ naming convention
    const filename = `Input-P${partyId}-0`;
    const filePath = path.join(playerDataDir, filename);
    
    await fs.writeFile(filePath, file.buffer);
    await fs.chmod(filePath, 0o600); // Secure permissions

    // Record upload event
    await appendJobEvent({
      jobId,
      type: JobEventType.PROGRESS,
      data: {
        action: "SHARE_UPLOADED",
        partyId,
        organizationId: callerOrgId,
        filename: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      },
    });

    await writeAudit(req, callerOrgId, "SHARE_UPLOAD", {
      jobId,
      partyId,
      filename: file.originalname,
      size: file.size,
    });

    // Check if all shares are uploaded
    const totalParties = 1 + job.collaboration.participants.length; // owner + participants
    const allSharesUploaded = await checkAllSharesUploaded(jobId, totalParties);

    return res.status(200).json({
      ok: true,
      partyId,
      filename,
      path: filePath,
      allSharesUploaded,
      message: allSharesUploaded 
        ? "All required shares have been uploaded. Job can now be started." 
        : "Share uploaded successfully. Waiting for other parties."
    });

  } catch (err) {
    return next(err);
  }
}

/** GET /v1/jobs/:id/shares/status - Check share upload status */
export async function getShareStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { params } = getInput<{ params: typeof jobIdParamSchema }>(res);
    const jobId = params!.id;
    const callerOrgId = (res.locals as any).orgId as string;

    // Verify authorization
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        collaboration: {
          OR: [
            { ownerOrgId: callerOrgId },
            { participants: { some: { orgId: callerOrgId } } }
          ]
        },
      },
      select: {
        id: true,
        collaborationId: true,
        collaboration: {
          select: {
            ownerOrgId: true,
            participants: {
              select: { orgId: true }
            }
          }
        }
      },
    });

    if (!job) {
      return res.status(404).json({
        error: { code: "JOB_NOT_FOUND", message: "Job not found or not authorized" }
      });
    }

    const totalParties = 1 + job.collaboration.participants.length;
    const shareDir = path.join("/tmp", `job_${jobId}`, "Player-Data");
    
    let uploadedParties: number[] = [];
    let missingParties: number[] = [];
    
    try {
      await fs.access(shareDir);
      const files = await fs.readdir(shareDir);
      
      // Find all uploaded party files
      const uploadedSet = new Set<number>();
      for (const file of files) {
        const match = file.match(/^Input-P(\d+)-0$/);
        if (match) {
          uploadedSet.add(parseInt(match[1], 10));
        }
      }
      
      uploadedParties = Array.from(uploadedSet).sort((a, b) => a - b);
      
      // Determine missing parties
      for (let i = 0; i < totalParties; i++) {
        if (!uploadedSet.has(i)) {
          missingParties.push(i);
        }
      }
    } catch {
      // Directory doesn't exist yet, all parties are missing
      for (let i = 0; i < totalParties; i++) {
        missingParties.push(i);
      }
    }

    // Get party ID for the caller
    const callerPartyId = await getPartyIdForOrg(job.collaborationId, callerOrgId);

    return res.status(200).json({
      jobId,
      totalParties,
      uploadedParties,
      missingParties,
      callerPartyId,
      allSharesUploaded: missingParties.length === 0,
      shareDirectory: `/tmp/job_${jobId}/Player-Data`,
    });

  } catch (err) {
    return next(err);
  }
}

// Export multer middleware for use in routes
export const shareUploadMiddleware: RequestHandler = upload.single('share');
