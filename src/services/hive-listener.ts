import { ethers } from "ethers";
import OrderBookModel from "../models/order-book";
import HiveCoreABI from "../abis/hive-core.json";
import Erc20ABI from "../abis/erc20.json";
import logger from "../utils/logger";
import {
  AmountOutResult,
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

export default class HiveListener {
  private contract: ethers.Contract;
  private orderBook: OrderBookModel;
  private events: HiveListenerEvents;
  private baseTokenMultiplier: number = 1;
  private quoteTokenMultiplier: number = 1;
  private redisClient: Redis;

  constructor(
    provider: ethers.providers.JsonRpcProvider,
    contractAddress: string,
    events: HiveListenerEvents,
    redis: Redis
  ) {
    this.contract = new ethers.Contract(contractAddress, HiveCoreABI, provider);
    this.events = events;
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
          this.orderBook.addOrder({
            id: orderId.toString(),
            trader,
            price: (Number(price) / this.quoteTokenMultiplier).toString(),
            amount: (Number(amount) / this.baseTokenMultiplier).toString(),
            remainingAmount: (
              Number(amount) / this.baseTokenMultiplier
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
            (Number(filledAmount) / this.baseTokenMultiplier).toString(),
            (Number(remainingAmount) / this.baseTokenMultiplier).toString(),
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
            (Number(newAmount) / this.baseTokenMultiplier).toString(),
            trader
          );
          this.emitUpdate();
        } catch (error) {
          logger.error("Error processing OrderUpdated event:", error);
        }
      }
    );

    this.contract.on("LatestPrice", (price) => {
      try {
        this.orderBook.setLatestPrice(
          (Number(price) / this.quoteTokenMultiplier).toString()
        );
        this.emitUpdate();
      } catch (error) {
        logger.error("Error processing TradeExecuted event:", error);
      }
    });

    this.contract.on(
      "MarketOrderExecuted",
      (
        trader: string,
        amount: bigint,
        price: bigint,
        orderType: bigint,
        filledAmount
      ) => {
        try {
          this.orderBook.addMarketOrder(
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
          this.emitUpdate();
        } catch (error) {
          logger.error("Error processing TradeExecuted event:", error);
        }
      }
    );
  }

  private emitUpdate(): void {
    this.events.onOrderBookUpdate(this.contract.address);
  }

  getOrderBook(depth = 20) {
    return this.orderBook.getOrderBook(depth);
  }

  async getPoolInfo(): Promise<PoolInfo> {
    return await this.orderBook.getPoolInfo();
  }

  async getUserOrders(trader: string): Promise<Order[]> {
    return await this.orderBook.getUserOrders(trader);
  }

  async getUserMarketOrders(trader: string): Promise<MarketOrder[]> {
    return this.orderBook.getMarketOrders(trader);
  }

  async getAmountOut(
    orderType: OrderType,
    amount: string
  ): Promise<AmountOutResult> {
    return this.orderBook.getAmountOut(orderType, amount);
  }
}
