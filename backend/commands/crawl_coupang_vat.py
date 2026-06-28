"""쿠팡 Wing 부가세 크롤링 (14개 계정)"""
import os
import sys
from django.core.management.base import BaseCommand


COUPANG_ACCOUNTS = [
    ('betona',   '01비투나'),
    ('bitmind',  '02비트마인드'),
    ('bitcom1',  '03비트컴'),
    ('joys3763', '04조아스'),
    ('bitic05',  '05비트윙'),
    ('nainjoy6', '06나인조이'),
    ('hwss01',   '07행원상사'),
    ('nkcms01',  '08나경커머스'),
    ('erowoo1',  '09이로워'),
    ('elike01',  '10이처럼'),
    ('compwoow', '11캠핑와우'),
    ('bdshouse', '12바둑이하우스'),
    ('exansys',  '13엑사엔시스'),
    ('joacham',  '14조아참'),
]


class Command(BaseCommand):
    help = 'Crawl Coupang Wing VAT data (판매자윙 + 로켓그로스)'

    def add_arguments(self, parser):
        parser.add_argument('--account', type=str, help='특정 계정만 (예: nainjoy6)')
        parser.add_argument('--start', type=str, default='202601', help='Start YYYYMM')
        parser.add_argument('--end', type=str, default='202603', help='End YYYYMM')

    def handle(self, *args, **options):
        gmarket_cpc_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
        if gmarket_cpc_dir not in sys.path:
            sys.path.insert(0, gmarket_cpc_dir)

        from crawlers.coupang_vat import crawl_coupang_vat
        from crawlers.browser import create_xvfb_driver, get_display_env
        from django.db import connections

        start_ym = options['start']
        end_ym = options['end']

        def log_fn(msg, level='info'):
            if level == 'error':
                self.stderr.write(self.style.ERROR(msg))
            elif level == 'success':
                self.stdout.write(self.style.SUCCESS(msg))
            elif level == 'warn':
                self.stdout.write(self.style.WARNING(msg))
            else:
                self.stdout.write(msg)

        # 대상 계정 결정
        if options['account']:
            accounts = [(a, n) for a, n in COUPANG_ACCOUNTS if a == options['account']]
            if not accounts:
                log_fn(f"계정 '{options['account']}' 없음", 'error')
                return
        else:
            accounts = list(COUPANG_ACCOUNTS)

        total_ok = 0
        total_fail = 0

        for login_id, account_name in accounts:
            log_fn(f"\n{'='*60}")
            log_fn(f"  [{login_id}] {account_name} — 쿠팡 Wing 부가세 크롤링")
            log_fn(f"{'='*60}")

            # 비밀번호 조회
            with connections['tax'].cursor() as cur:
                cur.execute(
                    "SELECT login_pw FROM vat_account WHERE market='coupang' AND login_id=%s",
                    [login_id])
                row = cur.fetchone()
            if not row:
                log_fn(f"[{login_id}] 계정 없음 — 스킵", 'error')
                total_fail += 1
                continue

            pw = row[0]
            driver = None
            try:
                driver = create_xvfb_driver()
                driver.set_page_load_timeout(30)
                driver.implicitly_wait(2)
                display_env = get_display_env()

                results = crawl_coupang_vat(
                    driver, login_id, pw, start_ym, end_ym,
                    display_env, log_fn, save_to_db=True)

                wing_count = len(results.get('판매자윙', []))
                rg_count = len(results.get('로켓그로스', []))
                log_fn(f"[{login_id}] 완료: 판매자윙={wing_count}행, 로켓그로스={rg_count}행",
                       'success' if (wing_count + rg_count) > 0 else 'warn')
                total_ok += 1

            except Exception as e:
                log_fn(f"[{login_id}] 실패: {e}", 'error')
                import traceback
                log_fn(traceback.format_exc(), 'error')
                total_fail += 1

            finally:
                if driver:
                    try:
                        driver.quit()
                    except Exception:
                        pass

        log_fn(f"\n{'='*60}")
        log_fn(f"  완료: 성공 {total_ok} / 실패 {total_fail}")
        log_fn(f"{'='*60}")
