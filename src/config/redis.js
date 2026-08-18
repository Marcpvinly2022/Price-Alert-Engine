import "dotenv/config";
import IORedis from "ioredis";
import { logger } from "../utils/logger.js";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {

  throw new Error(
    "REDIS_URL is not set. Point it at your Ubuntu VM's Redis, e.g. redis://<VM_IP>:6379",
  );
}


const parsed = new URL(redisUrl);

// URL getters keep credentials percent-encoded (e.g. "%40" for "@"), so decode
// them back to their real characters. Wrapped so a stray "%" never crashes boot.
const safeDecode = (value) => {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};


export const getRedisConnectionOptions = () => ({
  host: parsed.hostname,
  port: Number(parsed.port) || 6379,
  username: safeDecode(parsed.username),
  password: safeDecode(parsed.password),

  // A URL path of "/2" selects logical DB 2; no path -> default DB 0.
  db:
    parsed.pathname && parsed.pathname !== "/"
      ? Number(parsed.pathname.slice(1))
      : 0,

  
  tls: parsed.protocol === "rediss:" ? {} : undefined,

  maxRetriesPerRequest: null,


  retryStrategy: (times) => Math.min(times * 200, 5000),
});


export const assertRedisReachable = async () => {
  const probe = new IORedis({
    ...getRedisConnectionOptions(),
    // For the probe we WANT it to give up quickly rather than retry forever,
    // so we can surface the failure to the operator.
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  });

  try {
    await probe.connect();
    await probe.ping();
    logger.info(
      `[REDIS] reachable at ${parsed.hostname}:${parsed.port || 6379}`,
    );
  } catch (error) {
    throw new Error(
      `[REDIS] cannot reach Redis at ${parsed.hostname}:${parsed.port || 6379}. ` +
        `Check: (1) REDIS_URL points at the Ubuntu VM IP (not 127.0.0.1), ` +
        `(2) redis.conf 'bind 0.0.0.0' + a password, (3) 'sudo ufw allow 6379'. ` +
        `Underlying error: ${error.message}`,
    );
  } finally {
    // Best-effort teardown of the probe; ignore errors on an already-dead socket.
    probe.disconnect();
  }
};
