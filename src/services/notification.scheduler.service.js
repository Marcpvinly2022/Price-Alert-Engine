import { runNotificationCycle } from "./notification.scheduler.js";

const INTERVAL_MS = 5000;
let isRunning = false;

export const startNotificationScheduler = () => {
    if(isRunning){
        console.log("[NOTIFICATION] Scheduler already running");
        return;
    }

    isRunning = true;
    console.log(
        `[NOTIFICATION] Scheduler started | interval=${INTERVAL_MS}ms`
    );

    runSchedulerLoop();
};

const runSchedulerLoop = async () => {
    while(isRunning){
        try{
        await runNotificationCycle();
    }catch(error){
        console.error("[NOTIFICATION] Scheduler cycle failed:", error)
    };


if(!isRunning){
    break;
}

await new Promise((resolve) => {
    setTimeout(resolve, INTERVAL_MS)
})
};
}
export const stopNotificationScheduler = () => {
    if(!isRunning){
        return;
    }

    isRunning = false;

    console.log("[NOTIFICATION] Scheduler stopped");
}