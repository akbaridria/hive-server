import config from "./config";
import HiveFactoryListener from "./services/hive-factory-listener";
import createServer from "./api/server";
import { getProvider, getWsProvider } from "./utils/ethers";
import logger from "./utils/logger";

async function main() {
  try {
    logger.info("Starting Hive backend service...");

    const provider = getWsProvider();
    const factoryListener = new HiveFactoryListener(
      provider,
      config.factoryAddress,
      (poolAddress: string) => {} // Will be set by the server
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
