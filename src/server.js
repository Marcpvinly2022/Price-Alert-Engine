import "dotenv/config"; //
import app from './app.js';
import {prisma} from './config/database.js';
import { logger } from './utils/logger.js';
import {runPriceAlertCycle} from './scheduler/price-alert.scheduler.js';
const PRICE_CHECK_INTERVAL =
  Number(process.env.PRICE_CHECK_INTERVAL_MS) || 60 * 1000;

await runPriceAlertCycle();

setInterval(
  () => {
    runPriceAlertCycle().catch((error) => {
      console.error(
        "[PRICE ALERT] Scheduled cycle failed:",
        error
      );
    });
  },
  PRICE_CHECK_INTERVAL
);

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`🔥 Price Alert Engine Boot Sequence Finalized. Actively processing traffic loop on port: ${PORT}`);
});


const gracefulShutdown = async(signal) => {
  logger.warn(`${signal} context catch triggered. Safely winding down event connections...`);
  server.close(async () => {
    try{
      await prisma.$disconnect();
      logger.info("Neon database connections uncoupled safely. Express engine offline.");
      process.exit(0);

    }catch(error){
      logger.error("Failed to disconnect cleanly from Neon pool layer:", error)
      process.exit(0);
    }
  });

};
// Implement clean graceful shutdowns to prevent orphaned connection slots inside Neon pool structures
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); 
