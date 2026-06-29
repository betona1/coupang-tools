"""WING 문의/리뷰 → 리뷰 목록 페이지가 호출하는 내부 API 발굴.
로그인 → WING 진입 → 리뷰 route 진입 → performance 네트워크 로그에서 review API 추출.
사용: python3 manage.py discover_wing_review_api --account exansys
"""
import time
import json
from django.core.management.base import BaseCommand
from cpc.models import CoupangApiAccount
from cpc import coupang_wing_auth as cwa


REVIEW_ROUTES = [
    'https://wing.coupang.com/tenants/seller-review-web/reviews',
    'https://wing.coupang.com/tenants/sfl-portal/review/reviewList',
    'https://wing.coupang.com/tenants/seller-rfm/review/list',
    'https://wing.coupang.com/vendor/review',
]


class Command(BaseCommand):
    help = 'WING 리뷰 목록 내부 API 발굴'

    def add_arguments(self, parser):
        parser.add_argument('--account', type=str, default='exansys')

    def handle(self, *args, **o):
        acc = CoupangApiAccount.objects.filter(cupang_id=o['account']).first()
        if not acc:
            self.stderr.write(f"계정 없음: {o['account']}"); return

        def lg(m): self.stdout.write(f'  {m}')
        drv = cwa.login_with_cookies(acc, log_fn=lg)
        if not drv:
            self.stderr.write('WING 로그인 실패'); return
        try:
            drv.execute_cdp_cmd('Network.enable', {})
            drv.get('https://wing.coupang.com/'); time.sleep(4)
            self.stdout.write(f'WING 진입: {drv.current_url[:80]}')
            # Resource Timing API 로 페이지가 부른 모든 URL 수집 (perf 로그 불필요)
            JS = ("return performance.getEntriesByType('resource').map(e=>e.name)"
                  ".concat(performance.getEntriesByType('navigation').map(e=>e.name));")
            apis = set()
            for u in REVIEW_ROUTES:
                try:
                    drv.get(u); time.sleep(8)
                    title = drv.title[:25]
                    res = drv.execute_script(JS) or []
                    self.stdout.write(f'route {u[-45:]} → ({title}) 리소스 {len(res)}개')
                    for url in res:
                        low = url.lower()
                        # 데이터 API 후보: /api·graphql·search·list·page 등 (정적 제외, 현재 route URL 자신 제외)
                        if url.rstrip('/') == u.rstrip('/'):
                            continue
                        if any(k in low for k in ['/api', 'graphql', 'review', 'rating', 'inquiry', '/v1/', '/v2/', 'search', 'list', 'page']) \
                                and not any(x in low for x in ['.js', '.css', '.png', '.svg', '.woff', '.ico', '.gif', '.json.map', 'sentry', 'analytics', 'gtm', 'static']):
                            apis.add(url[:200])
                except Exception as e:
                    self.stdout.write(f'  route err {str(e)[:60]}')
            self.stdout.write('=== 리뷰 API 후보 ===')
            for url in sorted(apis):
                self.stdout.write(f'  {url}')
            if not apis:
                self.stdout.write('  (없음 — route가 실제 리뷰목록이 아닐 수 있음. 마지막 page title: ' + drv.title[:40] + ')')
        finally:
            try: drv.quit()
            except Exception: pass
