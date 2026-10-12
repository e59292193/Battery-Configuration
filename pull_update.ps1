﻿# 电池计算器 - 一键拉取更新（由 拉取更新.bat 双击启动）
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host '   电池计算器 - 从 GitHub 拉取最新版本...'      -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ''

# 1. 拉取远端信息
git fetch origin 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Host '[错误] 无法连接 GitHub，请检查网络后重试。' -ForegroundColor Red
    Write-Host ''
    Read-Host '按回车键退出'
    exit 1
}

# 2. 快进合并（不自动产生合并提交，避免覆盖本地改动）
git merge --ff-only origin/main 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '[提示] 自动更新失败：本地存在未推送的提交或修改，' -ForegroundColor Yellow
    Write-Host '       为避免覆盖你的改动已停止，请先处理本地变更。' -ForegroundColor Yellow
    Write-Host ''
    Read-Host '按回车键退出'
    exit 1
}

# 3. 显示当前版本
Write-Host ''
git log --oneline -1 2>&1 | Out-Host
Write-Host ''
Write-Host '[完成] 已同步到最新版本。' -ForegroundColor Green
Write-Host ''
Read-Host '按回车键退出'
