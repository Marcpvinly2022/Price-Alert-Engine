// Import provider, snapshot services, and evaluation triggers for currency calculations.
import { fetchUsdNgnRate } from "../providers/fx.provider.js";
import { saveRateSnapshot } from "../services/rates.service.js";
import { evaluateAlertsForRate } from "../services/trigger.service.js";

// State variable protecting against concurrent executions of the main workflow loop.
let running = false;

// Coordinates the automated exchange polling, database snapshots, and user criteria evaluations.
export const runPriceAlertCycle = async () => {
    if(running){
        console.log("[PRICE ALERT] Previous cycle is still running. Skipping.")
    return;
    };

running = true;

try{
    console.log("\n========== PRICE ALERT CYCLE ==========");
    // Fetch currency exchange rate data from external provider sources.
    const rateData = await fetchUsdNgnRate();

    console.log( "[RATE] Fetched:", rateData );
    // Save snapshot logs of current rates to historical records.
    const snapshot = await saveRateSnapshot(rateData);

    // Evaluate active user configuration profiles against real-time data metrics.
    const triggeredAlertIds = await evaluateAlertsForRate({
        currencyPair: rateData.currencyPair,
        rate: rateData.rate.toString(),
    });

    console.log(
      `[ALERT] Triggered ${triggeredAlertIds.length} alert(s)`
    );


    console.log("========== CYCLE COMPLETE ==========\n");

    return {
        rate: rateData,
        snapshot: snapshot.id,
        triggeredAlerts: triggeredAlertIds,
    };
}catch(error){
    console.error(
       "[PRICE ALERT] Cycle failed:",
      error 
    );

    throw error;
}finally{
    running = false;
}
}
