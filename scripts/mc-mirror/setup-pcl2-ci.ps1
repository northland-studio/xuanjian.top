param([switch]$Force)
$ErrorActionPreference = 'Stop'
$src = 'H:\chengxuyuanma\PCL-unzip\PCL-main'
Set-Location $src

# 1. 写入 CI 配置
$wfDir = Join-Path $src '.github\workflows'
New-Item -ItemType Directory -Force $wfDir | Out-Null
$yaml = @'
name: build-pcl2

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Setup MSBuild
        uses: microsoft/setup-msbuild@v2

      - name: Setup NuGet
        uses: NuGet/setup-nuget@v2

      - name: Restore
        shell: pwsh
        run: |
          $sln = Get-ChildItem -Recurse -Filter *.sln | Select-Object -First 1
          Write-Host "Solution: $($sln.FullName)"
          $pkgs = Get-ChildItem -Recurse -Filter packages.config -ErrorAction SilentlyContinue
          if ($pkgs -and $pkgs.Count -gt 0) { nuget restore $sln.FullName }

      - name: Build
        shell: pwsh
        run: |
          $sln = Get-ChildItem -Recurse -Filter *.sln | Select-Object -First 1
          msbuild $sln.FullName /p:Configuration=Release /p:Platform="Any CPU" /m /v:m /restore

      - name: Collect output
        shell: pwsh
        run: |
          New-Item -ItemType Directory -Force out | Out-Null
          Get-ChildItem -Recurse -Filter *.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match 'bin.*Release' } |
            ForEach-Object { Write-Host "EXE: $($_.FullName) $([math]::Round($_.Length/1MB,1))MB"; Copy-Item $_.FullName out }
          Get-ChildItem -Recurse -Directory -Filter Resources -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match 'bin.*Release' } |
            ForEach-Object { Write-Host "RES: $($_.FullName)"; Copy-Item $_.FullName out -Recurse -Force }
          Get-ChildItem out | Select-Object Name, Length

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: PCL2-patched
          path: out/**
          if-no-files-found: warn
'@
Set-Content -Path (Join-Path $wfDir 'build.yml') -Value $yaml -Encoding utf8NoBOM
Write-Host '[1/5] 已写入 .github/workflows/build.yml'

# 2. git 初始化
if (-not (Test-Path '.git')) { git init -q }
git config user.name 'Morzane123'
git config user.email 'dev@xuanjian.top'
git add -A
git -c core.autocrlf=false commit -q -m "build: PCL2 patched download source -> mc-cdn.xuanjian.top" 2>&1 | Out-String | Write-Host
Write-Host '[2/5] 本地提交完成'

# 3. 建仓库并推送
$repoName = 'xuanjian-pcl2'
$exists = gh repo view "Morzane123/$repoName" 2>$null
if (-not $exists) {
  gh repo create $repoName --private --source . --remote origin --push 2>&1 | Out-String | Write-Host
} else {
  if (-not (git remote | Select-String '^origin$')) { git remote add origin "https://github.com/Morzane123/$repoName.git" }
  git branch -M main
  git push -u origin main --force 2>&1 | Out-String | Write-Host
}
Write-Host '[3/5] 推送完成'

# 4. 分支名确认
git branch -M main
Write-Host '[4/5] 当前分支: ' (git rev-parse --abbrev-ref HEAD)
Write-Host '[5/5] 仓库: https://github.com/Morzane123/'$repoName
