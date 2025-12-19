// src/controllers/artifacts.controller.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../db/prisma";
import { getInput } from "../../middleware/validate";
import { jobIdParamSchema } from "../../schemas/jobs";
import { JobStatus } from "@prisma/client";
import { 
  getArtifactPath, 
  createArtifactReadStream, 
  getArtifactStats,
  extractFilenameFromUri,
  getDefaultArtifactFilename,
  artifactExists 
} from "../../lib/artifacts";
import fs from "fs/promises";
import path from "path";
import { writeAudit } from "../../lib/audit";

/**
 * GET /v1/jobs/:id/artifact
 * Secure artifact download endpoint.
 * 
 * Checks scope (owner or participant), validates job has artifact,
 * streams the artifact file with appropriate headers.
 */
export async function downloadJobArtifact(req: Request, res: Response, next: NextFunction) {
  try {
    const { params } = getInput<{ params: typeof jobIdParamSchema }>(res);
    const jobId = params!.id;
    const callerOrgId = (res.locals as any).orgId as string;

    // Scope check: caller must be owner or participant of the job's collaboration
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        collaboration: {
          OR: [{ ownerOrgId: callerOrgId }, { participants: { some: { orgId: callerOrgId } } }],
        },
      },
      select: {
        id: true,
        collaborationId: true,
        status: true,
        artifactUri: true,
        type: true,
      },
    });

    if (!job) {
      return res.status(404).json({
        error: { code: "JOB_NOT_FOUND", message: "Not found or not permitted." },
      });
    }

    // Check if job has an artifact
    if (!job.artifactUri) {
      return res.status(404).json({
        error: { code: "ARTIFACT_NOT_FOUND", message: "No artifact available for this job." },
      });
    }

    // Check if job is in a state where artifact should be available
    if (job.status !== JobStatus.SUCCEEDED && job.status !== JobStatus.FAILED) {
      return res.status(409).json({
        error: { code: "INVALID_STATE", message: "Job artifact not available in current state." },
      });
    }

    // Extract filename from artifact URI or use default
    let filename = extractFilenameFromUri(job.artifactUri);
    if (!filename) {
      filename = getDefaultArtifactFilename();
    }

    // Security: Validate filename doesn't contain path traversal attempts
    if (filename.includes('..') || path.isAbsolute(filename)) {
      return res.status(400).json({
        error: { code: "INVALID_FILENAME", message: "Invalid artifact filename." },
      });
    }

    // Check if artifact file exists on disk
    const artifactExists = await checkArtifactExists(jobId, filename);
    if (!artifactExists) {
      return res.status(404).json({
        error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact file not found on disk." },
      });
    }

    // Get file stats for headers
    const filePath = getArtifactPath(jobId, filename);
    const stats = await getArtifactStats(jobId, filename);

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', stats.size.toString());
    res.setHeader('Content-Disposition', `attachment; filename="${jobId}-${filename}"`);
    res.setHeader('Last-Modified', stats.mtime.toUTCString());
    res.setHeader('Cache-Control', 'private, max-age=3600'); // 1 hour cache for private artifacts

    // Stream the file
    const readStream = createArtifactReadStream(jobId, filename);
    
    // Handle stream errors
    readStream.on('error', (error) => {
      console.error(`Error streaming artifact for job ${jobId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          error: { code: "STREAM_ERROR", message: "Failed to stream artifact." },
        });
      }
    });

    // Pipe the stream to response
    readStream.pipe(res);

    // Log audit event
    await writeAudit(req, callerOrgId, "ARTIFACT_DOWNLOAD", { 
      jobId, 
      filename,
      fileSize: stats.size,
      status: job.status 
    });

  } catch (err) {
    return next(err);
  }
}

/**
 * GET /v1/jobs/:id/artifact/info
 * Get artifact metadata without downloading the file.
 */
export async function getArtifactInfo(req: Request, res: Response, next: NextFunction) {
  try {
    const { params } = getInput<{ params: typeof jobIdParamSchema }>(res);
    const jobId = params!.id;
    const callerOrgId = (res.locals as any).orgId as string;

    // Scope check: caller must be owner or participant of the job's collaboration
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        collaboration: {
          OR: [{ ownerOrgId: callerOrgId }, { participants: { some: { orgId: callerOrgId } } }],
        },
      },
      select: {
        id: true,
        collaborationId: true,
        status: true,
        artifactUri: true,
        type: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!job) {
      return res.status(404).json({
        error: { code: "JOB_NOT_FOUND", message: "Not found or not permitted." },
      });
    }

    // Extract filename from artifact URI or use default
    let filename = extractFilenameFromUri(job.artifactUri);
    if (!filename) {
      filename = getDefaultArtifactFilename();
    }

    let fileInfo = null;
    try {
      const stats = await getArtifactStats(jobId, filename);
      fileInfo = {
        exists: true,
        filename,
        size: stats.size,
        lastModified: stats.mtime,
        contentType: 'application/json',
      };
    } catch (error) {
      fileInfo = {
        exists: false,
        filename,
        size: 0,
        lastModified: null,
        contentType: 'application/json',
      };
    }

    return res.status(200).json({
      jobId,
      artifactUri: job.artifactUri,
      status: job.status,
      fileInfo,
      downloadUrl: `/v1/jobs/${jobId}/artifact`,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Helper function to check if artifact exists with proper error handling
 */
async function checkArtifactExists(jobId: string, filename: string): Promise<boolean> {
  try {
    return await artifactExists(jobId, filename);
  } catch (error) {
    console.error(`Error checking artifact existence for job ${jobId}:`, error);
    return false;
  }
}