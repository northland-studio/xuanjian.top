class TitleItem {
  final int id;
  final String name;
  final String? color;
  final int price;
  final String type; // preset, custom
  final bool isOwned;
  final bool isEquipped;
  final bool inShop;

  TitleItem({required this.id, required this.name, this.color, this.price = 0, this.type = 'preset', this.isOwned = false, this.isEquipped = false, this.inShop = false});

  factory TitleItem.fromJson(Map<String, dynamic> json) => TitleItem(
    id: json['id'] ?? 0,
    name: json['name'] ?? '',
    color: json['color'],
    price: json['price'] ?? 0,
    type: json['type'] ?? 'preset',
    isOwned: json['is_owned'] == 1 || json['is_owned'] == true,
    isEquipped: json['is_equipped'] == 1 || json['is_equipped'] == true,
    inShop: json['in_shop'] == 1 || json['in_shop'] == true,
  );
}
