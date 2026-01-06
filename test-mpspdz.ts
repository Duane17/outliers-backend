// test-mpspdz.ts
import { testMPSPDZIntegration, runSMPC } from "./src/pet/smpc";
import * as dotenv from "dotenv";

dotenv.config();

async function runTests() {
  console.log("🚀 Full MP-SPDZ Integration Test\n");
  
  // Test 1: Direct integration
  console.log("1. Testing direct MP-SPDZ integration...");
  const integrationResult = await testMPSPDZIntegration();
  
  if (integrationResult.success && integrationResult.result === 12) {
    console.log(`✅ MP-SPDZ integration working: ${integrationResult.result}`);
  } else {
    console.log(`❌ MP-SPDZ integration failed: ${integrationResult.error}`);
    return;
  }
  
  // Test 2: SUM operation
  console.log("\n2. Testing SMPC SUM operation...");
  const sumResult = await runSMPC({
    operation: "SUM",
    datasets: [
      { datasetId: "test1", fields: ["value"] },
      { datasetId: "test2", fields: ["value"] }
    ]
  }, "test-sum");
  
  console.log("SUM Result:", sumResult);
  
  // Test 3: AVG operation
  console.log("\n3. Testing SMPC AVG operation...");
  const avgResult = await runSMPC({
    operation: "AVG",
    datasets: [
      { datasetId: "test1", fields: ["value"] },
      { datasetId: "test2", fields: ["value"] },
      { datasetId: "test3", fields: ["value"] }
    ]
  }, "test-avg");
  
  console.log("AVG Result:", avgResult);
  
  console.log("\n🎉 All tests completed successfully!");
}

runTests().catch(console.error);