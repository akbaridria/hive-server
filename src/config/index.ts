import dotenv from "dotenv";

dotenv.config();

interface Config {
  factoryAddress: string;
  providerUrl: string;
  wsProviderUrl: string;
  port: number;
  redisUrl?: string;
}

const config: Config = {
  factoryAddress: process.env.FACTORY_ADDRESS || "",
  providerUrl: process.env.PROVIDER_URL || "http://localhost:8545",
  wsProviderUrl: process.env.WS_PROVIDER_URL || "ws://localhost:8545",
  port: parseInt(process.env.PORT || "3000"),
  redisUrl: process.env.REDIS_URL,
};

export default config;
