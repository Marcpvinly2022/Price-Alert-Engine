import {prisma} from "../config/database.js";
import { processNotification, retryDueNotifications, recoverStaleNotifications } from "./notification.worker.js";


const BATCH_SIZE = 10;


// process pending notification
export const processPendingNotification = async () => {
    const notifications = await prisma.alertNotification.findMany({
        where: {
            status: "PENDING",
        },

        select: {
            id: true,
        },

        take: BATCH_SIZE,
        orderBy: {
            createdAt: 'asc',
        },
    });

    if(notifications.length === 0){
        return 0;
    }

    console.log(
        `[NOTIFICATION] Found ${notifications.length} pending notification(s)`);

    const result = await Promise.all(notifications.map((notification) => processNotification(notification.id)));
    
    const claimed = result.filter((result) => result?.claimed === true).length;

    console.log(`[NOTIFICATION] Claimed ${claimed}/${notifications.length} notification(s)`);

    return claimed;
}


// run one complete scheduler cycle 
export const  runNotificationCycle = async () => {
    console.log( "\n========== NOTIFICATION CYCLE ==========");

    // Recover workers that died while processing
    const recovered = await recoverStaleNotifications();

    // Move retryable FAILED notifications back to PENDING
    const retried = await retryDueNotifications();

    // Process PENDING notifications
    const processed = await processPendingNotification();
    console.log(
        `[NOTIFICATION] Cycle complete | recovered=${recovered} retried=${retried} processed=${processed}`
    );

    return {
        recovered,
        retried,
        processed
    };

}