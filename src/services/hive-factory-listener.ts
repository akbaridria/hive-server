import { ethers } from "ethers";
import Redis from "ioredis";
import HiveListener from "./hive-listener";
import HiveFactoryABI from "../abis/hive-factory.json";
import logger from "../utils/logger";
import { TokenERC20, PoolInfo } from "../models/types";

export default class HiveFactoryListener {
  private provider: ethers.providers.JsonRpcProvider;
  private factoryContract: ethers.Contract;
  private hiveListeners: Map<string, HiveListener> = new Map();
  private onPoolCreated: (poolAddress: string) => void;
  private redisClient: Redis;

  constructor(
    provider: ethers.providers.JsonRpcProvider,
    factoryAddress: string,
    onPoolCreated: (poolAddress: string) => void,
    redis: Redis
  ) {
    this.provider = provider;
    this.factoryContract = new ethers.Contract(
      factoryAddress,
      HiveFactoryABI,
      provider
    );
    this.onPoolCreated = onPoolCreated;
    this.redisClient = redis;
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
    const listener = (poolAddress: string) => {
      this.addHiveListener(poolAddress)
        .then(() => this.onPoolCreated(poolAddress))
        .catch((error) => logger.error("Error adding new pool:", error));
    };
    this.factoryContract.on("HiveCoreCreated", listener);

    const healthCheck = setInterval(() => {
      this.provider.getBlockNumber().catch((error) => {
        console.error("Connection error:", error);
        this.factoryContract.removeListener("YourEvent", listener);
        clearInterval(healthCheck);
        setTimeout(this.setupListeners, 500);
      });
    }, 10000);
  }

  private async addHiveListener(poolAddress: string): Promise<void> {
    if (!this.hiveListeners.has(poolAddress)) {
      const listener = new HiveListener(
        this.provider,
        poolAddress,
        {
          onOrderBookUpdate: () => this.onPoolCreated(poolAddress),
        },
        this.redisClient
      );

      await listener.start();
      this.hiveListeners.set(poolAddress, listener);

      // Save pool info to Redis
      const poolInfo = await listener.getPoolInfo();
      await this.redisClient.set(
        `pool:${poolAddress}`,
        JSON.stringify(poolInfo)
      );

      logger.info(`Added listener for pool ${poolAddress}`);
    }
  }

  async getPoolInfoFromRedis(poolAddress: string): Promise<PoolInfo | null> {
    const poolData = await this.redisClient.get(`pool:${poolAddress}`);
    return poolData ? JSON.parse(poolData) : null;
  }

  async getAllPools(): Promise<PoolInfo[]> {
    const keys = await this.redisClient.keys("pool:*");
    const poolData = await Promise.all(
      keys.map((key) => this.redisClient.get(key))
    );
    return poolData
      .filter((data): data is string => data !== null)
      .map((data) => JSON.parse(data));
  }

  getPoolListener(poolAddress: string): HiveListener | undefined {
    return this.hiveListeners.get(poolAddress);
  }
}
