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
            for u in REVIEW_ROUTES:
                try:
                    drv.get(u); time.sleep(5)
                    self.stdout.write(f'route {u[-45:]} → {drv.current_url[-55:]}')
                except Exception as e:
                    self.stdout.write(f'  route err {str(e)[:60]}')
            # 네트워크 로그에서 API 추출
            apis = {}
            for e in drv.get_log('performance'):
                try:
                    m = json.loads(e['message'])['message']
                except Exception:
                    continue
                if m.get('method') == 'Network.requestWillBeSent':
                    req = m['params']['request']
                    url = req['url']
                    low = url.lower()
                    if 'coupang' in low and any(k in low for k in ['review', 'rating', 'comment']) \
                            and not any(x in low for x in ['.js', '.css', '.png', '.svg', '.woff', '.ico']):
                        apis[url[:200]] = req.get('method', 'GET')
            self.stdout.write('=== 리뷰 API 후보 ===')
            for url, method in sorted(apis.items()):
                self.stdout.write(f'  [{method}] {url}')
            if not apis:
                self.stdout.write('  (없음 — route 미진입이거나 메뉴 클릭 필요. page title: ' + drv.title[:40] + ')')
        finally:
            try: drv.quit()
            except Exception: pass
