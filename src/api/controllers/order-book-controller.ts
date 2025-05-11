import { Request, Response } from "express";

export default class OrderBookController {
  constructor(private factoryListener: any) {}

  getUserOrders = (req: Request, res: Response) => {
    try {
      const poolAddress = req.params.address;
      const traderAddress = req.params.trader;
      const listener = this.factoryListener.getTraderListener(poolAddress);
      if (!listener) {
        return res.status(404).json({ error: "Trader not found" });
      }
      const orders = listener.getOrders(traderAddress);
      if (!orders) {
        return res.status(404).json({ error: "No orders found" });
      }
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };

  getOrderBook = (req: Request, res: Response) => {
    try {
      const poolAddress = req.params.address;
      const depth = parseInt(req.query.depth as string) || 10;

      const listener = this.factoryListener.getPoolListener(poolAddress);
      if (!listener) {
        return res.status(404).json({ error: "Pool not found" });
      }

      res.json(listener.getOrderBook(depth));
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };

  getOrder = (req: Request, res: Response) => {
    try {
      const poolAddress = req.params.address;
      const orderId = req.params.id;

      const listener = this.factoryListener.getPoolListener(poolAddress);
      if (!listener) {
        return res.status(404).json({ error: "Pool not found" });
      }

      const order = listener.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json(order);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
