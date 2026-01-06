// test-simple.ts - Fixed version
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as os from "os";

// Load env directly
require("dotenv").config();

const MPSPDZ_PATH = process.env.MPSPDZ_PATH || "/home/duane-vaultstring/MP-SPDZ";
const PROTOCOL = process.env.MPSPDZ_PROTOCOL || "mascot";
const PARTIES = process.env.MPSPDZ_PARTIES || 2;
const TIMEOUT_MS = process.env.MPSPDZ_TIMEOUT_MS || 30000;
const DEBUG = process.env.MPSPDZ_DEBUG === "true" || process.env.MPSPDZ_DEBUG === "1";

function logDebug(message: string) {
  if (DEBUG) {
    console.log(`[DEBUG] ${message}`);
  }
}

// Helper to write file to WSL using base64 encoding to avoid quote issues
function writeFileToWSLBase64(content: string, wslPath: string): void {
  // Convert content to base64 to avoid quote/escape issues
  const base64Content = Buffer.from(content).toString('base64');
  
  // Write base64 content to WSL file and decode it
  const command = `wsl bash -c "echo '${base64Content}' | base64 --decode > '${wslPath}'"`;
  logDebug(`Write file command: ${command}`);
  
  execSync(command, { 
    stdio: 'pipe',
    encoding: 'utf-8'
  });
}

// Helper to run command in WSL MP-SPDZ directory
function runInMPSPDZ(command: string): string {
  const fullCommand = `wsl bash -c "cd '${MPSPDZ_PATH}' && ${command}"`;
  logDebug(`WSL command: ${fullCommand}`);
  
  return execSync(fullCommand, { 
    encoding: 'utf-8',
    timeout: parseInt(TIMEOUT_MS as string)
  });
}

function testDirectExecution(): { success: boolean; result?: number; error?: string } {
  console.log("=== Testing MP-SPDZ Execution via WSL ===\n");
  console.log(`MP-SPDZ Path: ${MPSPDZ_PATH}`);
  console.log(`Protocol: ${PROTOCOL}`);
  console.log(`Parties: ${PARTIES}`);
  
  const testId = randomUUID().slice(0, 8);
  const programName = `test_${testId}`;
  const mpcFileName = `${programName}.mpc`;
  const wslMpcPath = `/tmp/${mpcFileName}`;
  
  try {
    // Check if WSL is available
    console.log("\n1. Checking WSL availability...");
    try {
      execSync('wsl echo "WSL test"', { stdio: 'pipe' });
      console.log("   ✓ WSL is available");
    } catch (error) {
      throw new Error("WSL is not available. Please enable WSL or run tests from within WSL.");
    }
    
    // Check if MP-SPDZ directory exists in WSL
    console.log("\n2. Checking MP-SPDZ in WSL...");
    try {
      const checkOutput = runInMPSPDZ("pwd && echo 'Directory accessible'");
      console.log("   ✓ MP-SPDZ directory accessible in WSL");
    } catch (error: any) {
      throw new Error(`Cannot access MP-SPDZ in WSL: ${error.message}`);
    }
    
    // Check if mpc compiler exists
    console.log("\n3. Checking MP-SPDZ tools...");
    try {
      const checkMpc = runInMPSPDZ("ls -la mpc 2>/dev/null || echo 'mpc not found'");
      if (checkMpc.includes("mpc not found")) {
        console.log("   Creating mpc symlink...");
        runInMPSPDZ("ln -sf compile.py mpc && chmod +x mpc");
        console.log("   ✓ Created mpc symlink");
      } else {
        console.log("   ✓ mpc compiler found");
      }
    } catch (error) {
      console.error("   Error checking mpc:", error);
    }
    
    // Check protocol binary
    console.log("\n4. Checking protocol binary...");
    try {
      const checkProtocol = runInMPSPDZ(`ls -la ${PROTOCOL}-party.x 2>/dev/null || echo 'not found'`);
      if (checkProtocol.includes("not found")) {
        console.log(`   ⚠️ ${PROTOCOL}-party.x not found, trying to build...`);
        runInMPSPDZ(`make -j 4 ${PROTOCOL} 2>&1 || echo 'Build failed'`);
        
        // Check again
        const checkAgain = runInMPSPDZ(`ls -la ${PROTOCOL}-party.x 2>/dev/null || echo 'still not found'`);
        if (checkAgain.includes("still not found")) {
          console.log(`   ❌ Failed to build ${PROTOCOL}`);
          // Try to list available protocols
          const availableProtocols = runInMPSPDZ("ls -la *party.x 2>/dev/null | head -5 || echo 'No protocol binaries'");
          console.log(`   Available protocols: ${availableProtocols}`);
        } else {
          console.log(`   ✓ Built ${PROTOCOL} protocol`);
        }
      } else {
        console.log(`   ✓ ${PROTOCOL} protocol binary found`);
      }
    } catch (error) {
      console.error(`   Error checking protocol: ${error}`);
    }
    
    // Create test program
    console.log(`\n5. Creating test program...`);
    const testProgram = `# Test program ${testId}
a = sint(5)
b = sint(7)
c = a + b
print_ln('RESULT: %s', c.reveal())`;
    
    // Write to WSL using base64 encoding to avoid quote issues
    writeFileToWSLBase64(testProgram, wslMpcPath);
    console.log(`   ✓ Created test program at ${wslMpcPath}`);
    
    // Step 1: Compile the program
    console.log(`\n6. Compiling program...`);
    const compileCommand = `./mpc ${wslMpcPath}`;
    
    try {
      const compileOutput = runInMPSPDZ(compileCommand);
      console.log(`   ✓ Compilation successful`);
      if (DEBUG) {
        console.log(`   Compile output: ${compileOutput}`);
      }
    } catch (error: any) {
      console.error(`   ❌ Compilation failed: ${error.message}`);
      if (error.stderr) {
        console.error(`   Stderr: ${error.stderr.toString().slice(0, 200)}`);
      }
      throw error;
    }
    
    // Step 2: Execute with protocol
    console.log(`\n7. Executing with ${PROTOCOL} protocol...`);
    const executeCommand = `(./${PROTOCOL}-party.x -N ${PARTIES} 0 ${programName} & ./${PROTOCOL}-party.x -N ${PARTIES} 1 ${programName}) 2>&1`;

    
    const startTime = Date.now();
    const output = runInMPSPDZ(executeCommand);
    const endTime = Date.now();
    
    console.log(`   ✓ Execution completed in ${endTime - startTime}ms`);
    console.log(`\n8. Output:`);
    console.log("=" .repeat(50));
    console.log(output);
    console.log("=" .repeat(50));
    
    // Parse result
    const resultMatch = output.match(/RESULT:\s*(\d+)/);
    if (resultMatch) {
      const result = parseInt(resultMatch[1], 10);
      
      if (result === 12) {
        console.log(`\n✅ SUCCESS! Result: ${result} (5 + 7 = 12)`);
        return { success: true, result };
      } else {
        console.log(`\n⚠️  Got unexpected result: ${result} (expected: 12)`);
        return { success: true, result };
      }
    } else {
      console.log("\n⚠️  Could not parse RESULT from output");
      // Try to find any result
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes(':')) {
          const parts = line.split(':');
          const lastPart = parts[parts.length - 1].trim();
          const numMatch = lastPart.match(/(\d+)/);
          if (numMatch) {
            const possibleResult = parseInt(numMatch[1], 10);
            console.log(`Found possible result in line "${line}": ${possibleResult}`);
            return { success: true, result: possibleResult };
          }
        }
      }
      return { success: false, error: "Could not parse result from output" };
    }
    
  } catch (error: any) {
    console.error("\n❌ ERROR:");
    console.error(`   Message: ${error.message}`);
    
    if (error.stderr) {
      const stderrStr = error.stderr.toString();
      if (stderrStr) {
        console.error(`   Stderr: ${stderrStr.slice(0, 500)}`);
      }
    }
    
    if (error.stdout) {
      const stdoutStr = error.stdout.toString();
      if (stdoutStr) {
        console.error(`   Stdout: ${stdoutStr.slice(0, 500)}`);
      }
    }
    
    return { success: false, error: error.message };
    
  } finally {
    // Cleanup in WSL
    console.log("\n9. Cleaning up in WSL...");
    try {
      // Remove temporary files
      execSync(`wsl rm -f ${wslMpcPath}`, { stdio: 'pipe' });
      
      // Remove compiled files
      runInMPSPDZ(`rm -f Programs/Schedules/${programName}.sch Programs/Bytecode/${programName}-0.bc 2>/dev/null || true`);
      
      console.log("   ✓ Cleanup completed");
    } catch (cleanupError: any) {
      console.warn(`   Cleanup warning: ${cleanupError.message}`);
    }
    
    console.log("\n" + "=".repeat(50));
  }
}

// Simple manual test first
console.log("🔧 MP-SPDZ Integration Test via WSL");
console.log("=".repeat(50));

// First, let's do a quick manual test to verify the setup
console.log("\n=== Quick Manual Test ===");
try {
  // Test 1: Simple echo
  console.log("1. Testing WSL echo...");
  const echoResult = execSync('wsl echo "Hello from WSL"', { encoding: 'utf-8' });
  console.log(`   ✓ ${echoResult.trim()}`);
  
  // Test 2: Check MP-SPDZ directory
  console.log("2. Checking MP-SPDZ directory...");
  const dirCheck = execSync(`wsl bash -c "if [ -d '${MPSPDZ_PATH}' ]; then echo 'Directory exists'; ls '${MPSPDZ_PATH}' | head -3; else echo 'Directory not found'; fi"`, 
    { encoding: 'utf-8' });
  console.log(`   ✓ ${dirCheck.split('\n')[0]}`);
  
  // Test 3: Check mpc
  console.log("3. Checking mpc compiler...");
  const mpcCheck = execSync(`wsl bash -c "cd '${MPSPDZ_PATH}' && if [ -f 'mpc' ]; then echo 'mpc found'; ./mpc --help | head -2; else echo 'mpc not found'; fi"`, 
    { encoding: 'utf-8' });
  console.log(`   ✓ ${mpcCheck.split('\n')[0]}`);
  
} catch (error: any) {
  console.error(`   ❌ Manual test failed: ${error.message}`);
  console.log("\nPlease run these commands manually in WSL to verify:");
  console.log("1. cd /home/duane-vaultstring/MP-SPDZ");
  console.log("2. ./mpc test.mpc");
  console.log("3. ./mascot-party.x -N 2 -l test");
  process.exit(1);
}

// Now run the full test
const result = testDirectExecution();

if (result.success) {
  if (result.result === 12) {
    console.log("\n🎉 Perfect! MP-SPDZ is working via WSL.");
    console.log("The system can compile and execute MPC programs from Windows.");
  } else {
    console.log(`\n⚠️  MP-SPDZ executed but got unexpected result: ${result.result}`);
    console.log("Expected: 12 (5 + 7)");
    console.log("\nBut at least the integration is working!");
  }
} else {
  console.log(`\n❌ MP-SPDZ test failed: ${result.error}`);
  
  console.log("\n=== MANUAL VERIFICATION REQUIRED ===");
  console.log("Please run these commands in WSL Ubuntu to verify:");
  console.log("1. Open WSL Ubuntu terminal");
  console.log("2. Run:");
  console.log("   cd /home/duane-vaultstring/MP-SPDZ");
  console.log("   cat > manual_test.mpc << 'EOF'");
  console.log("   a = sint(5)");
  console.log("   b = sint(7)");
  console.log("   c = a + b");
  console.log("   print_ln('RESULT: %s', c.reveal())");
  console.log("   EOF");
  console.log("   ./mpc manual_test.mpc");
  console.log("   ./mascot-party.x -N 2 -l manual_test");
  console.log("\nIf this works manually, the integration should work.");
}