// test-manual.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

console.log("🔧 Manual MP-SPDZ Test\n");

// Test the two-step process manually
const mpspdzPath = "/home/duane-vaultstring/MP-SPDZ";

// Step 1: Create a test program
const program = `# Manual test
print_str('Starting manual test...\\n')

# Define inputs
a = sint(100)
b = sint(200)

# Perform computation
sum_result = a + b
diff_result = a - b
prod_result = a * b

# Output results
print_ln('SUM: %s', sum_result.reveal())
print_ln('DIFFERENCE: %s', diff_result.reveal())
print_ln('PRODUCT: %s', prod_result.reveal())
print_str('Test complete!\\n')`;

const programFile = path.join(mpspdzPath, "manual_test.mpc");
fs.writeFileSync(programFile, program);
console.log("1. Created test program");

// Step 2: Compile
console.log("2. Compiling...");
try {
  const compileOutput = execSync(
    `cd "${mpspdzPath}" && ./mpc manual_test.mpc`,
    { encoding: 'utf-8' }
  );
  console.log("   Compilation successful");
  console.log(compileOutput.split('\n').slice(0, 10).join('\n') + "\n   ...");
} catch (error: any) {
  console.error("   Compilation failed:", error.message);
  process.exit(1);
}

// Step 3: Execute
console.log("3. Executing...");
try {
  const startTime = Date.now();
  const execOutput = execSync(
    `cd "${mpspdzPath}" && ./mascot-party.x -N 2 -l manual_test`,
    { encoding: 'utf-8', timeout: 30000 }
  );
  const endTime = Date.now();
  
  console.log(`   Execution successful (${endTime - startTime}ms)`);
  console.log("\n" + "=".repeat(50));
  console.log(execOutput);
  console.log("=".repeat(50));
  
  // Parse results
  const sumMatch = execOutput.match(/SUM:\s*(\d+)/);
  const diffMatch = execOutput.match(/DIFFERENCE:\s*(\d+)/);
  const prodMatch = execOutput.match(/PRODUCT:\s*(\d+)/);
  
  if (sumMatch) {
    const sum = parseInt(sumMatch[1], 10);
    console.log(`\n✅ SUM: 100 + 200 = ${sum} ${sum === 300 ? '✓' : '✗'}`);
  }
  if (diffMatch) {
    const diff = parseInt(diffMatch[1], 10);
    console.log(`✅ DIFFERENCE: 100 - 200 = ${diff} ${diff === -100 ? '✓' : '✗'}`);
  }
  if (prodMatch) {
    const prod = parseInt(prodMatch[1], 10);
    console.log(`✅ PRODUCT: 100 * 200 = ${prod} ${prod === 20000 ? '✓' : '✗'}`);
  }
  
} catch (error: any) {
  console.error("   Execution failed:", error.message);
  if (error.stderr) {
    console.error("   Stderr:", error.stderr.toString());
  }
}

// Cleanup
console.log("\n4. Cleaning up...");
try {
  fs.unlinkSync(programFile);
  console.log("   Removed program file");
  
  const scheduleFile = path.join(mpspdzPath, "Programs", "Schedules", "manual_test.sch");
  const bytecodeFile = path.join(mpspdzPath, "Programs", "Bytecode", "manual_test-0.bc");
  
  if (fs.existsSync(scheduleFile)) fs.unlinkSync(scheduleFile);
  if (fs.existsSync(bytecodeFile)) fs.unlinkSync(bytecodeFile);
  console.log("   Removed compiled files");
  
} catch (error) {
  console.log("   Cleanup warnings (can be ignored)");
}

console.log("\n🎉 Manual test completed!");