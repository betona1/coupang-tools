"""전체 쿠팡 계정 로그인 + 상태(신규등록제한/폐점/정상) 조사 + 쿠키 저장.

login_with_cookies 가 내부에서 _save_cookies→detect_account_status 호출하므로
로그인 성공 시 상태가 자동 저장됨. 실패 시 '로그인실패'로 기록.
"""
import time
from django.core.management.base import BaseCommand
from django.utils import timezone
from cpc.models import CoupangApiAccount
from cpc import coupang_wing_auth as cwa


class Command(BaseCommand):
    help = 'Login all Coupang accounts and detect account status'

    def add_arguments(self, parser):
        parser.add_argument('--only', type=str, default='', help='특정 아이디만 (쉼표구분)')
        parser.add_argument('--delay', type=int, default=4, help='계정 간 딜레이(초)')

    def handle(self, *args, **options):
        qs = CoupangApiAccount.objects.filter(is_active=True).exclude(wing_password_enc='')
        if options['only']:
            ids = [x.strip() for x in options['only'].split(',') if x.strip()]
            qs = qs.filter(cupang_id__in=ids)
        accts = list(qs.order_by('cupang_id'))
        self.stdout.write(f'대상 {len(accts)}개 계정\n')
        for i, acc in enumerate(accts, 1):
            self.stdout.write(f'[{i}/{len(accts)}] {acc.cupang_id} ({acc.account_name}) 로그인...')
            try:
                driver = cwa.login_with_cookies(acc, log_fn=lambda m: self.stdout.write('   ' + m))
                if driver is None:
                    acc.account_status = '로그인실패'
                    acc.status_detail = '쿠키/비번 로그인 실패(2FA 또는 Akamai 또는 비번오류)'
                    acc.status_checked_at = timezone.now()
                    acc.save(update_fields=['account_status', 'status_detail', 'status_checked_at'])
                    self.stdout.write(self.style.ERROR(f'   → 로그인실패'))
                else:
                    # 모든 로그인 경로(쿠키/비번)에서 상태 명시 감지
                    cwa.detect_account_status(driver, acc, log_fn=lambda m: self.stdout.write('   ' + m))
                    acc.refresh_from_db()
                    self.stdout.write(self.style.SUCCESS(f'   → 상태: {acc.account_status} {acc.status_detail}'))
                    try:
                        driver.quit()
                    except Exception:
                        pass
            except Exception as e:
                self.stdout.write(self.style.ERROR(f'   오류: {e}'))
            time.sleep(options['delay'])
        # 요약
        self.stdout.write('\n=== 상태 요약 ===')
        for acc in CoupangApiAccount.objects.order_by('account_status', 'cupang_id'):
            self.stdout.write(f'  {acc.account_status:10} | {acc.account_name} ({acc.cupang_id}) {acc.status_detail}')
