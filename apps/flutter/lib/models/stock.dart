class Stock {
  final int id;
  final String code;
  final String name;
  final double currentPrice;
  final double basePrice;
  final int availableShares;
  final double volatility;
  final String trend; // up, down, stable
  final String status; // active, suspended
  final int totalShares;
  final double changePercent;

  Stock({required this.id, required this.code, required this.name, required this.currentPrice, required this.basePrice, this.availableShares = 0, this.volatility = 0.05, this.trend = 'stable', this.status = 'active', this.totalShares = 0, this.changePercent = 0});

  factory Stock.fromJson(Map<String, dynamic> json) => Stock(
    id: json['id'] ?? 0,
    code: json['code'] ?? '',
    name: json['name'] ?? '',
    currentPrice: (json['current_price'] ?? 0).toDouble(),
    basePrice: (json['base_price'] ?? 0).toDouble(),
    availableShares: json['available_shares'] ?? 0,
    volatility: (json['volatility'] ?? 0.05).toDouble(),
    trend: json['trend'] ?? 'stable',
    status: json['status'] ?? 'active',
    totalShares: json['total_shares'] ?? 0,
    changePercent: (json['change_percent'] ?? 0).toDouble(),
  );
}

class StockHolding {
  final int stockId;
  final String stockName;
  final String stockCode;
  final int shares;
  final double avgPrice;
  final double currentPrice;
  final double profit;
  final double profitPercent;

  StockHolding({required this.stockId, required this.stockName, required this.stockCode, this.shares = 0, this.avgPrice = 0, this.currentPrice = 0, this.profit = 0, this.profitPercent = 0});

  factory StockHolding.fromJson(Map<String, dynamic> json) => StockHolding(
    stockId: json['stock_id'] ?? 0,
    stockName: json['stock_name'] ?? '',
    stockCode: json['stock_code'] ?? '',
    shares: json['shares'] ?? 0,
    avgPrice: (json['avg_price'] ?? 0).toDouble(),
    currentPrice: (json['current_price'] ?? 0).toDouble(),
    profit: (json['profit'] ?? 0).toDouble(),
    profitPercent: (json['profit_percent'] ?? 0).toDouble(),
  );
}

class Transaction {
  final int id;
  final int stockId;
  final String stockName;
  final String type; // buy, sell
  final int shares;
  final double price;
  final String createdAt;

  Transaction({required this.id, required this.stockId, required this.stockName, required this.type, required this.shares, required this.price, required this.createdAt});

  factory Transaction.fromJson(Map<String, dynamic> json) => Transaction(
    id: json['id'] ?? 0,
    stockId: json['stock_id'] ?? 0,
    stockName: json['stock_name'] ?? '',
    type: json['type'] ?? '',
    shares: json['shares'] ?? 0,
    price: (json['price'] ?? 0).toDouble(),
    createdAt: json['created_at'] ?? '',
  );
}
