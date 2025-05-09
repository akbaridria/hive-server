export type OrderType = "BUY" | "SELL";

export interface Order {
  id: string;
  trader: string;
  price: string;
  amount: string;
  filled: string;
  orderType: OrderType;
  active: boolean;
  timestamp: number;
}

export interface PriceLevel {
  price: string;
  orders: Order[];
  totalVolume: string;
}

export interface OrderBook {
  baseToken: string;
  quoteToken: string;
  latestPrice: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
}

export interface PoolInfo {
  address: string;
  baseToken: string;
  quoteToken: string;
  latestPrice: string;
}
