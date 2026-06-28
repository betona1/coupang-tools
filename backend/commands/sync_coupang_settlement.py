"""쿠팡 정산(지급내역) 동기화 — 최근 3개월 (또는 --month YYYY-MM)

cron 예: 매일 07:00
    python3 manage.py sync_coupang_settlement
"""
from django.core.management.base import BaseCommand

from cpc import coupang_rocket_service as crs


class Command(BaseCommand):
    help = '쿠팡 정산 지급내역 동기화'

    def add_arguments(self, parser):
        parser.add_argument('--month', type=str, default=None, help='YYYY-MM (미지정 시 최근 3개월)')
        parser.add_argument('--account', type=str, default=None, help='특정 cupang_id')

    def handle(self, *args, **opts):
        from cpc.models import CoupangApiAccount
        account_id = None
        if opts.get('account'):
            try:
                account_id = CoupangApiAccount.objects.get(cupang_id=opts['account']).id
            except CoupangApiAccount.DoesNotExist:
                self.stderr.write(f"계정 없음: {opts['account']}")
                return
        for ev in crs.sync_settlements(account_id=account_id, year_month=opts.get('month')):
            if ev.get('t') == 'log':
                self.stdout.write(ev['m'])
            elif ev.get('t') == 'done':
                self.stdout.write(self.style.SUCCESS(f"완료 — {ev['saved']}건 저장"))
