# GIS regions + palette deploy driver. ASCII only.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$tag = '20261115-gis-regions2'
$stage = Join-Path $root "_deploy_$tag"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
$backend = Join-Path $stage 'backend'
New-Item -ItemType Directory -Path (Join-Path $backend 'lib/gis') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $backend 'routes') -Force | Out-Null

Write-Host "[1/4] stage files ..."
$files = @(
  'lib/gis/regions.js','lib/gis/block-colors.json','lib/gis/map-palette.js','lib/gis/map.js','routes/gis.js'
)
foreach ($f in $files) { Copy-Item $f (Join-Path $backend $f) -Force }
tar -czf (Join-Path $stage 'dist.tgz') -C frontend/dist .
tar -czf (Join-Path $stage 'dist-ssr.tgz') -C frontend/dist-ssr .
Copy-Item scripts/deploy-gis-remote-regions2-20261115.sh (Join-Path $stage 'deploy.sh')
Write-Host ("  dist.tgz {0:N1} KB / dist-ssr.tgz {1:N1} KB / backend {2} files" -f `
  ((Get-Item (Join-Path $stage 'dist.tgz')).Length/1kb), ((Get-Item (Join-Path $stage 'dist-ssr.tgz')).Length/1kb), $files.Count)

Write-Host "[2/4] upload to HK:/root/deploy-$tag ..."
ssh HK "rm -rf /root/deploy-$tag && mkdir -p /root/deploy-$tag"
scp -r "$stage/dist.tgz" "$stage/dist-ssr.tgz" "$stage/backend" "$stage/deploy.sh" "HK:/root/deploy-$tag/"
ssh HK "sed -i 's/\r$//' /root/deploy-$tag/deploy.sh && chmod +x /root/deploy-$tag/deploy.sh"

Write-Host "[3/4] run remote deploy ..."
ssh HK "bash /root/deploy-$tag/deploy.sh"

Write-Host "[4/4] done. staging: $stage"
