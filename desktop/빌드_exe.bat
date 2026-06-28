@echo off
chcp 65001 >nul
title 쿠팡리뷰수집기 EXE 빌드
cd /d "%~dp0"
echo [1/2] 패키지 설치...
pip install pyinstaller PySide6 PySide6-Addons beautifulsoup4 openpyxl pymysql
echo [2/2] 빌드 (QtWebEngine 포함 - 수 분)...
pyinstaller --noconfirm --windowed --name 쿠팡리뷰수집기 --collect-all PySide6 coupang_review_gui.py
echo 완료! dist\쿠팡리뷰수집기\쿠팡리뷰수집기.exe
echo .env 파일을 exe 와 같은 폴더에 복사하세요(DB저장용).
pause
