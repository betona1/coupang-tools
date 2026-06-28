"""쿠팡 WING 대화형 로그인 (2FA 문자인증) + 쿠키 저장 + 쿠키 로그인.

- runserver 단일 프로세스(멀티스레드)이므로 모듈 전역 _SESS 로 요청 간 드라이버를 유지.
- 흐름: start_auth → (스레드) UC 로그인 → 2FA면 status='need_otp' 로 대기 →
        submit_otp(코드) → 인증 완료 → 쿠키/프로필 저장 → status='done'.
- 이후 크롤링은 login_with_cookies() 로 저장된 프로필/쿠키 재사용 (로그인 POST 스킵 → Akamai 회피).
- 1회 인증 시 쿠팡 세션이 수개월 유지됨.
"""
import os
import sys
import json
import time
import shutil
import tempfile
import threading

PROFILE_BASE = os.path.expanduser('~/coupang_wing_profiles')

# account_id -> {status, log[], error, url, otp, otp_event, driver}
#   status: idle | starting | need_otp | submitting | done | error
_SESS = {}
_LOCK = threading.Lock()


def _add_crawlers_path():
    gmarket = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    if gmarket not in sys.path:
        sys.path.insert(0, gmarket)


def _make_uc_driver(profile_dir):
    _add_crawlers_path()
    import undetected_chromedriver as uc
    from crawlers.browser import _ensure_display, _get_chrome_version, _find_chromedriver, CHROME_BIN
    _ensure_display()
    ver = _get_chrome_version()
    # 호출마다 고유 드라이버 복사본 (동시 실행/잔존 프로세스 'Text file busy' 방지)
    fd, drv = tempfile.mkstemp(prefix='uc_chromedriver_wing_', dir='/tmp')
    os.close(fd)
    # CHROME_BIN(hub Chrome) 버전과 일치하는 chromedriver 우선 (PATH의 다른버전이 150이어도 회피)
    drv_src = _find_chromedriver()
    if ver:
        import glob as _glob
        _m = sorted(_glob.glob(os.path.expanduser(f'~/.cache/selenium/chromedriver/linux64/{ver}.*/chromedriver')))
        if _m:
            drv_src = _m[-1]
    shutil.copy(drv_src, drv)
    os.chmod(drv, 0o755)
    opts = uc.ChromeOptions()
    opts.binary_location = CHROME_BIN
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--window-size=1920,1080')
    opts.add_argument(f'--user-data-dir={profile_dir}')
    return uc.Chrome(options=opts, headless=False, version_main=ver, driver_executable_path=drv)


def _body(driver):
    try:
        from selenium.webdriver.common.by import By
        return driver.find_element(By.TAG_NAME, 'body').text
    except Exception:
        return ''


def _log(s, m):
    s['log'].append(m)
    if len(s['log']) > 200:
        s['log'] = s['log'][-200:]


def _dump_2fa(driver, s):
    """2FA 페이지 입력칸/버튼 구조를 로그에 기록 (셀렉터 파악용)."""
    from selenium.webdriver.common.by import By
    try:
        ins = []
        for el in driver.find_elements(By.TAG_NAME, 'input'):
            try:
                if el.is_displayed():
                    ins.append(f"t={el.get_attribute('type')},id={el.get_attribute('id')},"
                               f"name={el.get_attribute('name')},ph={el.get_attribute('placeholder')}")
            except Exception:
                continue
        _log(s, '[2FA inputs] ' + ' || '.join(ins[:10]))
        btns = []
        for b in driver.find_elements(By.TAG_NAME, 'button'):
            try:
                t = (b.text or '').strip()
                if b.is_displayed() and t:
                    btns.append(f'"{t[:18]}"(id={b.get_attribute("id")})')
            except Exception:
                continue
        _log(s, '[2FA buttons] ' + ' || '.join(btns[:14]))
        # body 텍스트 일부(인증수단 안내)
        try:
            bt = driver.find_element(By.TAG_NAME, 'body').text
            keys = [l.strip() for l in bt.split('\n') if l.strip() and any(k in l for k in ('인증', '문자', '전송', '받기', '휴대폰', '코드', '번호'))]
            _log(s, '[2FA text] ' + ' | '.join(keys[:8]))
        except Exception:
            pass
    except Exception as e:
        _log(s, f'[2FA dump 오류] {e}')


def _select_sms_method(driver, s):
    """2단계 인증 수단선택 화면에서 '휴대폰 문자 인증'(#btnSms, input[name=mfaType]) 클릭
    → 쿠팡이 문자 발송 + OTP 입력 화면으로 전환."""
    from selenium.webdriver.common.by import By
    # 1순위: 알려진 셀렉터 (#btnSms / input[name=mfaType])
    for sel in ('#btnSms', "input[name='mfaType']", "input[id*='Sms']", "input[id*='sms']",
                "input[value*='문자']", "input[value*='휴대폰']", "button#btnSms"):
        for el in driver.find_elements(By.CSS_SELECTOR, sel):
            try:
                if el.is_displayed():
                    driver.execute_script("arguments[0].click();", el)
                    _log(s, f'문자인증 선택 클릭: {sel}')
                    return True
            except Exception:
                continue
    # 2순위: 텍스트 '휴대폰...인증' / '문자'
    for el in driver.find_elements(By.XPATH,
            "//*[(self::button or self::a or self::input) and (contains(.,'휴대폰') or contains(@value,'문자') or contains(.,'문자'))]"):
        try:
            if el.is_displayed():
                driver.execute_script("arguments[0].click();", el)
                _log(s, '휴대폰/문자 인증 클릭(텍스트)')
                return True
        except Exception:
            continue
    _log(s, '문자인증 선택 버튼 못 찾음')
    return False


def _click_send_sms(driver, s):
    """OTP 입력 화면에서 '인증번호 전송/재전송' 버튼이 따로 있으면 클릭(없으면 자동발송)."""
    from selenium.webdriver.common.by import By
    SEND = ('인증번호 받기', '인증번호 전송', '인증번호전송', '재전송', '전송', '받기', '발송')
    SKIP = ('확인', '로그인', '다음', '완료', '취소', '닫기')
    for el in driver.find_elements(By.CSS_SELECTOR, 'button, a, input[type=button], input[type=submit]'):
        try:
            t = ((el.text or '') + ' ' + (el.get_attribute('value') or '')).strip()
            if not t or not el.is_displayed() or any(k in t for k in SKIP):
                continue
            if any(k in t for k in SEND):
                driver.execute_script("arguments[0].click();", el)
                _log(s, f'인증번호 발송/재전송 클릭: "{t[:18]}"')
                return True
        except Exception:
            continue
    return False


def _read_coupang_otp_sms(since_dt):
    """업무폰 수신 SMS(sms2.received_sms_message)에서 쿠팡 OTP 자동 추출."""
    import re
    try:
        from django.db import connections
        with connections['sms2'].cursor() as c:
            c.execute(
                "SELECT message FROM received_sms_message "
                "WHERE received_at >= %s ORDER BY id DESC LIMIT 8", [since_dt])
            for (msg,) in c.fetchall():
                m = msg or ''
                if any(k in m for k in ('쿠팡', 'coupang', 'Coupang', 'COUPANG')) or '인증번호' in m:
                    mm = re.search(r'(?:인증번호[^\d]{0,6})?(\d{6})', m) or re.search(r'(\d{4,6})', m)
                    if mm:
                        return mm.group(1)
    except Exception:
        pass
    return None


def _wait_otp(s, timeout=180):
    """수동 입력(otp_event) 또는 업무폰 SMS 자동수신 중 먼저 오는 것."""
    from django.utils import timezone
    since = timezone.now()
    start = time.time()
    while time.time() - start < timeout:
        if s['otp_event'].wait(timeout=2):
            return s.get('otp')
        code = _read_coupang_otp_sms(since)
        if code:
            _log(s, f'업무폰 문자 자동수신: {code}')
            return code
    return None


def _looks_like_otp(body):
    kws = ('인증번호', '문자인증', '휴대폰', 'SMS', '인증 요청', '2단계', '본인확인', '인증수단', '인증 메일')
    return any(k in body for k in kws)


def _enter_otp(driver, code):
    """인증번호 입력란을 찾아 코드 입력 + 제출. 쿠팡 2FA: #auth-mfa-code + #mfa-submit."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    # 쿠팡 정확 셀렉터 우선
    el = driver.find_elements(By.ID, 'auth-mfa-code')
    if el and el[0].is_displayed():
        t = el[0]
        t.click(); time.sleep(0.3)
        try:
            t.clear()
        except Exception:
            pass
        t.send_keys(code); time.sleep(0.5)
        sub = driver.find_elements(By.ID, 'mfa-submit')
        if sub:
            driver.execute_script("arguments[0].click();", sub[0])
        else:
            t.send_keys(Keys.RETURN)
        return True
    # 폴백: 일반 탐색
    inputs = driver.find_elements(
        By.CSS_SELECTOR,
        'input[type="tel"], input[type="number"], input[type="text"], input:not([type]), input[type="password"]')
    target = None
    for el in inputs:
        try:
            if not el.is_displayed():
                continue
            attr = ((el.get_attribute('name') or '') + (el.get_attribute('id') or '')
                    + (el.get_attribute('placeholder') or '')).lower()
            if any(k in attr for k in ('otp', 'code', 'auth', 'cert', '인증', 'sms', 'verify', 'token')):
                target = el
                break
        except Exception:
            continue
    if target is None:
        for el in inputs:
            try:
                if el.is_displayed():
                    target = el
                    break
            except Exception:
                continue
    if target is None:
        return False
    target.click()
    time.sleep(0.3)
    target.send_keys(code)
    time.sleep(0.5)
    for b in driver.find_elements(By.TAG_NAME, 'button'):
        try:
            if b.is_displayed() and any(k in (b.text or '') for k in ('확인', '인증', '다음', '완료', '로그인')):
                b.click()
                return True
        except Exception:
            continue
    target.send_keys(Keys.RETURN)
    return True


def _save_cookies(driver, acc):
    from django.utils import timezone
    from . import coupang_rocket_service as crs
    cookies = driver.get_cookies()
    acc.wing_cookies = crs.encrypt_secret(json.dumps(cookies))
    acc.wing_authed_at = timezone.now()
    acc.save(update_fields=['wing_cookies', 'wing_authed_at'])
    try:
        detect_account_status(driver, acc)
    except Exception:
        pass


def _logged_in(driver):
    u = driver.current_url
    return 'wing.coupang.com' in u and 'xauth' not in u


def detect_account_status(driver, acc, log_fn=None):
    """WING 홈 페이지에서 계정 상태(신규등록제한/폐점/정상) 감지 후 저장."""
    from django.utils import timezone
    try:
        if 'wing.coupang.com' not in driver.current_url or 'xauth' in driver.current_url:
            driver.get('https://wing.coupang.com/')
            time.sleep(4)
    except Exception:
        pass
    body = _body(driver)
    status, detail = '정상', ''
    if any(k in body for k in ('신규 상품을 등록할 수 없습니다', '신규상품을 등록할 수 없습니다',
                               '상품을 등록할 수 없습니다')):
        status, detail = '신규등록제한', '신규 상품 등록 불가'
    if any(k in body for k in ('폐점', '탈퇴 처리', '계약 종료', '판매 중지', '판매정지', '이용 정지', '계정 정지')):
        status = '폐점' if ('폐점' in body or '계약 종료' in body) else '판매정지'
        detail = detail or '폐점/정지'
    acc.account_status = status
    acc.status_detail = detail
    acc.status_checked_at = timezone.now()
    acc.save(update_fields=['account_status', 'status_detail', 'status_checked_at'])
    if log_fn:
        log_fn(f'[{acc.cupang_id}] 상태: {status}{(" - "+detail) if detail else ""}')
    return status


def _login_thread(account_id):
    from .models import CoupangApiAccount
    from . import coupang_rocket_service as crs
    from selenium.webdriver.common.by import By
    s = _SESS[account_id]
    driver = None
    try:
        acc = CoupangApiAccount.objects.get(pk=account_id)
        login_id = acc.wing_login_id or acc.cupang_id
        login_pw = crs.decrypt_secret(acc.wing_password_enc) if acc.wing_password_enc else ''
        if not login_pw:
            s['status'] = 'error'; s['error'] = 'WING 비밀번호 미등록 (먼저 비번 저장)'
            return
        profile = os.path.join(PROFILE_BASE, f'coupang_{acc.cupang_id}')
        os.makedirs(profile, exist_ok=True)

        _log(s, '브라우저 생성...')
        driver = _make_uc_driver(profile)
        s['driver'] = driver
        try:
            driver.set_page_load_timeout(40)
        except Exception:
            pass

        _log(s, 'wing.coupang.com 접속...')
        try:
            driver.get('https://wing.coupang.com/')
        except Exception:
            pass
        time.sleep(6)
        s['url'] = driver.current_url

        if _logged_in(driver):
            _log(s, '이미 로그인 상태(프로필 유효) — 쿠키 저장')
            _save_cookies(driver, acc)
            s['status'] = 'done'
            return

        body = _body(driver)
        if 'Access Denied' in body:
            s['status'] = 'error'; s['error'] = 'Akamai 차단 — 잠시 후 다시 시도'
            return
        if not driver.find_elements(By.ID, 'username'):
            s['status'] = 'error'; s['error'] = f'로그인 폼 없음 (url={driver.current_url[:60]})'
            return

        _log(s, f'로그인 입력: {login_id}')
        u = driver.find_element(By.ID, 'username'); u.click(); time.sleep(0.3); u.send_keys(login_id); time.sleep(0.3)
        p = driver.find_element(By.ID, 'password'); p.click(); time.sleep(0.3); p.send_keys(login_pw); time.sleep(0.3)
        _log(s, '로그인 제출...')
        driver.find_element(By.ID, 'kc-login').click()
        time.sleep(8)
        s['url'] = driver.current_url
        body = _body(driver)

        if 'Access Denied' in body:
            s['status'] = 'error'; s['error'] = 'Akamai 차단(제출 단계) — 잠시 후 다시 시도'
            return
        if _logged_in(driver):
            _log(s, '로그인 성공 (2차인증 없음) — 쿠키 저장')
            _save_cookies(driver, acc)
            s['status'] = 'done'
            return
        if any(k in body for k in ('비밀번호가 다릅', '일치하지', '아이디 또는')):
            s['status'] = 'error'; s['error'] = '아이디/비밀번호 불일치'
            return
        # 쿠팡 주기적 비밀번호 변경 강제 화면
        if any(k in body for k in ('비밀번호를 변경', '비밀번호 변경', '새 비밀번호', '비밀번호가 만료',
                                   '비밀번호를 재설정', '주기적으로 비밀번호')):
            from django.utils import timezone
            acc.account_status = '비번변경필요'
            acc.status_detail = '쿠팡이 비밀번호 변경을 요구함 — WING에서 직접 변경 후 새 비번 등록'
            acc.status_checked_at = timezone.now()
            acc.save(update_fields=['account_status', 'status_detail', 'status_checked_at'])
            s['status'] = 'error'
            s['error'] = '⚠ 쿠팡이 비밀번호 변경을 요구합니다 — WING에서 비번 변경 후 설정에 새 비번 등록하세요'
            return

        if _looks_like_otp(body):
            _dump_2fa(driver, s)               # 수단선택 화면 구조
            # 1단계: 휴대폰 문자 인증 선택 → 문자 발송 + OTP 입력화면 전환
            if _select_sms_method(driver, s):  # #btnSms 클릭 = 문자 발송 + OTP 화면
                time.sleep(5)
            _log(s, '문자(2차) 인증 — 문자 발송됨. 자동수신/수동입력 대기 (3분)')
            s['status'] = 'need_otp'
            code = _wait_otp(s, timeout=180)
            if not code:
                s['status'] = 'error'; s['error'] = '인증번호 시간초과(미수신/미입력)'
                return
            s['status'] = 'submitting'
            _log(s, f'인증번호 입력 후 제출: {code}')
            if not _enter_otp(driver, code):
                s['status'] = 'error'; s['error'] = '인증번호 입력란을 찾지 못함'
                return
            time.sleep(8)
            s['url'] = driver.current_url
            if _logged_in(driver):
                _log(s, '2차 인증 성공 — 쿠키 저장')
                _save_cookies(driver, acc)
                s['status'] = 'done'
                return
            s['status'] = 'error'; s['error'] = '인증 실패 (번호 오류/만료 가능)'
            _log(s, _body(driver)[:200])
            return

        s['status'] = 'error'; s['error'] = f'알 수 없는 화면 (url={driver.current_url[:60]})'
        _log(s, body[:200])
    except Exception as e:
        s['status'] = 'error'; s['error'] = f'{type(e).__name__}: {e}'
    finally:
        try:
            if driver:
                driver.quit()
        except Exception:
            pass
        s['driver'] = None


def start_auth(account_id):
    with _LOCK:
        s = _SESS.get(account_id)
        if s and s['status'] in ('starting', 'need_otp', 'submitting'):
            return s['status']
        _SESS[account_id] = {
            'status': 'starting', 'log': [], 'error': '', 'url': '',
            'otp': None, 'otp_event': threading.Event(), 'driver': None,
        }
    threading.Thread(target=_login_thread, args=(account_id,), daemon=True).start()
    return 'starting'


def submit_otp(account_id, code):
    s = _SESS.get(account_id)
    if not s or s['status'] != 'need_otp':
        return False
    s['otp'] = (code or '').strip()
    s['otp_event'].set()
    return True


def get_status(account_id):
    s = _SESS.get(account_id)
    if not s:
        from .models import CoupangApiAccount
        acc = CoupangApiAccount.objects.filter(pk=account_id).first()
        # 쿠키(유효 세션)가 있어야 진짜 인증완료. 쿠키 없으면 미인증.
        if acc and acc.wing_authed_at and acc.wing_cookies:
            return {'status': 'done', 'log': [], 'error': '',
                    'authed_at': acc.wing_authed_at.strftime('%Y-%m-%d %H:%M')}
        return {'status': 'idle', 'log': [], 'error': ''}
    out = {'status': s['status'], 'log': s['log'][-40:], 'error': s['error'], 'url': s.get('url', '')}
    if s['status'] == 'done':
        from .models import CoupangApiAccount
        acc = CoupangApiAccount.objects.filter(pk=account_id).first()
        if acc and acc.wing_authed_at:
            out['authed_at'] = acc.wing_authed_at.strftime('%Y-%m-%d %H:%M')
    return out


def login_with_cookies(acc, log_fn=None):
    """저장된 프로필/쿠키로 WING 로그인된 드라이버 반환. 실패 시 None (재인증 필요)."""
    def lg(m):
        if log_fn:
            log_fn(m)
    profile = os.path.join(PROFILE_BASE, f'coupang_{acc.cupang_id}')
    os.makedirs(profile, exist_ok=True)
    driver = _make_uc_driver(profile)
    try:
        driver.set_page_load_timeout(40)
    except Exception:
        pass
    try:
        driver.get('https://wing.coupang.com/')
    except Exception:
        pass
    # 프로필에 유효 세션/OAuth 리프레시 토큰이 있으면 자동 로그인됨.
    # 리다이렉트 체인(xauth→wing)이 수 초 걸리므로 넉넉히 대기 + 재확인.
    from selenium.webdriver.common.by import By
    for _ in range(4):
        time.sleep(4)
        if _logged_in(driver):
            lg('프로필 세션 유효 — 로그인됨')
            return driver
        # 로그인 폼이 떴으면 OAuth 자동완성 실패 → 더 기다릴 필요 없음
        if driver.find_elements(By.ID, 'username'):
            break

    if acc.wing_cookies:
        from . import coupang_rocket_service as crs
        try:
            cookies = json.loads(crs.decrypt_secret(acc.wing_cookies))
            # CDP Network.setCookie — 현재 페이지 도메인과 무관하게 쿠키 설정 가능
            try:
                driver.execute_cdp_cmd('Network.enable', {})
            except Exception:
                pass
            n = 0
            for c in cookies:
                ck = {
                    'name': c.get('name'), 'value': c.get('value'),
                    'domain': c.get('domain'), 'path': c.get('path', '/'),
                    'secure': bool(c.get('secure', False)),
                    'httpOnly': bool(c.get('httpOnly', False)),
                }
                if c.get('expiry'):
                    ck['expires'] = c['expiry']
                if not ck['name'] or ck['domain'] is None:
                    continue
                try:
                    driver.execute_cdp_cmd('Network.setCookie', ck)
                    n += 1
                except Exception:
                    pass
            lg(f'쿠키 {n}개 주입(CDP)')
            driver.get('https://wing.coupang.com/')
            time.sleep(5)
            if _logged_in(driver):
                lg('쿠키 로그인 성공')
                return driver
            lg(f'쿠키 주입 후에도 미로그인 (url={driver.current_url[:60]})')
        except Exception as e:
            lg(f'쿠키 주입 실패: {e}')

    # 폴백: 비밀번호 자동 재로그인 (신뢰기기라 2FA 없이 통과 → 쿠키 갱신)
    if _password_relogin(driver, acc, lg):
        return driver

    lg('자동 로그인 실패 — 설정에서 재인증(2FA) 필요')
    try:
        driver.quit()
    except Exception:
        pass
    return None


def _password_relogin(driver, acc, lg):
    """쿠키 만료 시 비번으로 재로그인 (신뢰 프로필이라 2FA 미발생 기대).
    성공 시 쿠키 갱신 저장하고 True. 2FA/Akamai/실패 시 False."""
    from . import coupang_rocket_service as crs
    from selenium.webdriver.common.by import By
    login_id = acc.wing_login_id or acc.cupang_id
    login_pw = crs.decrypt_secret(acc.wing_password_enc) if acc.wing_password_enc else ''
    if not login_pw:
        return False
    try:
        try:
            driver.get('https://wing.coupang.com/')
        except Exception:
            pass
        time.sleep(5)
        if _logged_in(driver):
            _save_cookies(driver, acc)
            return True
        body = _body(driver)
        if 'Access Denied' in body:
            lg('비번 재로그인 — Akamai 차단')
            return False
        if not driver.find_elements(By.ID, 'username'):
            return False
        lg(f'쿠키 만료 → 비번 자동 재로그인: {login_id}')
        u = driver.find_element(By.ID, 'username'); u.click(); time.sleep(0.3); u.send_keys(login_id); time.sleep(0.3)
        p = driver.find_element(By.ID, 'password'); p.click(); time.sleep(0.3); p.send_keys(login_pw); time.sleep(0.3)
        driver.find_element(By.ID, 'kc-login').click()
        time.sleep(8)
        if _logged_in(driver):
            lg('비번 자동 재로그인 성공 — 쿠키 갱신')
            _save_cookies(driver, acc)
            return True
        b2 = _body(driver)
        if _looks_like_otp(b2):
            lg('2FA 요구됨 — 설정에서 수동 인증 필요')
        return False
    except Exception as e:
        lg(f'비번 재로그인 오류: {e}')
        return False
