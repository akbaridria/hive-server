import { ethers } from "ethers";
import HiveListener from "./hive-listener";
import HiveFactoryABI from "../../abis/hive-factory.json";
import logger from "../utils/logger";
import { TokenERC20 } from "../models/types";

export default class HiveFactoryListener {
  private provider: ethers.providers.JsonRpcProvider;
  private factoryContract: ethers.Contract;
  private hiveListeners: Map<string, HiveListener> = new Map();
  private onPoolCreated: (poolAddress: string) => void;

  constructor(
    provider: ethers.providers.JsonRpcProvider,
    factoryAddress: string,
    onPoolCreated: (poolAddress: string) => void
  ) {
    this.provider = provider;
    this.factoryContract = new ethers.Contract(
      factoryAddress,
      HiveFactoryABI,
      provider
    );
    this.onPoolCreated = onPoolCreated;
  }

  async start(): Promise<void> {
    try {
      await this.syncExistingPools();
      this.setupListeners();
      logger.info("HiveFactoryListener started");
    } catch (error) {
      logger.error("Failed to start HiveFactoryListener:", error);
      throw error;
    }
  }

  private async syncExistingPools(): Promise<void> {
    try {
      const poolCount = await this.factoryContract.getHiveCoreCount();
      logger.info(`Found ${poolCount} existing pools`);

      for (let i = 0; i < poolCount; i++) {
        const poolAddress = await this.factoryContract.getHiveCoreByIndex(i);
        await this.addHiveListener(poolAddress);
      }
    } catch (error) {
      logger.error("Error syncing existing pools:", error);
      throw error;
    }
  }

  private setupListeners(): void {
    this.factoryContract.on("HiveCoreCreated", (poolAddress: string) => {
      this.addHiveListener(poolAddress)
        .then(() => this.onPoolCreated(poolAddress))
        .catch((error) => logger.error("Error adding new pool:", error));
    });
  }

  private async addHiveListener(poolAddress: string): Promise<void> {
    if (!this.hiveListeners.has(poolAddress)) {
      const listener = new HiveListener(this.provider, poolAddress, {
        onOrderBookUpdate: () => this.onPoolCreated(poolAddress),
      });

      await listener.start();
      this.hiveListeners.set(poolAddress, listener);
      logger.info(`Added listener for pool ${poolAddress}`);
    }
  }

  getPoolListener(poolAddress: string): HiveListener | undefined {
    return this.hiveListeners.get(poolAddress);
  }

  getAllPoolInfo(): {
    address: string;
    baseToken: TokenERC20;
    quoteToken: TokenERC20;
    latestPrice: string;
  }[] {
    return Array.from(this.hiveListeners.values()).map((listener) =>
      listener.getPoolInfo()
    );
  }
}
