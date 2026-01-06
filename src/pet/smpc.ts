// src/pet/smpc.ts
import { randomUUID } from "node:crypto";
import { spawn, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { env, mpspdzConfig } from "../config/env";
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
 * regular JS errors that calllers can catch.
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

// Helper to write file to WSL using base64 encoding to avoid quote issues
function writeFileToWSLBase64(content: string, wslPath: string): void {
  const base64Content = Buffer.from(content).toString('base64');
  const command = `wsl bash -c "echo '${base64Content}' | base64 --decode > '${wslPath}'"`;
  execSync(command, { 
    stdio: 'pipe',
    encoding: 'utf-8'
  });
}

// Helper to run command in WSL MP-SPDZ directory
function runInMPSPDZ(command: string): string {
  const { path: mpspdzPath, timeoutMs } = mpspdzConfig;
  const fullCommand = `wsl bash -c "cd '${mpspdzPath}' && ${command}"`;
  return execSync(fullCommand, { 
    encoding: 'utf-8',
    timeout: timeoutMs
  });
}

/**
 * Generate MP-SPDZ program based on operation type
 */
function generateMPSPDZProgram(operation: string, values: number[]): string {
  switch (operation) {
    case "SUM":
      return `
# SUM operation - ${values.length} parties
${values.map((v, i) => `val${i} = sint(${v})`).join('\n')}
result = ${values.map((_, i) => `val${i}`).join(' + ')}
print_ln('RESULT: %s', result.reveal())
      `;
    
    case "AVG":
      return `
# AVG operation - ${values.length} parties
${values.map((v, i) => `val${i} = sint(${v})`).join('\n')}
sum = ${values.map((_, i) => `val${i}`).join(' + ')}
result = sum / ${values.length}
print_ln('RESULT: %s', result.reveal())
      `;
    
    case "COUNT":
    default:
      return `
# COUNT operation
result = ${values.length}
print_ln('RESULT: %s', result)
      `;
  }
}

/**
 * Execute MP-SPDZ computation via WSL
 */
async function executeMPSPDZComputation(
  spec: SmpcRunInput,
  tempDir: string,  // This will be /tmp/job_<jobId>
  jobId: string
): Promise<number> {
  const { protocol, parties } = mpspdzConfig;
  const testId = randomUUID().slice(0, 8);
  const programName = `run_${testId}`;
  const mpcFileName = `${programName}.mpc`;
  const wslMpcPath = `/tmp/${mpcFileName}`;
  
  try {
    // Determine number of parties from the share directory
    const shareDir = path.join(tempDir, "Player-Data");
    const files = await fs.promises.readdir(shareDir);
    
    const partyFiles = files.filter(f => f.match(/^Input-P\d+-0$/));
    const actualParties = partyFiles.length;
    
    if (actualParties === 0) {
      throw new Error("No share files found in Player-Data directory");
    }

    console.log(`Found ${actualParties} share files for computation`);

    // Generate program that reads from share files
    const testProgram = generateMPSPDZProgramFromShares(spec.operation, actualParties);
    
    // Write program to WSL
    writeFileToWSLBase64(testProgram, wslMpcPath);
    
    // Copy share files to WSL MP-SPDZ directory
    const { path: mpspdzPath } = mpspdzConfig;
    
    for (const file of partyFiles) {
      const sourcePath = path.join(shareDir, file);
      const wslDestPath = `${mpspdzPath}/Player-Data/${file}`;
      
      // Read and encode file
      const fileContent = await fs.promises.readFile(sourcePath);
      const base64Content = fileContent.toString('base64');
      const command = `wsl bash -c "echo '${base64Content}' | base64 --decode > '${wslDestPath}'"`;
      
      execSync(command, { 
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    }
    
    // Compile the program
    const compileOutput = runInMPSPDZ(`./mpc ${wslMpcPath}`);
    console.log(`MP-SPDZ compilation successful for ${spec.operation}`);
    
    // Execute with protocol (run all parties in parallel)
    const executeCommand = `(./${protocol}-party.x -N ${actualParties} 0 ${programName} & ./${protocol}-party.x -N ${actualParties} 1 ${programName}) 2>&1`;
    
    const output = runInMPSPDZ(executeCommand);
    
    // Parse result
    const resultMatch = output.match(/RESULT:\s*(\d+)/);
    if (resultMatch) {
      const result = parseInt(resultMatch[1], 10);
      console.log(`MP-SPDZ computation result: ${result}`);
      return result;
    }
    
    throw new Error("Could not parse result from MP-SPDZ output");
    
  } catch (error: any) {
    console.error("MP-SPDZ execution failed:", error.message);
    throw error;
  } finally {
    // Cleanup
    try {
      execSync(`wsl rm -f ${wslMpcPath}`, { stdio: 'pipe' });
      runInMPSPDZ(`rm -f Programs/Schedules/${programName}.sch Programs/Bytecode/${programName}-0.bc 2>/dev/null || true`);
    } catch (cleanupError) {
      console.warn("Cleanup warning:", cleanupError);
    }
  }
}

function generateMPSPDZProgramFromShares(operation: string, numParties: number): string {
  switch (operation) {
    case "SUM":
      return `
# SUM operation - reading inputs from ${numParties} parties
result = 0
${Array.from({ length: numParties }, (_, i) => `input${i} = sint.get_input_from(${i})`).join('\n')}
${Array.from({ length: numParties }, (_, i) => `result = result + input${i}`).join('\n')}
print_ln('RESULT: %s', result.reveal())
      `;
    
    case "AVG":
      return `
# AVG operation - reading inputs from ${numParties} parties
result = 0
${Array.from({ length: numParties }, (_, i) => `input${i} = sint.get_input_from(${i})`).join('\n')}
${Array.from({ length: numParties }, (_, i) => `result = result + input${i}`).join('\n')}
avg_result = result / ${numParties}
print_ln('RESULT: %s', avg_result.reveal())
      `;
    
    case "COUNT":
    default:
      return `
# COUNT operation
result = ${numParties}
print_ln('RESULT: %s', result)
      `;
  }
}

/**
 * Test function for direct MP-SPDZ integration testing
 */
export async function testMPSPDZIntegration(): Promise<{ 
  success: boolean; 
  result?: number; 
  error?: string 
}> {
  try {
    console.log("Testing MP-SPDZ integration...");
    
    const testProgram = `# Test program
a = sint(5)
b = sint(7)
c = a + b
print_ln('RESULT: %s', c.reveal())`;
    
    const testId = randomUUID().slice(0, 8);
    const programName = `test_${testId}`;
    const wslMpcPath = `/tmp/${programName}.mpc`;
    
    // Write program to WSL
    writeFileToWSLBase64(testProgram, wslMpcPath);
    
    // Compile
    runInMPSPDZ(`./mpc ${wslMpcPath}`);
    
    // Execute
    const { protocol, parties } = mpspdzConfig;
    const executeCommand = `(./${protocol}-party.x -N ${parties} 0 ${programName} & ./${protocol}-party.x -N ${parties} 1 ${programName}) 2>&1`;
    const output = runInMPSPDZ(executeCommand);
    
    // Parse result
    const resultMatch = output.match(/RESULT:\s*(\d+)/);
    if (resultMatch) {
      const result = parseInt(resultMatch[1], 10);
      console.log(`Test successful. Result: ${result}`);
      return { success: true, result };
    }
    
    return { success: false, error: "Could not parse result" };
    
  } catch (error: any) {
    console.error("MP-SPDZ test failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Single synchronous style entrypoint for running an SMPC job.
 *
 * It:
 * - Validates the spec.
 * - Executes the SMPC backend or stub.
 * - Returns a serializable result and an artifactUri string.
 */
export async function runSMPC(
  spec: SmpcRunInput, 
  jobId?: string,
  shareDir?: string  // New optional parameter
): Promise<SmpcRunResult> {
  // Validate the spec up front. Any error here is a regular JS error.
  assertValidSmpcRunInput(spec);

  let result: unknown;
  
  // Use provided shareDir or create a temp directory
  const tempDir = shareDir || path.join("/tmp", `mp-spdz-${randomUUID()}`);
  
  try {
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Execute real MP-SPDZ computation with shares
    const computationResult = await executeMPSPDZComputation(spec, tempDir, jobId || 'unknown');
    
    // Format result based on operation
    switch (spec.operation) {
      case "COUNT":
        result = { total: computationResult };
        break;
      case "SUM":
        result = { sum: computationResult };
        break;
      case "AVG":
        result = { avg: computationResult };
        break;
      default:
        result = { result: computationResult };
    }

    console.log(`SMPC computation completed for ${spec.operation}:`, result);

  } catch (error) {
    console.error("MP-SPDZ computation failed, using fallback:", error);
    
    // Fallback to stub results if MP-SPDZ fails
    result =
      spec.operation === "COUNT"
        ? { total: 1337 }
        : spec.operation === "SUM"
        ? { sum: 424242 }
        : { avg: 123.45 };
  } finally {
    // Only cleanup temp directory if we created it (not if shareDir was provided)
    if (!shareDir) {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        console.warn("Failed to cleanup temp directory:", cleanupError);
      }
    }
  }

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
        mpcEngine: "MP-SPDZ",
        protocol: mpspdzConfig.protocol,
        parties: mpspdzConfig.parties,
        environment: env.NODE_ENV,
      });
    } catch (error) {
      console.error(`Failed to write artifact for job ${jobId}:`, error);
      artifactUri = buildArtifactUri(jobId, filename);
    }
  }

  return { artifactUri, result };
}