import { runDataBackup } from "../utils/backupManager.js";

const result = await runDataBackup({ reason: "manual-script" });
if (!result?.ok) {
  console.error("[BACKUP] Thất bại:", result?.error || "unknown_error");
  process.exit(1);
}

console.log(
  `[BACKUP] OK (${result.durationMs}ms)\n` +
    `- latest: ${result.latestDir}\n` +
    `- hourly: ${result.hourlyDir}\n` +
    `- daily : ${result.dailyDir}`,
);

