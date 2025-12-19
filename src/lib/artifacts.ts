// src/lib/artifacts.ts
import fs from 'fs/promises';
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