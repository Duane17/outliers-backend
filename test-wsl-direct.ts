// test-wsl-direct.ts - Simpler approach
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

console.log("🔧 Testing MP-SPDZ via WSL - Direct Method\n");

// Create a temporary .mpc file in Windows
const testProgram = `a = sint(5)
b = sint(7)
c = a + b
print_ln('RESULT: %s', c.reveal())`;

const windowsTempFile = path.join(process.env.TEMP || "/tmp", `mpc-test-${Date.now()}.mpc`);
fs.writeFileSync(windowsTempFile, testProgram);
console.log(`1. Created temporary file: ${windowsTempFile}`);

try {
  // Convert Windows path to WSL path
  const wslTempFile = windowsTempFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (match, drive) => `/mnt/${drive.toLowerCase()}`);
  
  console.log(`2. WSL path: ${wslTempFile}`);
  
  // Copy to WSL home directory
  const wslTargetFile = `/home/duane-vaultstring/test_${Date.now()}.mpc`;
  execSync(`wsl cp "${wslTempFile}" "${wslTargetFile}"`, { stdio: 'pipe' });
  console.log(`3. Copied to WSL: ${wslTargetFile}`);
  
  // Run the test in WSL
  console.log("4. Running in WSL...");
  
  const commands = `
cd /home/duane-vaultstring/MP-SPDZ
echo "Compiling..."
./mpc "${wslTargetFile}"
echo "Executing..."
./mascot-party.x -N 2 -l "$(basename "${wslTargetFile}" .mpc)"
`;
  
  console.log("Running commands:");
  console.log(commands);
  
  const output = execSync(`wsl bash -c ${JSON.stringify(commands)}`, {
    encoding: 'utf-8',
    timeout: 30000
  });
  
  console.log("\n5. Output:");
  console.log("=".repeat(50));
  console.log(output);
  console.log("=".repeat(50));
  
  // Parse result
  const match = output.match(/RESULT:\s*(\d+)/);
  if (match) {
    const result = parseInt(match[1], 10);
    console.log(`\n✅ RESULT: ${result} (5 + 7 = ${result})`);
    if (result === 12) {
      console.log("🎉 Perfect! MP-SPDZ is working.");
    }
  }
  
} catch (error: any) {
  console.error("\n❌ ERROR:", error.message);
  if (error.stderr) {
    console.error("Stderr:", error.stderr.toString());
  }
} finally {
  // Cleanup
  try {
    fs.unlinkSync(windowsTempFile);
    console.log(`\nCleaned up: ${windowsTempFile}`);
  } catch (e) {
    // Ignore
  }
}