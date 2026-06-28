"""쿠팡 2차인증(문자) 페이지 구조 캡처 — 인증요청 버튼/입력칸/텍스트 덤프.

쿠키 비우고 비번 로그인 → 2FA 화면 도달 시 구조 덤프 + 스크린샷.
OTP 자동제출은 안 함(페이지 파악 전용).
"""
import os
import shutil
import time
from django.core.management.base import BaseCommand
from cpc.models import CoupangApiAccount
from cpc import coupang_wing_auth as cwa


class Command(BaseCommand):
    help = 'Capture Coupang 2FA(SMS) page structure'

    def add_arguments(self, parser):
        parser.add_argument('--login', type=str, default='betona')
        parser.add_argument('--keep-cookies', action='store_true', help='쿠키 유지(2FA 강제 안 함)')

    def handle(self, *args, **options):
        from selenium.webdriver.common.by import By
        acc = CoupangApiAccount.objects.get(cupang_id=options['login'])

        def w(m):
            self.stdout.write(m); self.stdout.flush()

        # 쿠키/프로필 비워 강제 비번 로그인
        if not options['keep_cookies']:
            acc.wing_cookies = ''
            acc.save(update_fields=['wing_cookies'])
            prof = os.path.join(cwa.PROFILE_BASE, f'coupang_{acc.cupang_id}')
            if os.path.isdir(prof):
                shutil.rmtree(prof, ignore_errors=True)
            w(f'쿠키/프로필 초기화: {acc.cupang_id}')

        from cpc import coupang_rocket_service as crs
        login_id = acc.wing_login_id or acc.cupang_id
        login_pw = crs.decrypt_secret(acc.wing_password_enc)
        prof = os.path.join(cwa.PROFILE_BASE, f'coupang_{acc.cupang_id}')
        os.makedirs(prof, exist_ok=True)
        driver = cwa._make_uc_driver(prof)
        try:
            driver.set_page_load_timeout(45)
            w('wing 접속...')
            try:
                driver.get('https://wing.coupang.com/')
            except Exception:
                pass
            time.sleep(6)
            if 'xauth' not in driver.current_url and 'wing.coupang.com' in driver.current_url:
                w('이미 로그인됨(2FA 없음). --keep-cookies 빼고 재시도하거나 세션 만료 대기.')
                return
            body = driver.find_element(By.TAG_NAME, 'body').text
            if 'Access Denied' in body:
                w('❌ Akamai 차단 — 잠시 후 재시도'); return
            if not driver.find_elements(By.ID, 'username'):
                w(f'로그인 폼 없음 url={driver.current_url[:70]}'); return
            w(f'로그인 입력: {login_id}')
            u = driver.find_element(By.ID, 'username'); u.click(); time.sleep(.3); u.send_keys(login_id); time.sleep(.3)
            p = driver.find_element(By.ID, 'password'); p.click(); time.sleep(.3); p.send_keys(login_pw); time.sleep(.3)
            driver.find_element(By.ID, 'kc-login').click()
            time.sleep(8)
            url = driver.current_url
            body = driver.find_element(By.TAG_NAME, 'body').text
            w(f'\n제출 후 url: {url[:90]}')
            if 'Access Denied' in body:
                w('❌ Akamai 차단(제출 단계)'); return
            if 'wing.coupang.com' in url and 'xauth' not in url:
                w('✅ 로그인 성공 (2FA 없음)'); return
            if any(k in body for k in ('비밀번호가 다릅', '일치하지', '아이디 또는')):
                w('❌ 아이디/비밀번호 불일치'); return

            try:
                driver.save_screenshot('/tmp/cps_2fa.png'); w('스크린샷: /tmp/cps_2fa.png')
            except Exception:
                pass

            w('\n=== [2FA 추정 화면] body text ===')
            for line in body.split('\n'):
                s = line.strip()
                if s:
                    w('  | ' + s[:80])

            w('\n=== 버튼 (인증요청/발송 후보) ===')
            for b in driver.find_elements(By.TAG_NAME, 'button'):
                try:
                    t = (b.text or '').strip()
                    if t and b.is_displayed():
                        w(f'  <button> "{t[:30]}" id={b.get_attribute("id")} class={(b.get_attribute("class") or "")[:30]}')
                except Exception:
                    continue
            w('=== a/링크 (인증수단 선택 등) ===')
            for a in driver.find_elements(By.TAG_NAME, 'a'):
                try:
                    t = (a.text or '').strip()
                    if t and a.is_displayed() and len(t) < 25:
                        w(f'  <a> "{t}" id={a.get_attribute("id")}')
                except Exception:
                    continue
            w('=== input (OTP 입력칸 후보) ===')
            for el in driver.find_elements(By.TAG_NAME, 'input'):
                try:
                    if el.is_displayed():
                        w(f'  <input type={el.get_attribute("type")} id={el.get_attribute("id")} '
                          f'name={el.get_attribute("name")} ph={el.get_attribute("placeholder")}>')
                except Exception:
                    continue
            w('=== select (인증수단/번호 선택?) ===')
            for s in driver.find_elements(By.TAG_NAME, 'select'):
                opts = [o.text.strip() for o in s.find_elements(By.TAG_NAME, 'option')][:6]
                w(f'  <select id={s.get_attribute("id")}> {opts}')
        finally:
            try:
                driver.quit()
            except Exception:
                pass
