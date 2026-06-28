"""
쿠팡 Wing 부가세 매출자료 크롤링

쿠팡 Wing 로그인 → 정산 → 부가세신고내역 수집
- 로그인: Keycloak OAuth (xauth.coupang.com) + xdotool paste
- 판매자윙: proportion-sales (iframe 없음, select 4개 + table 1개)
- 로켓그로스: 같은 페이지에서 탭 클릭 → rfm/settlements/vat-report
- 테이블: 매출인식월 | 신용/체크카드 | 현금영수증 | 기타 | 합계 | 상세다운로드
"""
import time
import re
import subprocess
import os

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from django.db import connections

LOGIN_URL = "https://wing.coupang.com/"
WING_VAT_URL = "https://wing.coupang.com/tenants/finance/wing/contentsurl/proportion-sales"
ROCKET_VAT_URL = "https://wing.coupang.com/tenants/rfm/settlements/vat-report?category=GOLDFISH"

SALES_COLS = ('credit_card', 'cash_receipt', 'etc_payment', 'total_sales')

# 로켓그로스 사용 계정 (business_id)
ROCKET_GROWTH_BIZ_IDS = {3, 6, 14}  # bitcom1, nainjoy6, joacham


def _parse_int(text):
    if not text:
        return 0
    cleaned = re.sub(r'[^\d\-]', '', text.strip())
    return int(cleaned) if cleaned else 0


def _xtype(text, display_env):
    """xclip + xdotool로 클립보드 붙여넣기."""
    env = {**os.environ, 'DISPLAY': display_env}
    subprocess.run(['xclip', '-selection', 'clipboard'],
                   input=text.encode(), check=True, env=env)
    subprocess.run(['xdotool', 'key', 'ctrl+v'], env=env)


def _get_business_id(login_id):
    """login_id → business_id (vat_account, market=coupang)."""
    with connections['tax'].cursor() as cur:
        cur.execute(
            "SELECT business_id FROM vat_account WHERE market='coupang' AND login_id=%s LIMIT 1",
            [login_id])
        row = cur.fetchone()
    return row[0] if row else None


def login_coupang_wing(driver, login_id, login_pw, display_env, log_fn):
    """쿠팡 Wing OAuth 로그인 (xdotool 키보드 입력)."""
    log_fn(f"[쿠팡] 로그인: {login_id}")
    driver.get(LOGIN_URL)
    time.sleep(5)

    # OAuth 로그인 페이지 대기
    try:
        WebDriverWait(driver, 15).until(
            lambda d: 'xauth.coupang.com' in d.current_url or 'wing.coupang.com' in d.current_url)
    except TimeoutException:
        log_fn(f"[쿠팡] 로그인 페이지 로딩 타임아웃. URL: {driver.current_url}", 'error')
        return False

    # 이미 로그인 됨
    if 'wing.coupang.com' in driver.current_url and 'xauth' not in driver.current_url:
        log_fn("[쿠팡] 이미 로그인됨", 'success')
        return True

    # Keycloak 로그인
    try:
        id_input = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "username")))
        id_input.click()
        time.sleep(0.3)
        _xtype(login_id, display_env)
        time.sleep(0.3)

        pw_input = driver.find_element(By.ID, "password")
        pw_input.click()
        time.sleep(0.3)
        _xtype(login_pw, display_env)
        time.sleep(0.3)

        login_btn = driver.find_element(By.ID, "kc-login")
        login_btn.click()
        time.sleep(8)
    except NoSuchElementException:
        log_fn("[쿠팡] Keycloak 셀렉터 실패, input type으로 재시도")
        try:
            inputs = driver.find_elements(By.CSS_SELECTOR, 'input[type="text"], input[type="email"]')
            if inputs:
                inputs[0].click()
                time.sleep(0.3)
                _xtype(login_id, display_env)
                time.sleep(0.3)
            pw_inputs = driver.find_elements(By.CSS_SELECTOR, 'input[type="password"]')
            if pw_inputs:
                pw_inputs[0].click()
                time.sleep(0.3)
                _xtype(login_pw, display_env)
                time.sleep(0.3)
            env = {**os.environ, 'DISPLAY': display_env}
            subprocess.run(['xdotool', 'key', 'Return'], env=env)
            time.sleep(8)
        except Exception as e:
            log_fn(f"[쿠팡] 로그인 입력 실패: {e}", 'error')
            return False

    # alert 처리
    try:
        driver.switch_to.alert.accept()
    except Exception:
        pass

    # 로그인 성공 확인
    try:
        WebDriverWait(driver, 15).until(
            lambda d: 'wing.coupang.com' in d.current_url and 'xauth' not in d.current_url)
    except TimeoutException:
        log_fn(f"[쿠팡] 로그인 리다이렉트 타임아웃. URL: {driver.current_url}", 'error')
        return False

    log_fn("[쿠팡] 로그인 성공", 'success')
    return True


def _set_period_and_search(driver, start_ym, end_ym, log_fn):
    """기간 설정 (select 4개: 시작연/월, 종료연/월) + 검색 클릭."""
    start_year = start_ym[:4]
    start_month = str(int(start_ym[4:]))  # "01" → "1"
    end_year = end_ym[:4]
    end_month = str(int(end_ym[4:]))

    selects = driver.find_elements(By.TAG_NAME, "select")
    if len(selects) < 4:
        log_fn(f"[쿠팡] select {len(selects)}개 — 기간 설정 불가", 'warn')
        return False

    try:
        Select(selects[0]).select_by_value(start_year)
        time.sleep(0.3)
        Select(selects[1]).select_by_value(start_month)
        time.sleep(0.3)
        Select(selects[2]).select_by_value(end_year)
        time.sleep(0.3)
        Select(selects[3]).select_by_value(end_month)
        time.sleep(0.5)
        log_fn(f"[쿠팡] 기간: {start_year}-{start_month} ~ {end_year}-{end_month}")
    except Exception as e:
        log_fn(f"[쿠팡] 기간 설정 실패: {e}", 'error')
        return False

    # 검색 버튼 클릭
    for btn in driver.find_elements(By.TAG_NAME, "button"):
        try:
            if btn.text.strip() == '검색' and btn.is_displayed():
                btn.click()
                log_fn("[쿠팡] 검색 클릭")
                time.sleep(8)
                return True
        except Exception:
            continue

    log_fn("[쿠팡] 검색 버튼 못 찾음", 'warn')
    return False


def _parse_vat_table(driver, log_fn):
    """부가세 테이블 파싱.

    행: 매출인식월(YYYY-MM) | 신용/체크카드 | 현금영수증 | 기타 | 합계 | 상세다운로드
    '총합계'/'총합' 행은 스킵.
    """
    results = []

    tables = driver.find_elements(By.TAG_NAME, "table")
    if not tables:
        log_fn("[쿠팡] 테이블 없음", 'warn')
        return results

    tbl = tables[0]
    rows = tbl.find_elements(By.TAG_NAME, "tr")
    for row in rows:
        tds = row.find_elements(By.TAG_NAME, "td")
        if len(tds) < 5:
            continue

        period_text = tds[0].text.strip()

        # 총합계/총합 행 스킵
        if '합계' in period_text or '합' == period_text.strip():
            continue

        # 날짜 파싱: "2026-01", "2026-03" 등
        m = re.match(r'(\d{4})-(\d{1,2})', period_text)
        if not m:
            # "2026년 01월" 패턴도 지원
            m = re.search(r'(\d{4})[-년.]?\s*(\d{1,2})', period_text)
        if not m:
            continue

        year = int(m.group(1))
        month = int(m.group(2))

        row_data = {
            'year': year,
            'month': month,
            'credit_card': _parse_int(tds[1].text),
            'cash_receipt': _parse_int(tds[2].text),
            'etc_payment': _parse_int(tds[3].text),
            'total_sales': _parse_int(tds[4].text),
        }
        results.append(row_data)
        log_fn(f"  [쿠팡] {year}-{month:02d}: "
               f"신용={row_data['credit_card']:,} 현금={row_data['cash_receipt']:,} "
               f"기타={row_data['etc_payment']:,} 합계={row_data['total_sales']:,}")

    return results


def _save_results(business_id, sale_type, rows, log_fn):
    """vat_coupang에 저장 (INSERT ON DUPLICATE KEY UPDATE)."""
    if not rows:
        return 0

    saved = 0
    with connections['tax'].cursor() as cur:
        for d in rows:
            cur.execute("""
                INSERT INTO vat_coupang
                    (business_id, year, month, sale_type,
                     credit_card, cash_receipt, etc_payment, total_sales)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    credit_card=VALUES(credit_card),
                    cash_receipt=VALUES(cash_receipt),
                    etc_payment=VALUES(etc_payment),
                    total_sales=VALUES(total_sales)
            """, [business_id, d['year'], d['month'], sale_type,
                  d['credit_card'], d['cash_receipt'], d['etc_payment'], d['total_sales']])
            saved += 1
    return saved


def crawl_coupang_vat(driver, login_id, login_pw, start_ym, end_ym,
                      display_env, log_fn, save_to_db=True):
    """쿠팡 계정 1개: 판매자윙 + 로켓그로스 VAT 크롤링.

    Returns: {'판매자윙': [rows], '로켓그로스': [rows]}
    """
    all_results = {'판매자윙': [], '로켓그로스': []}

    business_id = _get_business_id(login_id)
    if not business_id:
        log_fn(f"[쿠팡][{login_id}] business_id 없음 — 스킵", 'error')
        return all_results

    # 로그인
    if not login_coupang_wing(driver, login_id, login_pw, display_env, log_fn):
        return all_results

    time.sleep(2)

    # ===== 1. 판매자윙 부가세 =====
    log_fn(f"\n--- [{login_id}] 판매자윙 부가세 ---")
    driver.get(WING_VAT_URL)
    time.sleep(8)

    if _set_period_and_search(driver, start_ym, end_ym, log_fn):
        wing_rows = _parse_vat_table(driver, log_fn)
        if wing_rows:
            all_results['판매자윙'] = wing_rows
            log_fn(f"[쿠팡][{login_id}] 판매자윙: {len(wing_rows)}행", 'success')
            if save_to_db:
                saved = _save_results(business_id, '판매자윙', wing_rows, log_fn)
                log_fn(f"[쿠팡][{login_id}] 판매자윙 DB 저장: {saved}건", 'success')
        else:
            log_fn(f"[쿠팡][{login_id}] 판매자윙: 데이터 없음", 'warn')
    else:
        log_fn(f"[쿠팡][{login_id}] 판매자윙 기간/검색 실패", 'error')

    # ===== 2. 로켓그로스 부가세 (해당 계정만) =====
    if business_id in ROCKET_GROWTH_BIZ_IDS:
        log_fn(f"\n--- [{login_id}] 로켓그로스 부가세 ---")

        # 로켓그로스 탭 클릭 (같은 페이지에서 탭 전환)
        rg_navigated = False

        # 방법 1: 탭 텍스트 클릭
        try:
            elements = driver.find_elements(By.XPATH,
                "//*[contains(text(), '로켓그로스') and contains(text(), '부가세')]")
            for el in elements:
                if el.is_displayed():
                    driver.execute_script("arguments[0].click();", el)
                    time.sleep(8)
                    rg_navigated = True
                    log_fn("[쿠팡] 로켓그로스 탭 클릭")
                    break
        except Exception:
            pass

        # 방법 2: 직접 URL 이동
        if not rg_navigated:
            driver.get(ROCKET_VAT_URL)
            time.sleep(8)
            if 'vat-report' in driver.current_url or 'settlements' in driver.current_url:
                rg_navigated = True
                log_fn("[쿠팡] 로켓그로스 URL 직접 이동")

        if rg_navigated:
            if _set_period_and_search(driver, start_ym, end_ym, log_fn):
                rg_rows = _parse_vat_table(driver, log_fn)
                if rg_rows:
                    all_results['로켓그로스'] = rg_rows
                    log_fn(f"[쿠팡][{login_id}] 로켓그로스: {len(rg_rows)}행", 'success')
                    if save_to_db:
                        saved = _save_results(business_id, '로켓그로스', rg_rows, log_fn)
                        log_fn(f"[쿠팡][{login_id}] 로켓그로스 DB 저장: {saved}건", 'success')
                else:
                    log_fn(f"[쿠팡][{login_id}] 로켓그로스: 데이터 없음", 'warn')
            else:
                log_fn(f"[쿠팡][{login_id}] 로켓그로스 기간/검색 실패", 'error')
        else:
            log_fn(f"[쿠팡][{login_id}] 로켓그로스 페이지 접근 실패", 'warn')
    else:
        log_fn(f"[쿠팡][{login_id}] 로켓그로스 미사용 (biz={business_id})")

    return all_results
