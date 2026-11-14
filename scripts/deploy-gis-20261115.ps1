# GIS frontend deploy driver (ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI)
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-gis-20261115.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$tag = '20261115-gis-fe'
$stage = Join-Path $root "_deploy_$tag"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

Write-Host "[1/4] pack frontend/dist and dist-ssr ..."
tar -czf (Join-Path $stage 'dist.tgz') -C frontend/dist .
tar -czf (Join-Path $stage 'dist-ssr.tgz') -C frontend/dist-ssr .
Copy-Item lib/gis/terrain.js (Join-Path $stage 'terrain.js')
Copy-Item scripts/deploy-gis-remote-20261115.sh (Join-Path $stage 'deploy.sh')
$d1 = (Get-Item (Join-Path $stage 'dist.tgz')).Length / 1kb
$d2 = (Get-Item (Join-Path $stage 'dist-ssr.tgz')).Length / 1kb
Write-Host ("  dist.tgz {0:N1} KB / dist-ssr.tgz {1:N1} KB" -f $d1, $d2)

Write-Host "[2/4] upload to HK:/root/deploy-$tag ..."
ssh HK "rm -rf /root/deploy-$tag && mkdir -p /root/deploy-$tag"
scp "$stage/dist.tgz" "$stage/dist-ssr.tgz" "$stage/terrain.js" "$stage/deploy.sh" "HK:/root/deploy-$tag/"
ssh HK "sed -i 's/\r$//' /root/deploy-$tag/deploy.sh && chmod +x /root/deploy-$tag/deploy.sh && ls -l /root/deploy-$tag"

Write-Host "[3/4] run remote deploy script ..."
ssh HK "bash /root/deploy-$tag/deploy.sh"

Write-Host "[4/4] done. staging dir: $stage"
