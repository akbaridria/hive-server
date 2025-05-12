import { Request, Response } from "express";

export default class OrderBookController {
  constructor(private factoryListener: any) {}

  getAmountOut = (req: Request, res: Response) => {
    try {
      const poolAddress = req.params.address;
      const listener = this.factoryListener.getPoolListener(poolAddress);
      if (!listener) {
        return res.status(404).json({ error: "Pool not found" });
      }

      const orderType = req.query.orderType as string;
      const amount = req.query.amount as string;
      const result = listener.getAmountOut(orderType, amount);
      if (result === undefined) {
        return res.status(404).json({ error: "Amount out not found" });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };

  getMarketOrders = async (req: Request, res: Response) => {
    try {
      const poolAddress = req.params.address;
      const trader = req.params.trader;
      const listener = this.factoryListener.getPoolListener(poolAddress);
      if (!listener) {
        return res.status(404).json({ error: "Pool not found" });
      }
      const orders = await listener.getUserMarketOrders(trader);
      if (!orders) {
        return res.status(404).json({ error: "No market orders found" });
      }
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };

  getUserOrders = async (req: Request, res: Response) => {
    try {
      const poolAddress = req.params.address;
      const traderAddress = req.params.trader;
      const listener = this.factoryListener.getPoolListener(poolAddress);
      if (!listener) {
        return res.status(404).json({ error: "Trader not found" });
      }
      const orders = await listener.getOrderByTrader(traderAddress);
      if (!orders) {
        return res.status(404).json({ error: "No orders found" });
      }
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };

  getOrderBook = async (req: Request, res: Response) => {
    try {
      const poolAddress = req.params.address;
      const depth = parseInt(req.query.depth as string) || 10;

      const listener = this.factoryListener.getPoolListener(poolAddress);
      if (!listener) {
        return res.status(404).json({ error: "Pool not found" });
      }

      res.json(await listener.getOrderBook(depth));
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };

  getOrder = async (req: Request, res: Response) => {
    try {
      const poolAddress = req.params.address;
      const orderId = req.params.id;

      const listener = this.factoryListener.getPoolListener(poolAddress);
      if (!listener) {
        return res.status(404).json({ error: "Pool not found" });
      }

      const order = await listener.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json(order);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
