import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import routes from "./routes";
import logger from "../utils/logger";

export default function createServer(
  factoryListener: any, // Adjust type as needed
  port: number
) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  app.use(cors());
  app.use(express.json());
  app.use("/api", routes(factoryListener));

  // Socket.io setup
  io.on("connection", (socket) => {
    logger.info("Client connected");

    socket.on("subscribe:orderbook", (poolAddress: string) => {
      socket.join(`orderbook:${poolAddress}`);
      const listener = factoryListener.getPoolListener(poolAddress);
      if (listener) {
        socket.emit("orderbook", listener.getOrderBook());
      }
    });

    socket.on("disconnect", () => {
      logger.info("Client disconnected");
    });
  });

  // Broadcast updates to specific pool subscribers
  factoryListener.onPoolCreated = (poolAddress: string) => {
    const listener = factoryListener.getPoolListener(poolAddress);
    if (listener) {
      io.to(`orderbook:${poolAddress}`).emit(
        "orderbook",
        listener.getOrderBook()
      );
    }
  };

  const start = () => {
    server.listen(port, () => {
      logger.info(`API server listening on port ${port}`);
    });

    return { app, server, io };
  };

  return { start };
}
