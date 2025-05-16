import { ethers } from "ethers";
import Redis from "ioredis";
import HiveListener from "./hive-listener";
import BlockEventManager from "./block-event-manager";
import HiveFactoryABI from "../abis/hive-factory.json";
import logger from "../utils/logger";
import { TokenERC20, PoolInfo, BlockProcessor } from "../models/types";

export default class HiveFactoryListener implements BlockProcessor {
  private provider: ethers.providers.JsonRpcProvider;
  private factoryContract: ethers.Contract;
  private hiveListeners: Map<string, HiveListener> = new Map();
  private onPoolCreated: (poolAddress: string) => void;
  private redisClient: Redis;
  private lastProcessedBlock: number = 0;
  private blockEventManager: BlockEventManager;

  constructor(
    provider: ethers.providers.JsonRpcProvider,
    factoryAddress: string,
    onPoolCreated: (poolAddress: string) => void,
    redis: Redis,
    blockEventManager: BlockEventManager
  ) {
    this.provider = provider;
    this.factoryContract = new ethers.Contract(
      factoryAddress,
      HiveFactoryABI,
      provider
    );
    this.onPoolCreated = onPoolCreated;
    this.redisClient = redis;
    this.blockEventManager = blockEventManager;
  }

  async start(): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      this.lastProcessedBlock = currentBlock;
      
      // Register with the block event manager
      this.blockEventManager.registerProcessor("factory", this);
      
      await this.syncExistingPools();
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

  // Implementation of BlockProcessor interface
  async processBlock(blockNumber: number): Promise<void> {
    // Skip if this block has already been processed
    if (blockNumber <= this.lastProcessedBlock) return;
    
    try {
      // Look for events from the last processed block+1 to the current block
      const fromBlock = this.lastProcessedBlock + 1;
      
      // Query for HiveCoreCreated events
      const filter = this.factoryContract.filters.HiveCoreCreated();
      const events = await this.factoryContract.queryFilter(filter, fromBlock, blockNumber);
      
      // Process each HiveCoreCreated event
      for (const event of events) {
        const { hiveCoreAddress } = event.args as any;
        await this.addHiveListener(hiveCoreAddress);
        this.onPoolCreated(hiveCoreAddress);
      }
      
      // Update the last processed block
      this.lastProcessedBlock = blockNumber;
      
    } catch (error) {
      logger.error(`Error processing block ${blockNumber} for HiveFactoryListener:`, error);
    }
  }

  private async addHiveListener(poolAddress: string): Promise<void> {
    if (!this.hiveListeners.has(poolAddress)) {
      const listener = new HiveListener(
        this.provider,
        poolAddress,
        {
          onOrderBookUpdate: () => this.onPoolCreated(poolAddress),
        },
        this.redisClient,
        this.blockEventManager  // Pass the block event manager to the HiveListener
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