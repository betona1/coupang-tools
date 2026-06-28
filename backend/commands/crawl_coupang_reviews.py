"""쿠팡 리뷰 서버 수집 (uc Akamai 우회). 로켓상품 노출ID 전체 또는 지정.
사용: python3 manage.py crawl_coupang_reviews [--product 노출ID] [--all] [--max-pages 40]
"""
from django.core.management.base import BaseCommand
from django.db import connections
from cpc import coupang_review_crawl as rc


class Command(BaseCommand):
    help = '쿠팡 리뷰 서버 수집 → coupang_review'

    def add_arguments(self, parser):
        parser.add_argument('--product', type=str, default=None, help='노출상품ID 1개')
        parser.add_argument('--all', action='store_true', help='활성 로켓상품 전체')
        parser.add_argument('--max-pages', type=int, default=40)

    def handle(self, *args, **o):
        if o['product']:
            pids = [o['product']]
        elif o['all']:
            with connections['default'].cursor() as c:
                c.execute("SELECT DISTINCT seller_product_id FROM cupang_rocket_product "
                          "WHERE seller_product_id<>'' AND is_active=1")
                pids = [str(r[0]) for r in c.fetchall()]
        else:
            self.stderr.write("--product 또는 --all 지정"); return
        self.stdout.write(f"리뷰 수집 시작 — {len(pids)}개 상품")
        r = rc.crawl_reviews(pids, max_pages=o['max_pages'], log_fn=lambda m: self.stdout.write('  ' + m))
        tot = sum(v.get('saved', 0) for v in r.values())
        self.stdout.write(f"완료 — 총 적재 {tot}건")
