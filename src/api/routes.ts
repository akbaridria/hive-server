import { Router } from "express";
import OrderBookController from "./controllers/order-book-controller";
import PoolController from "./controllers/pool-controller";

export default function routes(factoryListener: any) {
  const router = Router();

  const orderBookController = new OrderBookController(factoryListener);
  const poolController = new PoolController(factoryListener);

  router.get("/pools", poolController.getAllPools);
  router.get("/pools/:address", poolController.getPoolInfo);
  router.get("/pools/:address/orderbook", orderBookController.getOrderBook);
  router.get("/pools/:address/orders/:id", orderBookController.getOrder);
  router.get("/pools/:address/:trader/orders", orderBookController.getUserOrders);
  router.get("/pools/:address/:trader/market-orders", orderBookController.getMarketOrders);
  router.get("/pools/:address/get-amount-out", orderBookController.getAmountOut);

  return router;
}
