// src/pet/smpc.ts
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { writeJsonArtifact, buildArtifactUri } from "../lib/artifacts";


/**
 * Shape of the SMPC spec that the adapter expects.
 * This should mirror what you store under job.input.spec for SMPC jobs.
 */
export type SmpcRunInput = {
  operation: "COUNT" | "SUM" | "AVG";
  datasets: { datasetId: string; fields: string[] }[];
  groupBy?: string[];
  filters?: Array<{ field: string; op: string; value: unknown }>;
};

export type SmpcRunResult = {
  artifactUri: string | null;
  result: unknown;
};

/**
 * Lightweight runtime validation for SMPC specs.
 * This keeps bad specs from reaching the engine and produces
 * regular JS errors that callers can catch.
 */
function assertValidSmpcRunInput(input: SmpcRunInput): void {
  if (!input) {
    throw new TypeError("SMPC spec is required");
  }

  if (!["COUNT", "SUM", "AVG"].includes(input.operation)) {
    throw new TypeError(`Unsupported SMPC operation: ${String(input.operation)}`);
  }

  if (!Array.isArray(input.datasets) || input.datasets.length === 0) {
    throw new TypeError("SMPC spec must include at least one dataset");
  }

  for (const ds of input.datasets) {
    if (!ds.datasetId || typeof ds.datasetId !== "string") {
      throw new TypeError("Each dataset must have a non empty datasetId");
    }
    if (!Array.isArray(ds.fields) || ds.fields.length === 0) {
      throw new TypeError(`Dataset ${ds.datasetId} must have at least one field`);
    }
  }

  if (input.groupBy && !Array.isArray(input.groupBy)) {
    throw new TypeError("groupBy, if provided, must be an array of field names");
  }

  if (input.filters && !Array.isArray(input.filters)) {
    throw new TypeError("filters, if provided, must be array");
  }
}

/**
 * Single synchronous style entrypoint for running an SMPC job.
 *
 * It:
 * - Validates the spec.
 * - Executes the SMPC backend or stub.
 * - Returns a serializable result and an artifactUri string.
 *
 * It has no dependency on Express or HTTP concepts and only throws
 * regular JS errors that callers can catch and map to FAILED jobs.
 */
export async function runSMPC(spec: SmpcRunInput, jobId?: string): Promise<SmpcRunResult> {
  // Validate the spec up front. Any error here is a regular JS error.
  assertValidSmpcRunInput(spec);

  // Simulate some work and produce deterministic stub output for the MVP.
  // Later this is where you integrate the real SMPC engine and artifact writer.
  const result =
    spec.operation === "COUNT"
      ? { total: 1337 }
      : spec.operation === "SUM"
      ? { sum: 424242 }
      : { avg: 123.45 };

  // Default filename as per requirements
  const filename = "result.json";
  
  let artifactUri: string | null = null;
  
  // Only write artifacts if we have a jobId (required for directory structure)
  if (jobId) {
    try {
      // Write the result as an artifact
      artifactUri = await writeJsonArtifact(jobId, filename, {
        result,
        spec,
        timestamp: new Date().toISOString(),
        operation: spec.operation,
      });
    } catch (error) {
      // If artifact writing fails, we still return the result
      // but log the error (in real implementation, you might want to handle this differently)
      console.error(`Failed to write artifact for job ${jobId}:`, error);
      
      // Fallback to building URI without writing
      artifactUri = buildArtifactUri(jobId, filename);
    }
  }

  return { artifactUri, result };
}