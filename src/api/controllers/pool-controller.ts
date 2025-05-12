import { Request, Response } from "express";

export default class PoolController {
  constructor(private factoryListener: any) {}

  getAllPools = (req: Request, res: Response) => {
    try {
      const pools = this.factoryListener.getAllPools();
      res.json(pools);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };

  getPoolInfo = (req: Request, res: Response) => {
    try {
      const poolAddress = req.params.address;
      const listener = this.factoryListener.getPoolListener(poolAddress);
      if (!listener) {
        return res.status(404).json({ error: "Pool not found" });
      }

      res.json(listener.getPoolInfo());
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
