import { ethers } from "ethers";
import logger from "../utils/logger";
import { BlockProcessor } from "../models/types";

export default class BlockEventManager {
  private provider: ethers.providers.JsonRpcProvider;
  private processors: Map<string, BlockProcessor> = new Map();
  private lastProcessedBlock: number = 0;
  private isProcessingBlock: boolean = false;

  constructor(provider: ethers.providers.JsonRpcProvider) {
    this.provider = provider;
  }

  async start(): Promise<void> {
    try {
      // Set the last processed block to the current block
      const currentBlock = await this.provider.getBlockNumber();
      this.lastProcessedBlock = currentBlock;
      
      this.setupBlockListener();
      logger.info("BlockEventManager started at block", currentBlock);
    } catch (error) {
      logger.error("Failed to start BlockEventManager:", error);
      throw error;
    }
  }

  registerProcessor(id: string, processor: BlockProcessor): void {
    this.processors.set(id, processor);
    logger.info(`Registered block processor: ${id}`);
  }

  unregisterProcessor(id: string): void {
    this.processors.delete(id);
    logger.info(`Unregistered block processor: ${id}`);
  }

  private setupBlockListener(): void {
    // Listen for new blocks
    this.provider.on("block", (blockNumber) => {
      this.processNewBlock(blockNumber).catch(error => {
        logger.error(`Error processing block ${blockNumber}:`, error);
      });
    });
    
    // Setup periodic health check
    const healthCheck = setInterval(async () => {
      try {
        await this.provider.getBlockNumber();
      } catch (error) {
        logger.error("Provider connection error, reestablishing connection:", error);
        clearInterval(healthCheck);
        
        // Retry connection after a delay
        setTimeout(() => {
          this.setupBlockListener();
        }, 5000);
      }
    }, 30000);
  }

  private async processNewBlock(blockNumber: number): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessingBlock) return;
    
    // Skip if this block has already been processed
    if (blockNumber <= this.lastProcessedBlock) return;
    
    this.isProcessingBlock = true;
    try {
      logger.info(`Processing block ${blockNumber} with ${this.processors.size} registered processors`);
      
      // Notify all processors about the new block
      const processingPromises = Array.from(this.processors.values()).map(processor => 
        processor.processBlock(blockNumber).catch(error => {
          logger.error(`Error in processor while processing block ${blockNumber}:`, error);
        })
      );
      
      // Wait for all processors to finish
      await Promise.all(processingPromises);
      
      // Update the last processed block
      this.lastProcessedBlock = blockNumber;
      
    } catch (error) {
      logger.error(`Error processing block ${blockNumber}:`, error);
    } finally {
      this.isProcessingBlock = false;
    }
  }
}