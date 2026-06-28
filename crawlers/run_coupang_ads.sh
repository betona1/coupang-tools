#!/bin/bash
# 쿠팡 광고센터 전 계정 자동수집 (매일). flock 으로 중복실행 방지(크롤 길어 겹침 방지).
exec 9>/tmp/run_coupang_ads.lock
flock -n 9 || { echo "[$(date '+%F %T')] 이미 실행중 — 스킵"; exit 0; }
cd /home/joacham/projects/ai100/viewer/gmarket_cpc/backend
DJANGO_SETTINGS_MODULE=config.settings /usr/bin/python3 manage.py crawl_coupang_ads --all --days 3
