import { ethers } from "ethers";
import config from "../config";

let provider: ethers.providers.JsonRpcProvider;
let wsProvider: ethers.providers.WebSocketProvider;

export function getProvider(): ethers.providers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.providers.JsonRpcProvider(config.providerUrl);
  }
  return provider;
}

export function getWsProvider(): ethers.providers.WebSocketProvider {
  if (!wsProvider) {
    wsProvider = new ethers.providers.WebSocketProvider(config.wsProviderUrl);
  }
  return wsProvider;
}