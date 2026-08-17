import prisma from "./src/config/database.js";
import { runNotificationCycle } from "./src/services/notification.scheduler.js";


console.log(
    "\n========== NOTIFICATION SCHEDULER TEST =========="
);


const result = await runNotificationCycle();


console.log(
    "\n[TEST] Scheduler result:"
);

console.log(result);


await prisma.$disconnect();