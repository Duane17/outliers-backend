import fs from "fs/promises";
import path from "path";
import { shareConfig } from "../config/env";


/**
 * Clean up old share directories
 * Run this as a cron job to prevent /tmp from filling up
 */
export async function cleanupOldShareDirectories(maxAgeHours: number = 24): Promise<void> {
  const tmpDir = shareConfig.storageRoot;
  const now = Date.now();
  const maxAgeMs = shareConfig.maxAgeHours * 60 * 60 * 1000;

  try {
    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("job_")) {
        const dirPath = path.join(tmpDir, entry.name);
        
        try {
          const stats = await fs.stat(dirPath);
          const ageMs = now - stats.mtimeMs;
          
          if (ageMs > maxAgeMs) {
            await fs.rm(dirPath, { recursive: true, force: true });
            console.log(`Cleaned up old share directory: ${entry.name}`);
          }
        } catch (error) {
          console.warn(`Failed to clean up ${entry.name}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("Failed to cleanup share directories:", error);
  }
}

// Run if called directly
if (require.main === module) {
  cleanupOldShareDirectories().then(() => {
    console.log("Share directory cleanup completed");
    process.exit(0);
  }).catch(error => {
    console.error("Cleanup failed:", error);
    process.exit(1);
  });
}