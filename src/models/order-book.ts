import Redis from "ioredis";
import {
  Order,
  PriceLevel,
  OrderBook,
  PoolInfo,
  OrderType,
  TokenERC20,
  MarketOrder,
  AmountOutResult,
} from "./types";

export default class OrderBookModel {
  private baseToken: TokenERC20;
  private quoteToken: TokenERC20;
  private contractAddress: string = "";
  private redisClient: Redis;

  constructor(
    baseToken: TokenERC20,
    quoteToken: TokenERC20,
    contractAddress: string,
    redisClient: Redis
  ) {
    this.baseToken = baseToken;
    this.quoteToken = quoteToken;
    this.contractAddress = contractAddress;
    this.redisClient = redisClient;
  }

  private getOrderKey(orderId: string): string {
    return `order:${this.contractAddress}:${orderId}`;
  }

  private getPriceLevelKey(orderType: OrderType): string {
    return `price_levels:${this.contractAddress}:${orderType}`;
  }

  private getOrdersByPriceKey(orderType: OrderType, price: string): string {
    return `${orderType.toLowerCase()}_orders:${this.contractAddress}:${price}`;
  }

  private getTraderOrdersKey(trader: string): string {
    return `trader_orders:${this.contractAddress}:${trader}`;
  }

  private getMarketOrdersKey(trader: string): string {
    return `market_orders:${this.contractAddress}:${trader}`;
  }

  private getLatestPriceKey(): string {
    return `latest_price:${this.contractAddress}`;
  }

  private async getPriceLevels(
    orderType: OrderType
  ): Promise<Map<string, string[]>> {
    const key = this.getPriceLevelKey(orderType);
    const data = await this.redisClient.get(key);
    if (!data) return new Map();
    return new Map(JSON.parse(data));
  }

  private async savePriceLevels(
    orderType: OrderType,
    priceLevels: Map<string, string[]>
  ): Promise<void> {
    const key = this.getPriceLevelKey(orderType);
    await this.redisClient.set(
      key,
      JSON.stringify(Array.from(priceLevels.entries()))
    );
  }

  async getOrder(id: string): Promise<Order | undefined> {
    const data = await this.redisClient.get(this.getOrderKey(id));
    return data ? JSON.parse(data) : undefined;
  }

  async addOrder(order: Order): Promise<void> {
    await this.redisClient.set(
      this.getOrderKey(order.id),
      JSON.stringify(order)
    );

    await this.redisClient.sadd(
      this.getTraderOrdersKey(order.trader),
      order.id
    );

    const priceKey = this.getOrdersByPriceKey(order.orderType, order.price);
    await this.redisClient.sadd(priceKey, order.id);

    const priceLevels = await this.getPriceLevels(order.orderType);
    if (!priceLevels.has(order.price)) {
      priceLevels.set(order.price, []);
    }
    const orderList = priceLevels.get(order.price) || [];
    orderList.push(order.id);
    priceLevels.set(order.price, orderList);
    await this.savePriceLevels(order.orderType, priceLevels);
  }

  async updateOrder(
    id: string,
    newAmount: string,
    trader: string
  ): Promise<boolean> {
    const orderData = await this.redisClient.get(this.getOrderKey(id));
    if (!orderData) return false;

    const order = JSON.parse(orderData) as Order;
    order.amount = newAmount;

    await this.redisClient.set(this.getOrderKey(id), JSON.stringify(order));
    return true;
  }

  async updatePriceMap(
    orderType: OrderType,
    price: string,
    id: string
  ): Promise<void> {
    const priceLevels = await this.getPriceLevels(orderType);
    const orderIds = priceLevels.get(price) || [];
    const updatedOrders = orderIds.filter((orderId) => orderId !== id);

    if (updatedOrders.length === 0) {
      priceLevels.delete(price);
      await this.redisClient.del(this.getOrdersByPriceKey(orderType, price));
    } else {
      priceLevels.set(price, updatedOrders);

      await this.redisClient.del(this.getOrdersByPriceKey(orderType, price));
      if (updatedOrders.length > 0) {
        await this.redisClient.sadd(
          this.getOrdersByPriceKey(orderType, price),
          ...updatedOrders
        );
      }
    }

    await this.savePriceLevels(orderType, priceLevels);
  }

  async updateOrderFilled(
    id: string,
    filled: string,
    remainingAmount: string,
    trader: string,
    isActive: boolean
  ): Promise<boolean> {
    const orderData = await this.redisClient.get(this.getOrderKey(id));
    if (!orderData) return false;

    const order = JSON.parse(orderData) as Order;
    order.filled = filled;
    order.remainingAmount = remainingAmount;
    order.active = isActive;

    await this.redisClient.set(this.getOrderKey(id), JSON.stringify(order));

    if (!isActive) {
      await this.updatePriceMap(order.orderType, order.price, id);
    }

    return true;
  }

  async removeOrder(id: string): Promise<boolean> {
    const orderData = await this.redisClient.get(this.getOrderKey(id));
    if (!orderData) return false;

    const order = JSON.parse(orderData) as Order;
    order.active = false;

    await this.redisClient.set(this.getOrderKey(id), JSON.stringify(order));

    await this.updatePriceMap(order.orderType, order.price, id);

    return true;
  }

  async addMarketOrder(
    marketOrder: MarketOrder,
    trader: string
  ): Promise<void> {
    const key = this.getMarketOrdersKey(trader);
    const data = await this.redisClient.get(key);
    const orders = data ? (JSON.parse(data) as MarketOrder[]) : [];

    orders.push(marketOrder);
    await this.redisClient.set(key, JSON.stringify(orders));
  }

  async getMarketOrders(trader: string): Promise<MarketOrder[]> {
    const key = this.getMarketOrdersKey(trader);
    const data = await this.redisClient.get(key);
    return data ? JSON.parse(data) : [];
  }

  async getBuyLevels(limit = 100): Promise<PriceLevel[]> {
    const priceLevels = await this.getPriceLevels("BUY");

    const pricesWithOrders = await Promise.all(
      Array.from(priceLevels.entries())
        .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
        .slice(0, limit)
        .map(async ([price, orderIds]) => {
          const orderPromises = orderIds.map((id) => this.getOrder(id));
          const orders = (await Promise.all(orderPromises)).filter(
            (order): order is Order => order !== undefined
          );

          return {
            price,
            orders,
            totalVolume: orders
              .reduce(
                (sum, order) =>
                  sum + (parseFloat(order.amount) - parseFloat(order.filled)),
                0
              )
              .toString(),
          };
        })
    );

    return pricesWithOrders;
  }

  async getSellLevels(limit = 100): Promise<PriceLevel[]> {
    const priceLevels = await this.getPriceLevels("SELL");

    const pricesWithOrders = await Promise.all(
      Array.from(priceLevels.entries())
        .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
        .slice(0, limit)
        .map(async ([price, orderIds]) => {
          const orderPromises = orderIds.map((id) => this.getOrder(id));
          const orders = (await Promise.all(orderPromises)).filter(
            (order): order is Order => order !== undefined
          );

          return {
            price,
            orders,
            totalVolume: orders
              .reduce(
                (sum, order) =>
                  sum + (parseFloat(order.amount) - parseFloat(order.filled)),
                0
              )
              .toString(),
          };
        })
    );

    return pricesWithOrders;
  }

  async getAmountOut(
    orderType: OrderType,
    amount: string
  ): Promise<AmountOutResult> {
    try {
      const isBuy = orderType === "BUY";
      const priceLevels = isBuy
        ? await this.getSellLevels()
        : await this.getBuyLevels();

      if (priceLevels.length === 0) {
        return {
          isError: true,
          errorMessage: "No liquidity available",
          outputAmount: "0",
          prices: [],
        };
      }

      let remainingAmount = parseFloat(amount);
      let totalOutput = 0;
      const hitPrices: string[] = [];

      for (const level of priceLevels) {
        if (remainingAmount <= 0) break;

        const levelPrice = parseFloat(level.price);
        const levelVolume = parseFloat(level.totalVolume);

        if (isBuy) {
          const quoteSpendAtLevel = Math.min(
            remainingAmount,
            levelVolume * levelPrice
          );
          const baseReceived = quoteSpendAtLevel / levelPrice;
          totalOutput += baseReceived;
          remainingAmount -= quoteSpendAtLevel;
        } else {
          const baseSellAtLevel = Math.min(remainingAmount, levelVolume);
          const quoteReceived = baseSellAtLevel * levelPrice;
          totalOutput += quoteReceived;
          remainingAmount -= baseSellAtLevel;
        }

        hitPrices.push(level.price);
      }

      if (remainingAmount > 0) {
        return {
          isError: true,
          errorMessage: `Insufficient liquidity (unfilled amount: ${remainingAmount})`,
          outputAmount: totalOutput.toString(),
          prices: hitPrices,
        };
      }

      return {
        isError: false,
        outputAmount: totalOutput.toString(),
        prices: hitPrices,
      };
    } catch (error) {
      return {
        isError: true,
        errorMessage: `Calculation error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        outputAmount: "0",
        prices: [],
      };
    }
  }

  async getOrderBook(depth = 20): Promise<OrderBook> {
    const [bids, asks, latestPrice] = await Promise.all([
      this.getBuyLevels(depth),
      this.getSellLevels(depth),
      this.redisClient.get(this.getLatestPriceKey()),
    ]);

    return {
      baseToken: this.baseToken,
      quoteToken: this.quoteToken,
      latestPrice: latestPrice || "0",
      bids,
      asks,
    };
  }

  async getUserOrders(trader: string): Promise<Order[]> {
    const orderIds = await this.redisClient.smembers(
      this.getTraderOrdersKey(trader)
    );
    const orderPromises = orderIds.map((id) => this.getOrder(id));
    return (await Promise.all(orderPromises)).filter(
      (order): order is Order => order !== undefined
    );
  }

  async setLatestPrice(price: string): Promise<void> {
    await this.redisClient.set(this.getLatestPriceKey(), price);
  }

  async getLatestPrice(): Promise<string> {
    const price = await this.redisClient.get(this.getLatestPriceKey());
    return price || "0";
  }

  async getPoolInfo(): Promise<PoolInfo> {
    const latestPrice = await this.getLatestPrice();

    return {
      address: this.contractAddress,
      baseToken: this.baseToken,
      quoteToken: this.quoteToken,
      latestPrice,
    };
  }
}
