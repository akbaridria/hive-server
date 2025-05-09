import { Order, PriceLevel, OrderBook, PoolInfo } from "./types";

export default class OrderBookModel {
  private baseToken: string;
  private quoteToken: string;
  private buyOrders: Map<string, Order[]> = new Map();
  private sellOrders: Map<string, Order[]> = new Map();
  private orderById: Map<string, Order> = new Map();
  private latestPrice: string = "0";

  constructor(baseToken: string, quoteToken: string) {
    this.baseToken = baseToken;
    this.quoteToken = quoteToken;
  }

  addOrder(order: Order): void {
    this.orderById.set(order.id, order);

    const priceMap =
      order.orderType === "BUY" ? this.buyOrders : this.sellOrders;
    const priceKey = order.price;

    if (!priceMap.has(priceKey)) {
      priceMap.set(priceKey, []);
    }
    priceMap.get(priceKey)?.push(order);
  }

  updateOrder(id: string, newAmount: string, newFilled?: string): boolean {
    const order = this.orderById.get(id);
    if (!order) return false;

    order.amount = newAmount;
    if (newFilled !== undefined) order.filled = newFilled;

    return true;
  }

  removeOrder(id: string): boolean {
    const order = this.orderById.get(id);
    if (!order) return false;

    const priceMap =
      order.orderType === "BUY" ? this.buyOrders : this.sellOrders;
    const priceKey = order.price;
    const ordersAtPrice = priceMap.get(priceKey) || [];

    const updatedOrders = ordersAtPrice.filter((o) => o.id !== id);
    if (updatedOrders.length === 0) {
      priceMap.delete(priceKey);
    } else {
      priceMap.set(priceKey, updatedOrders);
    }

    this.orderById.delete(id);
    return true;
  }

  getBuyLevels(limit = 100): PriceLevel[] {
    return Array.from(this.buyOrders.entries())
      .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
      .slice(0, limit)
      .map(([price, orders]) => ({
        price,
        orders,
        totalVolume: orders
          .reduce(
            (sum, order) =>
              sum + (parseFloat(order.amount) - parseFloat(order.filled)),
            0
          )
          .toString(),
      }));
  }

  getSellLevels(limit = 100): PriceLevel[] {
    return Array.from(this.sellOrders.entries())
      .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
      .slice(0, limit)
      .map(([price, orders]) => ({
        price,
        orders,
        totalVolume: orders
          .reduce(
            (sum, order) =>
              sum + (parseFloat(order.amount) - parseFloat(order.filled)),
            0
          )
          .toString(),
      }));
  }

  getOrderBook(depth = 10): OrderBook {
    return {
      baseToken: this.baseToken,
      quoteToken: this.quoteToken,
      latestPrice: this.latestPrice,
      bids: this.getBuyLevels(depth),
      asks: this.getSellLevels(depth),
    };
  }

  getOrder(id: string): Order | undefined {
    return this.orderById.get(id);
  }

  setLatestPrice(price: string): void {
    this.latestPrice = price;
  }

  getPoolInfo(): PoolInfo {
    return {
      address: "", // Will be set by the listener
      baseToken: this.baseToken,
      quoteToken: this.quoteToken,
      latestPrice: this.latestPrice,
    };
  }
}
