export type OrderType = "BUY" | "SELL";

export interface Order {
  id: string;
  trader: string;
  price: string;
  amount: string;
  filled: string;
  remainingAmount: string;
  orderType: OrderType;
  active: boolean;
  timestamp: number;
}

export interface MarketOrder {
  timestamp: number;
  amount: string;
  ordertype: OrderType;
}

export interface PriceLevel {
  price: string;
  orders: Order[];
  totalVolume: string;
}

export interface OrderBook {
  baseToken: TokenERC20;
  quoteToken: TokenERC20;
  latestPrice: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
}

export interface PoolInfo {
  address: string;
  baseToken: TokenERC20;
  quoteToken: TokenERC20;
  latestPrice: string;
}

export interface TokenERC20 {
  name: string;
  symbol: string;
  decimals: number;
  address: string;
}

export interface AmountOutResult {
  isError: boolean;
  errorMessage?: string;
  outputAmount: string;
  prices: string[];
}