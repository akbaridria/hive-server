import { ethers } from "ethers";
import OrderBookModel from "../models/order-book";
import HiveCoreABI from "../../abis/hive-core.json";
import Erc20ABI from "../../abis/erc20.json";
import logger from "../utils/logger";
import { Order, PoolInfo } from "../models/types";

interface HiveListenerEvents {
  onOrderBookUpdate: (poolAddress: string) => void;
}

export default class HiveListener {
  private contract: ethers.Contract;
  private orderBook: OrderBookModel;
  private events: HiveListenerEvents;
  private baseTokenDecimals: number;
  private quoteTokenDecimals: number;

  constructor(
    provider: ethers.providers.JsonRpcProvider,
    contractAddress: string,
    events: HiveListenerEvents,
    baseTokenDecimals: number = 18,
    quoteTokenDecimals: number = 18
  ) {
    this.contract = new ethers.Contract(contractAddress, HiveCoreABI, provider);
    this.events = events;
    this.orderBook = new OrderBookModel("", "");
    this.baseTokenDecimals = baseTokenDecimals;
    this.quoteTokenDecimals = quoteTokenDecimals;
  }

  async initialize(): Promise<void> {
    try {
      const [baseToken, quoteToken, latestPrice] = await Promise.all([
        this.contract.getBaseToken(),
        this.contract.getQuoteToken(),
        this.contract.getLatestPrice(),
      ]);

      const baseTokenContract = new ethers.Contract(
        baseToken,
        Erc20ABI,
        this.contract.provider
      );
      const quoteTokenContract = new ethers.Contract(
        quoteToken,
        Erc20ABI,
        this.contract.provider
      );
      this.baseTokenDecimals = await baseTokenContract.decimals();
      this.quoteTokenDecimals = await quoteTokenContract.decimals();

      this.orderBook = new OrderBookModel(
        baseToken,
        quoteToken,
        this.contract.address
      );
      this.orderBook.setLatestPrice(
        String(Number(latestPrice) / 10 ** this.quoteTokenDecimals)
      );

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
      console.log(this.contract.address, "Starting HiveListener");
      this.setupListeners();
      logger.info(`Started HiveListener for ${this.contract.address}`);
    } catch (error) {
      logger.error(
        `Failed to start HiveListener for ${this.contract.address}:`,
        error
      );
    }
  }

  private setupListeners(): void {
    this.contract.on(
      "OrderCreated",
      (
        trader: string,
        orderId: bigint,
        price: bigint,
        amount: bigint,
        orderType: bigint
      ) => {
        try {
          logger.info(
            `OrderCreated event: ${trader}, ${orderId}, ${price}, ${amount}, ${orderType}`
          );
          this.orderBook.addOrder({
            id: orderId.toString(),
            trader,
            price: (Number(price) / 10 ** this.quoteTokenDecimals).toString(),
            amount: (Number(amount) / 10 ** this.baseTokenDecimals).toString(),
            remainingAmount: (
              Number(amount) /
              10 ** this.baseTokenDecimals
            ).toString(),
            filled: "0",
            orderType: Number(orderType) === 0 ? "BUY" : "SELL",
            active: true,
            timestamp: Math.floor(Date.now() / 1000),
          });

          this.emitUpdate();
          logger.info(
            `OrderCreated: ${orderId.toString()} by ${trader} at price ${price} with amount ${amount}`
          );
        } catch (error) {
          logger.error("Error processing OrderCreated event:", error);
        }
      }
    );

    this.contract.on(
      "OrderFilled",
      async (
        orderId: bigint,
        trader: string,
        originalAmount: bigint,
        filledAmount: bigint,
        remainingAmount: bigint,
        orderType: bigint,
        event
      ) => {
        try {
          this.orderBook.updateOrderFilled(
            orderId.toString(),
            (Number(filledAmount) / 10 ** this.baseTokenDecimals).toString(),
            (Number(remainingAmount) / 10 ** this.baseTokenDecimals).toString(),
            trader,
            Number(remainingAmount) > 0
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

    this.contract.on(
      "OrderUpdated",
      (orderId: bigint, trader: string, newAmount: bigint) => {
        try {
          this.orderBook.updateOrder(
            orderId.toString(),
            (Number(newAmount) / 10 ** this.baseTokenDecimals).toString(),
            trader
          );
          this.emitUpdate();
        } catch (error) {
          logger.error("Error processing OrderUpdated event:", error);
        }
      }
    );

    this.contract.on("TradeExecuted", (buyer, seller, amount, price) => {
      try {
        this.orderBook.setLatestPrice(
          (Number(price) / 10 ** this.quoteTokenDecimals).toString()
        );
        this.emitUpdate();
      } catch (error) {
        logger.error("Error processing TradeExecuted event:", error);
      }
    });
  }

  private emitUpdate(): void {
    this.events.onOrderBookUpdate(this.contract.address);
  }

  getOrderBook(depth = 20) {
    return this.orderBook.getOrderBook(depth);
  }

  getPoolInfo(): PoolInfo {
    return this.orderBook.getPoolInfo();
  }

  getUserOrders(trader: string): Order[] {
    return this.orderBook.getUserOrders(trader);
  }
}
