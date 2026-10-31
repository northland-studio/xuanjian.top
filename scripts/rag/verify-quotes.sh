#!/bin/bash
# 验证哲指数行情接口
curl -s --max-time 15 https://xuanjian.top/api/express-index/quotes -o /tmp/q.json
node -e "
const j = require('/tmp/q.json');
if (!j.ok) { console.log('  ✗ ' + JSON.stringify(j).slice(0, 200)); process.exit(0); }
const s = j.settings;
console.log('  参数: 哲指数=' + s.zheIndex + ' 股价基准=' + s.priceBase + ' 活跃基准=' + s.activeBase + ' 买入费=' + s.buyFeeRate + ' 卖出税=' + s.sellTaxRate + ' 熔断底价=' + s.floorPrice);
j.stocks.forEach(function (x) {
  console.log('  ' + x.name + '(' + x.symbol + ') 现价=' + x.price + ' 昨收=' + x.yesterdayClose + ' 涨跌=' + x.change + '(' + x.changePct + '%) 可买=' + x.canBuy + (x.floored ? ' [熔断]' : ''));
});
"
