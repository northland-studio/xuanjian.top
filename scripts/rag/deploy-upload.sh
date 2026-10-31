#!/bin/bash
# 部署上传改造（服务端 + 前端）并做冒烟验证
set -e
APP=/var/www/xuanjian-guild
cd "$APP"
TAG=upload-$(date +%Y%m%d-%H%M%S)

echo "=== 1. 备份 ==="
cp routes/upload.js "routes/upload.js.bak-$TAG"
cp -a frontend/dist "frontend/dist.bak-$TAG"
echo "  $TAG"

echo "=== 2. 服务端 ==="
cp /root/upload-route.js routes/upload.js
node --check routes/upload.js && echo "  语法 OK"
grep -c "router.delete('/object'" routes/upload.js | sed 's/^/  DELETE \/object 数量: /'

echo "=== 3. 前端 ==="
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf /root/deploy-upload/dist.tgz -C frontend/dist.new
[ -f frontend/dist.new/index.html ] || { echo "缺少 index.html"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf /root/deploy-upload/dist-ssr.tgz -C frontend/dist-ssr
rm -rf frontend/prerender
node scripts/prerender.js --clean 2>&1 | tail -2

echo "=== 4. 重启 ==="
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo -n "  首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/

echo "=== 5. 冒烟：直传凭证（wiki 类型）==="
TOKEN=$(node -e "
process.chdir('/var/www/xuanjian-guild');
require('/var/www/xuanjian-guild/node_modules/dotenv').config({ path: '/var/www/xuanjian-guild/.env', quiet: true });
const jwt=require('/var/www/xuanjian-guild/node_modules/jsonwebtoken');
process.stdout.write(jwt.sign({userId:2, level:1}, process.env.JWT_SECRET, {expiresIn:'10m'}));
" 2>/dev/null)

RESP=$(curl -s -X POST http://127.0.0.1:3000/api/upload/token \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  --data-binary '{"kind":"wiki","filename":"测试图片.PNG"}')
echo "$RESP" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  if(j.key){console.log('  ✓ 凭证签发成功');console.log('    key=' + j.key);console.log('    maxSizeMB=' + j.maxSizeMB + ' kind=' + j.kind);console.log('    uploadUrl=' + j.uploadUrl);console.log('    url前缀=' + String(j.url).slice(0,40));}
  else console.log('  ✗ 失败: ' + JSON.stringify(j).slice(0,200));
})"

echo "=== 6. 冒烟：非法格式应被拒绝 ==="
curl -s -o /dev/null -w '  exe 文件 -> %{http_code}\n' -X POST http://127.0.0.1:3000/api/upload/token \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  --data-binary '{"kind":"wiki","filename":"bad.exe"}'

echo "=== 7. 冒烟：删除他人目录应被拒绝 ==="
curl -s -o /dev/null -w '  删他人对象 -> %{http_code}\n' -X DELETE http://127.0.0.1:3000/api/upload/object \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  --data-binary '{"key":"wiki/999999/123-abc.png"}'

echo "=== 8. 真实直传一张图片到七牛并校验可访问 ==="
node -e "
require('/var/www/xuanjian-guild/node_modules/dotenv').config({ path: '/var/www/xuanjian-guild/.env', quiet: true });
const https=require('https');
const jwt=require('/var/www/xuanjian-guild/node_modules/jsonwebtoken');
const token=jwt.sign({userId:2, level:1}, process.env.JWT_SECRET, {expiresIn:'10m'});
function post(path, body, headers){
  return new Promise((resolve)=>{
    const data=Buffer.from(JSON.stringify(body));
    const r=https.request({host:'127.0.0.1',port:3000,path,method:'POST',headers:{'Content-Type':'application/json','Content-Length':data.length,...headers}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,body:d}))});
    r.write(data);r.end();
  });
}
(async()=>{
  const t=await post('/api/upload/token',{kind:'wiki',filename:'smoke.png'},{Authorization:'Bearer '+token});
  const meta=JSON.parse(t.body);
  if(!meta.key){console.log('  签发失败');process.exit(0)}
  // 1x1 png
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  const boundary='----xj'+Date.now();
  const parts=[];
  parts.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name=\"token\"\r\n\r\n'+meta.uploadToken+'\r\n'));
  parts.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name=\"key\"\r\n\r\n'+meta.key+'\r\n'));
  parts.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name=\"file\"; filename=\"smoke.png\"\r\nContent-Type: image/png\r\n\r\n'));
  parts.push(png);
  parts.push(Buffer.from('\r\n--'+boundary+'--\r\n'));
  const body=Buffer.concat(parts);
  const up=new URL(meta.uploadUrl);
  const req=https.request({host:up.hostname,path:up.pathname,method:'POST',headers:{'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':body.length}},res=>{
    let d='';res.on('data',c=>d+=c);res.on('end',()=>{
      console.log('  七牛直传 HTTP ' + res.statusCode + (res.statusCode===200?' ✓':' ✗ ' + d.slice(0,120)));
      if(res.statusCode===200){
        https.get(meta.url, r2=>{console.log('  CDN 访问 HTTP ' + r2.statusCode + (r2.statusCode===200?' ✓ 图片可访问':' ✗'))}).on('error',e=>console.log('  CDN 访问失败: ' + e.message));
      }
    });
  });
  req.on('error',e=>console.log('  上传失败: '+e.message));
  req.write(body);req.end();
})();
" 2>&1 | grep -v dotenv
