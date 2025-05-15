import config from "./config";
import HiveFactoryListener from "./services/hive-factory-listener";
import createServer from "./api/server";
import { getWsProvider } from "./utils/ethers";
import logger from "./utils/logger";
import Redis from "ioredis";

async function main() {
  try {
    logger.info("Starting Hive backend service...");
    const redis = new Redis(config.redisUrl!, {
      tls: {
        // temporaryly disable TLS verification for local development
        rejectUnauthorized: false,
      },
    });
    const provider = getWsProvider();
    const factoryListener = new HiveFactoryListener(
      provider,
      config.factoryAddress,
      (poolAddress: string) => {},
      redis
    );

    await factoryListener.start();

    const { start } = createServer(factoryListener, config.port);
    start();

    process.on("SIGINT", () => {
      logger.info("Shutting down gracefully...");
      process.exit(0);
    });
  } catch (error) {
    logger.error("Failed to start service:", error);
    process.exit(1);
  }
}

main();
