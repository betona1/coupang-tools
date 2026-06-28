from django.core.management.base import BaseCommand
from cpc.models import CoupangApiAccount
from cpc import coupang_rocket_service as crs


class Command(BaseCommand):
    help = '옵션ID→노출상품ID 카탈로그(CoupangVidMap) 구축 — 전 상품 seller-products 순회'

    def add_arguments(self, parser):
        parser.add_argument('--account', type=str, default='exansys')
        parser.add_argument('--max-pages', type=int, default=600)

    def handle(self, *args, **o):
        acc = CoupangApiAccount.objects.filter(cupang_id=o['account']).first()
        if not acc:
            self.stderr.write(f"계정 없음: {o['account']}"); return
        for ev in crs.sync_vid_exposure_map(acc, max_pages=o['max_pages']):
            if ev.get('t') == 'log':
                self.stdout.write(ev['m'])
            elif ev.get('t') == 'done':
                self.stdout.write(f"DONE: {ev}")
