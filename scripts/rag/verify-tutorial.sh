#!/bin/bash
# 验证教程页面
URL=https://xuanjian.top/wiki/gu-hui-gu-shi-xin-shou-zhi-nan
echo -n "页面状态: "; curl -s -o /tmp/tut.html -w '%{http_code}\n' --max-time 15 "$URL"
node -e "
const fs=require('fs');
const h=fs.readFileSync('/tmp/tut.html','utf8');
const checks=[
  ['标题', h.includes('公会股市新手指南')],
  ['三个板块', h.includes('玄剑重工') && h.includes('玄剑建工') && h.includes('玄剑人力')],
  ['手续费提醒', h.includes('印花税')],
  ['熔断', h.includes('熔断底价')],
  ['新手建议', h.includes('给新手的五条建议')],
  ['FAQ', h.includes('常见问题')],
  ['风险提示', h.includes('风险提示')],
  ['链接到系统页', h.includes('zhe-shi-dong-tai-zhi-shu-xi-tong')]
];
checks.forEach(([k,v])=>console.log('  '+(v?'✓':'✗')+' '+k));
const chars = h.replace(/<[^>]+>/g,'').replace(/\s+/g,'').length;
console.log('  正文字数约: '+chars);
"
echo -n "分类页可见: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 "https://xuanjian.top/wiki/category/wang-zhan-jiao-cheng"
