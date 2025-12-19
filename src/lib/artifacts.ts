// src/lib/artifacts.ts
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { env } from '../config/env';

/**
 * Ensures the artifact directory for a specific job exists.
 * Returns the absolute directory path.
 */
export async function ensureArtifactDir(jobId: string): Promise<string> {
  const dirPath = path.join(env.artifact.root, jobId);
  
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
  
  return dirPath;
}

/**
 * Writes JSON data to an artifact file for a specific job.
 * Returns the artifact URI for storage in the database.
 */
export async function writeJsonArtifact(
  jobId: string,
  filename: string,
  data: unknown
): Promise<string> {
  // Ensure directory exists
  const dirPath = await ensureArtifactDir(jobId);
  
  // Construct file path
  const filePath = path.join(dirPath, filename);
  
  // Write JSON data with pretty formatting for readability
  const jsonContent = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, jsonContent, 'utf-8');
  
  // Return the artifact URI
  return buildArtifactUri(jobId, filename);
}

/**
 * Builds an artifact URI for a job and filename.
 * This does NOT write to disk - use for constructing URIs only.
 */
export function buildArtifactUri(jobId: string, filename: string): string {
  if (env.artifact.publicBase) {
    // Public URL format: http://localhost:4000/artifacts/<jobId>/<filename>
    return `${env.artifact.publicBase}/${jobId}/${filename}`;
  } else {
    // File URL format: file://<absolute-path>/<jobId>/<filename>
    const filePath = path.join(env.artifact.root, jobId, filename);
    return `file://${filePath}`;
  }
}

/**
 * Reads an artifact file for a specific job.
 * Returns the parsed JSON data.
 * @throws {Error} If file doesn't exist or cannot be read
 */
export async function readJsonArtifact<T = unknown>(jobId: string, filename: string): Promise<T> {
  const filePath = path.join(env.artifact.root, jobId, filename);
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Artifact not found: ${jobId}/${filename}`);
    }
    throw error;
  }
}

/**
 * Checks if an artifact file exists for a specific job.
 */
export async function artifactExists(jobId: string, filename: string): Promise<boolean> {
  const filePath = path.join(env.artifact.root, jobId, filename);
  
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the file system path for an artifact.
 * Use this for internal operations, not for public URLs.
 */
export function getArtifactPath(jobId: string, filename: string): string {
  return path.join(env.artifact.root, jobId, filename);
}

/**
 * Gets a read stream for an artifact file.
 * Useful for streaming large files in HTTP responses.
 */
export function createArtifactReadStream(jobId: string, filename: string): fsSync.ReadStream {
  const filePath = getArtifactPath(jobId, filename);
  return fsSync.createReadStream(filePath);
}

/**
 * Gets file stats for an artifact (size, modified time, etc.)
 */
export async function getArtifactStats(jobId: string, filename: string): Promise<fsSync.Stats> {
  const filePath = getArtifactPath(jobId, filename);
  return fs.stat(filePath);
}

/**
 * Extracts filename from artifact URI.
 * Returns null if URI doesn't match expected patterns.
 */
export function extractFilenameFromUri(artifactUri: string | null): string | null {
  if (!artifactUri) return null;
  
  // Extract filename from various URI formats
  const patterns = [
    // file:///path/to/artifacts/jobId/filename
    /file:\/\/.*\/([^\/]+)$/,
    // http://host/artifacts/jobId/filename
    /\/artifacts\/[^\/]+\/([^\/?]+)(?:\?|$)/,
    // Generic URL with last segment as filename
    /\/([^\/?]+)(?:\?|$)/,
  ];
  
  for (const pattern of patterns) {
    const match = artifactUri.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Gets the default artifact filename for a job.
 */
export function getDefaultArtifactFilename(): string {
  return 'result.json';
}