import { Order, PriceLevel, OrderBook, PoolInfo, OrderType } from "./types";

export default class OrderBookModel {
  private baseToken: string;
  private quoteToken: string;
  private buyOrders: Map<string, string[]> = new Map();
  private sellOrders: Map<string, string[]> = new Map();
  private orderById: Map<string, Order> = new Map();
  private orderByTrader: Map<string, Map<string, Order>> = new Map();
  private latestPrice: string = "0";
  private contractAddress: string = "";

  constructor(
    baseToken: string,
    quoteToken: string,
    contractAddress: string = ""
  ) {
    this.baseToken = baseToken;
    this.quoteToken = quoteToken;
    this.contractAddress = contractAddress;
  }

  addOrder(order: Order): void {
    this.orderById.set(order.id, order);

    const priceMap =
      order.orderType === "BUY" ? this.buyOrders : this.sellOrders;
    const priceKey = order.price;

    if (!this.orderByTrader.has(order.trader)) {
      this.orderByTrader.set(order.trader, new Map());
      this.orderByTrader.get(order.trader)?.set(order.id, order);
    }

    if (!priceMap.has(priceKey)) {
      priceMap.set(priceKey, []);
    }
    priceMap.get(priceKey)?.push(order.id);
  }

  updateOrder(id: string, newAmount: string, trader: string): boolean {
    const order = this.orderById.get(id);
    if (!order) return false;

    order.amount = newAmount;
    this.orderById.set(id, order);
    this.orderByTrader.get(trader)?.set(id, order);

    return true;
  }

  updatePriceMap(orderType: OrderType, price: string, id: string): void {
    const priceMap = orderType === "BUY" ? this.buyOrders : this.sellOrders;
    const ordersAtPrice = priceMap.get(price) || [];
    const updatedOrders = ordersAtPrice.filter((oId) => oId !== id);
    if (updatedOrders.length === 0) {
      priceMap.delete(price);
    } else {
      priceMap.set(price, updatedOrders);
    }
  }

  updateOrderFilled(id: string, filled: string, remainingAmount: string, trader: string, isActive: boolean): boolean {
    const order = this.orderById.get(id);
    if (!order) return false;

    order.filled = filled;
    order.remainingAmount = remainingAmount;
    order.active = isActive;

    this.orderById.set(id, order);
    this.orderByTrader.get(trader)?.set(id, order);

    if (!isActive) {
      this.updatePriceMap(order.orderType, order.price, id);
    }

    return true;
  }

  removeOrder(id: string): boolean {
    const order = this.orderById.get(id);
    if (!order) return false;

    order.active = false;

    const priceMap =
      order.orderType === "BUY" ? this.buyOrders : this.sellOrders;
    const priceKey = order.price;
    const ordersAtPrice = priceMap.get(priceKey) || [];

    const updatedOrders = ordersAtPrice.filter((oId) => oId !== id);
    if (updatedOrders.length === 0) {
      priceMap.delete(priceKey);
    } else {
      priceMap.set(priceKey, updatedOrders);
    }

    this.orderById.set(id, order);
    this.orderByTrader.get(order.trader)?.set(id, order);
    return true;
  }

  getBuyLevels(limit = 100): PriceLevel[] {
    return Array.from(this.buyOrders.entries())
      .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
      .slice(0, limit)
      .map(([price, orderIds]) => {
        const orders = orderIds
          .map((id) => this.orderById.get(id))
          .filter((order): order is Order => order !== undefined);
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
      });
  }

  getSellLevels(limit = 100): PriceLevel[] {
    return Array.from(this.sellOrders.entries())
      .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
      .slice(0, limit)
      .map(([price, orderIds]) => {
        const orders = orderIds
          .map((id) => this.orderById.get(id))
          .filter((order): order is Order => order !== undefined);
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
      });
  }

  getOrderBook(depth = 20): OrderBook {
    return {
      baseToken: this.baseToken,
      quoteToken: this.quoteToken,
      latestPrice: this.latestPrice,
      bids: this.getBuyLevels(depth),
      asks: this.getSellLevels(depth),
    };
  }

  getUserOrders(trader: string): Order[] {
    const orders = this.orderByTrader.get(trader);
    if (!orders) return [];
    return Array.from(orders.values());
  }

  getOrder(id: string): Order | undefined {
    return this.orderById.get(id);
  }

  setLatestPrice(price: string): void {
    this.latestPrice = price;
  }

  getPoolInfo(): PoolInfo {
    return {
      address: this.contractAddress, // Will be set by the listener
      baseToken: this.baseToken,
      quoteToken: this.quoteToken,
      latestPrice: this.latestPrice,
    };
  }
}
