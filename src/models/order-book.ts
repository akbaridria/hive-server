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
  private buyOrders: Map<string, string[]> = new Map();
  private sellOrders: Map<string, string[]> = new Map();
  private orderById: Map<string, Order> = new Map();
  private orderByTrader: Map<string, Map<string, Order>> = new Map();
  private marketOrderByTrader: Map<string, MarketOrder[]> = new Map();
  private latestPrice: string = "0";
  private contractAddress: string = "";

  constructor(
    baseToken: TokenERC20,
    quoteToken: TokenERC20,
    contractAddress: string
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

  updateOrderFilled(
    id: string,
    filled: string,
    remainingAmount: string,
    trader: string,
    isActive: boolean
  ): boolean {
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

  addMarketOrder(marketOrder: MarketOrder, trader: string): void {
    if (!this.marketOrderByTrader.has(trader)) {
      this.marketOrderByTrader.set(trader, []);
    }
    this.marketOrderByTrader.get(trader)?.push(marketOrder);
  }

  getMarketOrders(trader: string): MarketOrder[] {
    return this.marketOrderByTrader.get(trader) || [];
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

  getAmountOut(orderType: OrderType, amount: string): AmountOutResult {
    try {
      const isBuy = orderType === "BUY";
      const priceLevels = isBuy ? this.getSellLevels() : this.getBuyLevels();

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
      address: this.contractAddress,
      baseToken: this.baseToken,
      quoteToken: this.quoteToken,
      latestPrice: this.latestPrice,
    };
  }
}
