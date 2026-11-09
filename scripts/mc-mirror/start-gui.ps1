# 启动 MC 镜像同步 GUI（本地）
# 用法：右键「使用 PowerShell 运行」，或 pwsh -File scripts\mc-mirror\start-gui.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root

Write-Host '正在从 HK 读取七牛密钥...'
$envText = ssh -o ConnectTimeout=10 hk "cat /var/www/xuanjian-guild/.env"
$ak = ''; $sk = ''
foreach ($l in ($envText -split "`n")) {
  if ($l -match '^QINIU_ACCESS_KEY=(.+)') { $ak = $matches[1].Trim().Trim('"') }
  if ($l -match '^QINIU_SECRET_KEY=(.+)') { $sk = $matches[1].Trim().Trim('"') }
}
if (-not $ak -or -not $sk) { throw '读取密钥失败，请确认 ssh hk 可用' }

$env:QINIU_ACCESS_KEY = $ak
$env:QINIU_SECRET_KEY = $sk
$env:MIRROR_BUCKET = 'xuanjian-mc-mirror'
$env:MIRROR_REGION = 'as0'
$env:MIRROR_UPLOAD_HOST = 'xuanjian-mc-mirror.kodo-accelerate.ap-southeast-1.qiniucs.com'
$env:MIRROR_CONCURRENCY = '24'
$env:MIRROR_CACHE = Join-Path $env:TEMP 'mc-mirror-cache'
$env:APP_DIR = $root
$env:GUI_PORT = '8790'

New-Item -ItemType Directory -Force $env:MIRROR_CACHE | Out-Null
Write-Host '密钥已就绪（AK 长度 ' $ak.Length '）'
Write-Host '打开 http://127.0.0.1:8790 查看进度'
Start-Process 'http://127.0.0.1:8790'
node scripts\mc-mirror\gui-server.js
