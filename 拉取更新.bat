@echo off
title Battery Calculator - Pull Update
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pull_update.ps1"
