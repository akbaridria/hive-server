import { ethers } from "ethers";
import OrderBookModel from "../models/order-book";
import * as HiveCoreABI from "../../abis/hive-core.json";
import logger from "../utils/logger";
import { PoolInfo } from "../models/types";

interface HiveListenerEvents {
  onOrderBookUpdate: (poolAddress: string) => void;
}

export default class HiveListener {
  private contract: ethers.Contract;
  private orderBook: OrderBookModel;
  private lastProcessedBlock: number = 0;
  private isSyncing: boolean = false;
  private events: HiveListenerEvents;

  constructor(
    provider: ethers.providers.JsonRpcProvider,
    contractAddress: string,
    events: HiveListenerEvents
  ) {
    this.contract = new ethers.Contract(contractAddress, HiveCoreABI, provider);
    this.events = events;
    this.orderBook = new OrderBookModel("", "");
  }

  async initialize(): Promise<void> {
    try {
      const [baseToken, quoteToken, latestPrice] = await Promise.all([
        this.contract.getBaseToken(),
        this.contract.getQuoteToken(),
        this.contract.getLatestPrice(),
      ]);

      this.orderBook = new OrderBookModel(baseToken, quoteToken);
      this.orderBook.setLatestPrice(latestPrice.toString());

      logger.info(`Initialized HiveListener for pool ${this.contract.address}`);
    } catch (error) {
      logger.error(
        `Failed to initialize HiveListener for ${this.contract.address}:`,
        error
      );
      throw error;
    }
  }

  private async processEvent(event: ethers.Event): Promise<void> {
    try {
      const parsedLog = this.contract.interface.parseLog(event);

      switch (parsedLog.name) {
        case "OrderCreated":
          await this.handleOrderCreated(parsedLog.args, event);
          break;
        case "OrderFilled":
          await this.handleOrderFilled(parsedLog.args);
          break;
        case "OrderCancelled":
          await this.handleOrderCancelled(parsedLog.args);
          break;
        case "OrderUpdated":
          await this.handleOrderUpdated(parsedLog.args);
          break;
        case "TradeExecuted":
          await this.handleTradeExecuted(parsedLog.args);
          break;
      }
    } catch (error) {
      logger.error(`Error processing event: ${event.transactionHash}`, error);
    }
  }

  private async handleOrderCreated(
    args: any,
    event: ethers.Event
  ): Promise<void> {
    const orderId =
      args.orderId?.toString() || (await this.findOrderIdFromEvent(event));
    const block = await event.getBlock();

    this.orderBook.addOrder({
      id: orderId,
      trader: args.trader,
      price: args.price.toString(),
      amount: args.amount.toString(),
      filled: "0",
      orderType: args.orderType === 0 ? "BUY" : "SELL",
      active: true,
      timestamp: block.timestamp,
    });
  }

  private async handleOrderFilled(args: any): Promise<void> {
    this.orderBook.updateOrder(
      args.orderId.toString(),
      args.originalAmount.toString(),
      args.filledAmount.toString()
    );
  }

  private async handleOrderCancelled(args: any): Promise<void> {
    this.orderBook.removeOrder(args.orderId.toString());
  }

  private async handleOrderUpdated(args: any): Promise<void> {
    this.orderBook.updateOrder(
      args.orderId.toString(),
      args.newAmount.toString()
    );
  }

  private async handleTradeExecuted(args: any): Promise<void> {
    this.orderBook.setLatestPrice(args.price.toString());
  }

  async start(): Promise<void> {
    try {
      await this.initialize();
      await this.syncState();
      this.setupListeners();
      setInterval(() => this.syncState(), 60000);
      logger.info(`Started HiveListener for ${this.contract.address}`);
    } catch (error) {
      logger.error(
        `Failed to start HiveListener for ${this.contract.address}:`,
        error
      );
    }
  }

  private async syncState(fromBlock?: number): Promise<void> {
    if (this.isSyncing) return;

    try {
      this.isSyncing = true;
      const latestBlock = await this.contract.provider.getBlockNumber();
      const startBlock = fromBlock || this.lastProcessedBlock + 1;

      if (startBlock > latestBlock) {
        return;
      }

      // Process events in batches to avoid timeout
      const batchSize = 2000;
      let currentBlock = startBlock;

      while (currentBlock <= latestBlock) {
        const endBlock = Math.min(currentBlock + batchSize - 1, latestBlock);

        const events = await this.contract.queryFilter(
          {},
          currentBlock,
          endBlock
        );
        for (const event of events) {
          await this.processEvent(event);
        }

        currentBlock = endBlock + 1;
        this.lastProcessedBlock = endBlock;
      }

      logger.debug(
        `Synced state for ${this.contract.address} from block ${startBlock} to ${latestBlock}`
      );
    } catch (error) {
      logger.error(`Error syncing state for ${this.contract.address}:`, error);
    } finally {
      this.isSyncing = false;
    }
  }

  private setupListeners(): void {
    this.contract.on(
      "OrderCreated",
      async (trader, price, amount, orderType, event) => {
        try {
          const orderId = await this.findOrderIdFromEvent(event);
          const order = await this.contract.getOrder(orderId);

          this.orderBook.addOrder({
            id: orderId.toString(),
            trader,
            price: price.toString(),
            amount: amount.toString(),
            filled: "0",
            orderType: orderType === 0 ? "BUY" : "SELL",
            active: true,
            timestamp: (await event.getBlock()).timestamp,
          });

          this.emitUpdate();
        } catch (error) {
          logger.error("Error processing OrderCreated event:", error);
        }
      }
    );

    this.contract.on(
      "OrderFilled",
      async (
        orderId,
        trader,
        originalAmount,
        filledAmount,
        remainingAmount,
        orderType,
        event
      ) => {
        try {
          this.orderBook.updateOrder(
            orderId.toString(),
            originalAmount.toString(),
            filledAmount.toString()
          );
          this.emitUpdate();
        } catch (error) {
          logger.error("Error processing OrderFilled event:", error);
        }
      }
    );

    this.contract.on("OrderCancelled", (orderId) => {
      try {
        this.orderBook.removeOrder(orderId.toString());
        this.emitUpdate();
      } catch (error) {
        logger.error("Error processing OrderCancelled event:", error);
      }
    });

    this.contract.on("OrderUpdated", (orderId, newAmount) => {
      try {
        this.orderBook.updateOrder(orderId.toString(), newAmount.toString());
        this.emitUpdate();
      } catch (error) {
        logger.error("Error processing OrderUpdated event:", error);
      }
    });

    this.contract.on("TradeExecuted", (buyer, seller, amount, price) => {
      try {
        this.orderBook.setLatestPrice(price.toString());
        this.emitUpdate();
      } catch (error) {
        logger.error("Error processing TradeExecuted event:", error);
      }
    });
  }

  private emitUpdate(): void {
    this.events.onOrderBookUpdate(this.contract.address);
  }

  private async findOrderIdFromEvent(event: ethers.Event): Promise<number> {
    // Implement logic to extract order ID from event logs
    // This is a placeholder - adjust based on your contract's event structure
    const txReceipt = await event.getTransactionReceipt();
    const iface = new ethers.utils.Interface(HiveCoreABI);

    for (const log of txReceipt.logs) {
      try {
        const parsedLog = iface.parseLog(log);
        if (parsedLog.name === "OrderCreated") {
          return parsedLog.args.orderId.toNumber();
        }
      } catch {
        // Skip logs that can't be parsed
      }
    }

    throw new Error("Order ID not found in event logs");
  }

  getOrderBook(depth = 10) {
    return this.orderBook.getOrderBook(depth);
  }

  getPoolInfo(): PoolInfo {
    return this.orderBook.getPoolInfo();
  }
}
