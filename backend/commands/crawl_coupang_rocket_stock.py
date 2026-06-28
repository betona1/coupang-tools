"""쿠팡 로켓그로스 재고 일별 수집

cron 예: 매일 09:00 / 21:00 실행 → 그날 첫재고/끝재고로 판매량 산출
    python3 manage.py crawl_coupang_rocket_stock
    python3 manage.py crawl_coupang_rocket_stock --account exansys
"""
from django.core.management.base import BaseCommand

from cpc import coupang_rocket_service as crs
from cpc.models import CoupangApiAccount


class Command(BaseCommand):
    help = '쿠팡 로켓그로스 옵션 재고 수집 + 일별 판매량 집계'

    def add_arguments(self, parser):
        parser.add_argument('--account', type=str, default=None,
                            help='특정 cupang_id 만 수집 (미지정 시 전체)')
        parser.add_argument('--rebuild-full', action='store_true',
                            help='API 호출 없이 전 기간 일별 판매/입고 재집계만 수행')

    def handle(self, *args, **opts):
        if opts.get('rebuild_full'):
            d = crs.backfill_deltas()
            n = crs.rebuild_daily_sales()
            self.stdout.write(self.style.SUCCESS(f'전 기간 재집계 완료 — delta {d}건 / 일별 {n}건'))
            return
        account_id = None
        if opts.get('account'):
            try:
                account_id = CoupangApiAccount.objects.get(cupang_id=opts['account']).id
            except CoupangApiAccount.DoesNotExist:
                self.stderr.write(f"계정 없음: {opts['account']}")
                return

        for ev in crs.check_all_products(account_id=account_id):
            if ev.get('t') == 'log':
                self.stdout.write(ev['m'])
            elif ev.get('t') == 'done':
                self.stdout.write(self.style.SUCCESS(
                    f"완료 — 성공 {ev['ok']} / 실패 {ev['fail']} / 전체 {ev['total']}"
                ))
