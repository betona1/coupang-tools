"""신설 분리 캠페인(변경이력 product_split)에 광고 데이터가 들어오면 텔레그램 알림.
데이터 들어온 날 1회만 알림(중복방지). cron: 매일 14:40 (광고 자동수집 14:00 직후).
"""
from datetime import date, timedelta
from django.core.management.base import BaseCommand
from cpc.models import CoupangAdChange, CoupangAdCost
from cpc.coupang_rocket_service import get_ad_campaigns


class Command(BaseCommand):
    help = '신설 분리 캠페인에 광고비 집행 시작되면 텔레그램 알림 (1회)'

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=21, help='최근 N일 내 분리된 캠페인 대상')

    def handle(self, *args, **o):
        since = date.today() - timedelta(days=o['days'])
        splits = CoupangAdChange.objects.filter(change_type='product_split', change_date__gte=since)
        # 아직 알림 안 보낸 것만 (memo 끝에 마커)
        targets = [s for s in splits if '[알림완료]' not in (s.memo or '')]
        if not targets:
            self.stdout.write('대상 없음(전부 알림완료 또는 신설 캠페인 없음)')
            return

        # 계정별로 묶어 처리
        by_acc = {}
        for s in targets:
            by_acc.setdefault(s.cupang_id, []).append(s)

        for cupang_id, items in by_acc.items():
            # 최근 24일 캠페인 집계
            frm = date.today() - timedelta(days=24)
            data = get_ad_campaigns(str(frm), str(date.today()), cupang_id)
            camps = {c['campaign_name']: c for c in data['campaigns']}
            arrived = [s for s in items if camps.get(s.campaign_name, {}).get('ad_cost', 0) > 0]
            if not arrived:
                self.stdout.write(f'{cupang_id}: 아직 광고비 0 — 다음 실행 때 재확인')
                continue
            self._notify(cupang_id, arrived, camps)
            # 알림완료 마킹
            for s in arrived:
                CoupangAdChange.objects.filter(pk=s.id).update(memo=(s.memo or '') + ' [알림완료]')

    def _notify(self, cupang_id, arrived, camps):
        from cpc.telegram import send_telegram
        lines = [f'📢 [쿠팡광고] {cupang_id} 신설 캠페인 광고데이터 들어왔습니다!', '']
        for s in arrived:
            c = camps.get(s.campaign_name, {})
            roas = c.get('roas', 0)
            mark = '🟢' if roas >= 300 else ('🟡' if roas >= 100 else '🔴')
            lines.append(f"{mark} {s.campaign_name} — 광고비 ₩{c.get('ad_cost',0):,} / ROAS {roas}% / 상품 {c.get('product_count',0)}")
        # 비교용: 6월본사지원 등 기존 큰 캠페인
        base = max((c for c in camps.values() if c['campaign_name'] not in [s.campaign_name for s in arrived]),
                   key=lambda x: x['ad_cost'], default=None)
        if base:
            lines += ['', f"(기존 {base['campaign_name']}: 광고비 ₩{base['ad_cost']:,} / ROAS {base['roas']}%)"]
        lines += ['', '쿠팡광고 → 캠페인별 탭에서 확인하세요.']
        try:
            send_telegram('\n'.join(lines))
            self.stdout.write(f'{cupang_id}: 텔레그램 전송 완료 ({len(arrived)}개)')
        except Exception as e:
            self.stdout.write(f'{cupang_id}: 텔레그램 실패 {e}')
