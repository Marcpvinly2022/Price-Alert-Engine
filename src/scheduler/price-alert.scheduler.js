// Import provider, snapshot services, and evaluation triggers for currency calculations.
import { fetchUsdNgnRate } from "../providers/fx.provider.js";
import { saveRateSnapshot } from "../services/rates.service.js";
import { evaluateAlertsForRate } from "../services/trigger.service.js";
import { logger } from "../utils/logger.js";

// State variable protecting against concurrent executions of the main workflow loop.
let running = false;

// Coordinates the automated exchange polling, database snapshots, and user criteria evaluations.
export const runPriceAlertCycle = async () => {
    if(running){
        console.log("[PRICE ALERT] Previous cycle is still running. Skipping.")
    return null;
    };

running = true;

try{
    console.log("\n========== PRICE ALERT CYCLE ==========");
    logger.info("\n========== PRICE ALERT CYCLE ==========");
    // Fetch currency exchange rate data from external provider sources.
    const rateData = await fetchUsdNgnRate();

    logger.info(`[RATE] Successfully fetched current metrics: ${JSON.stringify(rateData)}`);
    // Save snapshot logs of current rates to historical records.
    let snapshotId = null;
    try{
    const snapshot = await saveRateSnapshot(rateData);
    snapshotId = snapshot?.id;
    }catch(dbError){
        logger.error({
            err: dbError.message,
            msg: "[PRICE ALERT] Database unreachable during snapshot creation. Local internet or Supabase down. Skipping historical logging phase."
        });
    }

     // 🔔 Phase 3: Evaluate Active User Alerts
    let triggeredAlertIds = [];

    try{

    // Evaluate active user configuration profiles against real-time data metrics.
    const triggeredAlertIds = await evaluateAlertsForRate({
        currencyPair: rateData.currencyPair,
        rate: rateData.rate.toString(),
    });
    console.log(
      `[ALERT] Triggered ${triggeredAlertIds.length} alert(s)`
    );

    }catch(evalError){
        logger.error({
            err: evalError.message,
            msg: "[PRICE ALERT] Critical system error checking active alert rules profiles.",
        });
    }
    console.log("========== CYCLE COMPLETE ==========\n");

    return {
        rate: rateData,
        snapshot: snapshotId,
        triggeredAlerts: triggeredAlertIds,
    };
}catch(error){
   // This catches foundational failures, like your circuit breaker completely running out of fallbacks
    logger.error({
        err: error.message,
        msg: "[PRICE ALERT] Unrecoverable anomaly occurred inside core cycle loop."
    });
    return null;
}finally{
    running = false;
}
}
