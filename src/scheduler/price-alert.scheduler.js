import { fetchUsdNgnRate } from "../providers/fx.provider.js";
import { saveRateSnapshot } from "../services/rates.service.js";
import { evaluateAlertsForRate } from "../services/trigger.service.js";

let running = false;

export const runPriceAlertCycle = async () => {
    if(running){
        console.log("[PRICE ALERT] Previous cycle is still running. Skipping.")
    return;
    };

running = true;

try{
    console.log("\n========== PRICE ALERT CYCLE ==========");
    // fetch currency exchange rate
    const rateData = await fetchUsdNgnRate();

    console.log( "[RATE] Fetched:", rateData );
    // 2. Save rate snapshot
    const snapshot = await saveRateSnapshot(rateData);

    // Evaluate user alerts
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