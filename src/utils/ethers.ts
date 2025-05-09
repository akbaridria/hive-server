import { ethers } from "ethers";
import config from "../config";

let provider: ethers.providers.JsonRpcProvider;

export function getProvider(): ethers.providers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.providers.JsonRpcProvider(config.providerUrl);
  }
  return provider;
}
