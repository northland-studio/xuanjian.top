class ShopItem {
  final int id;
  final String name;
  final String type; // title, item
  final int price;
  final int stock;
  final String status;
  final String? description;
  final String? imageUrl;

  ShopItem({required this.id, required this.name, required this.type, this.price = 0, this.stock = 0, this.status = 'active', this.description, this.imageUrl});

  factory ShopItem.fromJson(Map<String, dynamic> json) => ShopItem(
    id: json['id'] ?? 0,
    name: json['name'] ?? '',
    type: json['type'] ?? 'item',
    price: json['price'] ?? 0,
    stock: json['stock'] ?? 0,
    status: json['status'] ?? 'active',
    description: json['description'],
    imageUrl: json['image_url'],
  );
}

class UserItem {
  final int id;
  final int itemId;
  final String itemName;
  final String itemType;
  final String? verifyCode;
  final bool isVerified;
  final String? purchasedAt;

  UserItem({required this.id, required this.itemId, required this.itemName, required this.itemType, this.verifyCode, this.isVerified = false, this.purchasedAt});

  factory UserItem.fromJson(Map<String, dynamic> json) => UserItem(
    id: json['id'] ?? 0,
    itemId: json['item_id'] ?? 0,
    itemName: json['item_name'] ?? '',
    itemType: json['item_type'] ?? '',
    verifyCode: json['verify_code'],
    isVerified: json['is_verified'] == 1 || json['is_verified'] == true,
    purchasedAt: json['purchased_at'],
  );
}
