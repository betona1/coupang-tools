from datetime import date, timedelta
from django.core.management.base import BaseCommand
from cpc.models import CoupangApiAccount, CrawlerLog
from cpc import coupang_ad_crawl as cac

# 폐쇄/광고미집행 등 자동수집 제외 계정
SKIP = {'nainjoy6'}


class Command(BaseCommand):
    help = '쿠팡 광고센터 상품광고 보고서 수집 → CoupangAdCost. --all 로 전 계정(나인조이 등 제외) 순회.'

    def add_arguments(self, parser):
        parser.add_argument('--account', type=str, default=None)
        parser.add_argument('--from', dest='date_from', type=str, default=None)
        parser.add_argument('--to', dest='date_to', type=str, default=None)
        parser.add_argument('--level', type=str, default='vendorItem')
        parser.add_argument('--all', action='store_true', help='WING 비번보유 전 계정 순회(SKIP 제외)')
        parser.add_argument('--days', type=int, default=3, help='--all 시 어제부터 최근 N일 수집')

    def _log(self, level, msg, cid=''):
        self.stdout.write(msg)
        try:
            CrawlerLog.objects.create(platform='coupang_ad', level=level, message=msg[:1000], account_id=cid or '')
        except Exception:
            pass

    def handle(self, *args, **o):
        if o['all']:
            to = date.today() - timedelta(days=1)
            frm = to - timedelta(days=max(1, o['days']) - 1)
            accs = CoupangApiAccount.objects.exclude(wing_password_enc='').exclude(wing_password_enc__isnull=True)
            # account_status='정상' 계정만 (신규등록제한/폐점/정지/로그인실패 제외). check_coupang_status 가 분류.
            targets = [a for a in accs if a.account_status == '정상' and a.cupang_id not in SKIP]
            skipped = [f'{a.cupang_id}({a.account_status or "미조사"})' for a in accs if a not in targets]
            self._log('info', f'쿠팡 광고 자동수집 시작 — 정상 {len(targets)}계정 [{", ".join(a.cupang_id for a in targets)}] / {frm}~{to} · 제외 {len(skipped)}')
            tot = 0
            import time as _t
            for a in targets:
                r = None
                for attempt in (1, 2):    # Chrome 일시 크래시(session not created 등) 대비 1회 재시도
                    try:
                        r = cac.crawl_ads(a, str(frm), str(to), report_level=o['level'],
                                          log_fn=lambda m: self.stdout.write(f'  [{a.cupang_id}] {m}'))
                        break
                    except Exception as e:
                        if attempt == 2:
                            self._log('error', f'{a.cupang_id}: 예외 {str(e)[:160]}', a.cupang_id)
                        else:
                            self.stdout.write(f'  [{a.cupang_id}] 재시도(크래시): {str(e)[:80]}')
                            _t.sleep(5)
                if r is None:
                    continue
                n = r.get('inserted', 0); cost = r.get('total_ad_cost', 0); res = r.get('resolved', 0)
                tot += cost
                lvl = 'error' if r.get('error') else 'success'
                detail = r.get('error') or f'{n}건 / 광고비 {cost:,} / 노출ID환산 {res}'
                self._log(lvl, f"{a.cupang_id}: {detail}", a.cupang_id)
            self._log('info', f'쿠팡 광고 자동수집 완료 — 총 광고비 {tot:,}')
            return
        # 단일 계정
        acc = CoupangApiAccount.objects.filter(cupang_id=o['account'] or 'exansys').first()
        if not acc:
            self.stderr.write(f"계정 없음: {o['account']}"); return
        r = cac.crawl_ads(acc, o['date_from'], o['date_to'], report_level=o['level'],
                          log_fn=lambda m: self.stdout.write(m))
        self.stdout.write(f"RESULT: {r}")
