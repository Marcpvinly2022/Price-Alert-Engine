import {
    startNotificationScheduler,
    stopNotificationScheduler,
} from "./src/services/notification.scheduler.service.js";

console.log("\n========== SCHEDULER LOOP TEST ==========");

console.log("\n[TEST] Starting scheduler...");

startNotificationScheduler();

console.log("\n[TEST] Trying to start scheduler again...");

startNotificationScheduler();

console.log("\n[TEST] Scheduler will run for 16 seconds...");

setTimeout(() => {
    console.log("\n[TEST] Stopping scheduler...");

    stopNotificationScheduler();

    console.log("\n[TEST] Scheduler stopped.");
}, 16000);

setTimeout(() => {
    console.log("\n========== TEST COMPLETE ==========");
    process.exit(0);
}, 18000);