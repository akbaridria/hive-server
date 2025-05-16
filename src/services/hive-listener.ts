import { ethers } from "ethers";
import OrderBookModel from "../models/order-book";
import BlockEventManager from "./block-event-manager";
import HiveCoreABI from "../abis/hive-core.json";
import Erc20ABI from "../abis/erc20.json";
import logger from "../utils/logger";
import {
  AmountOutResult,
  BlockProcessor,
  MarketOrder,
  Order,
  OrderType,
  PoolInfo,
  TokenERC20,
} from "../models/types";
import Redis from "ioredis";

interface HiveListenerEvents {
  onOrderBookUpdate: (poolAddress: string) => void;
}

export default class HiveListener implements BlockProcessor {
  private contract: ethers.Contract;
  private orderBook: OrderBookModel;
  private events: HiveListenerEvents;
  private baseTokenMultiplier: number = 1;
  private quoteTokenMultiplier: number = 1;
  private redisClient: Redis;
  private provider: ethers.providers.JsonRpcProvider;
  private lastProcessedBlock: number = 0;
  private blockEventManager: BlockEventManager;

  constructor(
    provider: ethers.providers.JsonRpcProvider,
    contractAddress: string,
    events: HiveListenerEvents,
    redis: Redis,
    blockEventManager: BlockEventManager
  ) {
    this.provider = provider;
    this.contract = new ethers.Contract(contractAddress, HiveCoreABI, provider);
    this.events = events;
    this.blockEventManager = blockEventManager;
    const defaultToken = {
      address: "",
      name: "",
      symbol: "",
      decimals: 18,
    };
    this.orderBook = new OrderBookModel(defaultToken, defaultToken, "", redis);
    this.redisClient = redis;
  }

  async initialize(): Promise<void> {
    try {
      const [baseTokenAddress, quoteTokenAddress, latestPrice] =
        await Promise.all([
          this.contract.getBaseToken(),
          this.contract.getQuoteToken(),
          this.contract.getLatestPrice(),
        ]);

      const baseTokenContract = new ethers.Contract(
        baseTokenAddress,
        Erc20ABI,
        this.contract.provider
      );
      const quoteTokenContract = new ethers.Contract(
        quoteTokenAddress,
        Erc20ABI,
        this.contract.provider
      );

      const [baseTokenName, baseTokenSymbol, baseTokenDecimals] =
        await Promise.all([
          baseTokenContract.name(),
          baseTokenContract.symbol(),
          baseTokenContract.decimals(),
        ]);

      const baseToken: TokenERC20 = {
        address: baseTokenAddress,
        name: baseTokenName,
        symbol: baseTokenSymbol,
        decimals: baseTokenDecimals,
      };
      this.baseTokenMultiplier = 10 ** baseTokenDecimals;

      const [quoteTokenName, quoteTokenSymbol, quoteTokenDecimals] =
        await Promise.all([
          quoteTokenContract.name(),
          quoteTokenContract.symbol(),
          quoteTokenContract.decimals(),
        ]);
      const quoteToken: TokenERC20 = {
        address: quoteTokenAddress,
        name: quoteTokenName,
        symbol: quoteTokenSymbol,
        decimals: quoteTokenDecimals,
      };
      this.quoteTokenMultiplier = 10 ** quoteTokenDecimals;

      this.orderBook = new OrderBookModel(
        baseToken,
        quoteToken,
        this.contract.address,
        this.redisClient
      );
      this.orderBook.setLatestPrice(
        String(Number(latestPrice) / this.quoteTokenMultiplier)
      );

      // Set the last processed block to the current block
      const currentBlock = await this.provider.getBlockNumber();
      this.lastProcessedBlock = currentBlock;

      logger.info(`Initialized HiveListener for pool ${this.contract.address}`);
    } catch (error) {
      logger.error(
        `Failed to initialize HiveListener for ${this.contract.address}:`,
        error
      );
      throw error;
    }
  }

  async start(): Promise<void> {
    try {
      await this.initialize();
      
      // Register with the block event manager
      this.blockEventManager.registerProcessor(`pool-${this.contract.address}`, this);
      
      logger.info(`Started HiveListener for ${this.contract.address}`);
    } catch (error) {
      logger.error(
        `Failed to start HiveListener for ${this.contract.address}:`,
        error
      );
    }
  }

  // Implementation of BlockProcessor interface
  async processBlock(blockNumber: number): Promise<void> {
    // Skip if this block has already been processed
    if (blockNumber <= this.lastProcessedBlock) return;
    
    try {
      // Look for events from the last processed block+1 to the current block
      const fromBlock = this.lastProcessedBlock + 1;
      
      // Define filters for each event type
      const orderCreatedFilter = this.contract.filters.OrderCreated();
      const orderFilledFilter = this.contract.filters.OrderFilled();
      const orderCancelledFilter = this.contract.filters.OrderCancelled();
      const orderUpdatedFilter = this.contract.filters.OrderUpdated();
      const latestPriceFilter = this.contract.filters.LatestPrice();
      const marketOrderExecutedFilter = this.contract.filters.MarketOrderExecuted();
      
      // Query for events from the specified block range
      const [
        orderCreatedEvents,
        orderFilledEvents,
        orderCancelledEvents,
        orderUpdatedEvents,
        latestPriceEvents,
        marketOrderEvents
      ] = await Promise.all([
        this.contract.queryFilter(orderCreatedFilter, fromBlock, blockNumber),
        this.contract.queryFilter(orderFilledFilter, fromBlock, blockNumber),
        this.contract.queryFilter(orderCancelledFilter, fromBlock, blockNumber),
        this.contract.queryFilter(orderUpdatedFilter, fromBlock, blockNumber),
        this.contract.queryFilter(latestPriceFilter, fromBlock, blockNumber),
        this.contract.queryFilter(marketOrderExecutedFilter, fromBlock, blockNumber)
      ]);
      
      // Process each type of event
      for (const event of orderCreatedEvents) {
        const { trader, orderId, price, amount, orderType } = event.args as any;
        await this.handleOrderCreated(trader, orderId, price, amount, orderType);
      }
      
      for (const event of orderFilledEvents) {
        const { orderId, trader, amount: originalAmount, filledAmount, remaining: remainingAmount, orderType } = event.args as any;
        await this.handleOrderFilled(orderId, trader, originalAmount, filledAmount, remainingAmount, orderType);
      }
      
      for (const event of orderCancelledEvents) {
        const { orderId } = event.args as any;
        await this.handleOrderCancelled(orderId);
      }
      
      for (const event of orderUpdatedEvents) {
        const { orderId, trader, newAmount } = event.args as any;
        await this.handleOrderUpdated(orderId, trader, newAmount);
      }
      
      for (const event of latestPriceEvents) {
        const { price } = event.args as any;
        await this.handleLatestPrice(price);
      }
      
      for (const event of marketOrderEvents) {
        const { trader, amount, price, orderType, filledAmount } = event.args as any;
        await this.handleMarketOrderExecuted(trader, amount, price, orderType, filledAmount);
      }
      
      // Update the last processed block
      this.lastProcessedBlock = blockNumber;
      
      // Emit update if any events were processed
      if (
        orderCreatedEvents.length > 0 ||
        orderFilledEvents.length > 0 ||
        orderCancelledEvents.length > 0 ||
        orderUpdatedEvents.length > 0 ||
        latestPriceEvents.length > 0 ||
        marketOrderEvents.length > 0
      ) {
        this.emitUpdate();
      }
    } catch (error) {
      logger.error(`Error processing block ${blockNumber} for ${this.contract.address}:`, error);
    }
  }

  // Rest of the class remains the same
  private async handleOrderCreated(
    trader: string,
    orderId: bigint,
    price: bigint,
    amount: bigint,
    orderType: bigint
  ): Promise<void> {
    try {
      await this.orderBook.addOrder({
        id: orderId.toString(),
        trader,
        price: (Number(price) / this.quoteTokenMultiplier).toString(),
        amount: (Number(amount) / this.baseTokenMultiplier).toString(),
        remainingAmount: (Number(amount) / this.baseTokenMultiplier).toString(),
        filled: "0",
        orderType: Number(orderType) === 0 ? "BUY" : "SELL",
        active: true,
        timestamp: Math.floor(Date.now() / 1000),
      });

      logger.info(
        `OrderCreated: ${orderId.toString()} by ${trader} at price ${price} with amount ${amount}`
      );
    } catch (error) {
      logger.error("Error processing OrderCreated event:", error);
    }
  }

   private async handleOrderFilled(
    orderId: bigint,
    trader: string,
    originalAmount: bigint,
    filledAmount: bigint,
    remainingAmount: bigint,
    orderType: bigint
  ): Promise<void> {
    try {
      await this.orderBook.updateOrderFilled(
        orderId.toString(),
        (Number(filledAmount) / this.baseTokenMultiplier).toString(),
        (Number(remainingAmount) / this.baseTokenMultiplier).toString(),
        trader,
        Number(remainingAmount) > 0
      );
    } catch (error) {
      logger.error("Error processing OrderFilled event:", error);
    }
  }

  private async handleOrderCancelled(orderId: bigint): Promise<void> {
    try {
      await this.orderBook.removeOrder(orderId.toString());
    } catch (error) {
      logger.error("Error processing OrderCancelled event:", error);
    }
  }

  private async handleOrderUpdated(
    orderId: bigint,
    trader: string,
    newAmount: bigint
  ): Promise<void> {
    try {
      await this.orderBook.updateOrder(
        orderId.toString(),
        (Number(newAmount) / this.baseTokenMultiplier).toString(),
        trader
      );
    } catch (error) {
      logger.error("Error processing OrderUpdated event:", error);
    }
  }

  private async handleLatestPrice(price: bigint): Promise<void> {
    try {
      await this.orderBook.setLatestPrice(
        (Number(price) / this.quoteTokenMultiplier).toString()
      );
    } catch (error) {
      logger.error("Error processing LatestPrice event:", error);
    }
  }

  private async handleMarketOrderExecuted(
    trader: string,
    amount: bigint,
    price: bigint,
    orderType: bigint,
    filledAmount: bigint
  ): Promise<void> {
    try {
      await this.orderBook.addMarketOrder(
        {
          amount: (
            Number(filledAmount) /
            (Number(orderType) === 0
              ? this.baseTokenMultiplier
              : this.quoteTokenMultiplier)
          ).toString(),
          ordertype: Number(orderType) === 0 ? "BUY" : "SELL",
          timestamp: Math.floor(Date.now() / 1000),
        },
        trader
      );
    } catch (error) {
      logger.error("Error processing MarketOrderExecuted event:", error);
    }
  }

  private emitUpdate(): void {
    this.events.onOrderBookUpdate(this.contract.address);
  }

  async getOrderBook(depth = 20) {
    return await this.orderBook.getOrderBook(depth);
  }

  async getOrder(orderId: string): Promise<Order | undefined> {
    return await this.orderBook.getOrder(orderId);
  }

  async getOrderByTrader(trader: string): Promise<Order[] | undefined> {
    return await this.orderBook.getUserOrders(trader);
  }

  async getPoolInfo(): Promise<PoolInfo> {
    return await this.orderBook.getPoolInfo();
  }

  async getUserOrders(trader: string): Promise<Order[]> {
    return await this.orderBook.getUserOrders(trader);
  }

  async getUserMarketOrders(trader: string): Promise<MarketOrder[]> {
    return await this.orderBook.getMarketOrders(trader);
  }

  async getAmountOut(
    orderType: OrderType,
    amount: string
  ): Promise<AmountOutResult> {
    return await this.orderBook.getAmountOut(orderType, amount);
  }
}
 