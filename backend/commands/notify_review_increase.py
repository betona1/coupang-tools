"""리뷰 증가(직전 스냅샷 대비) 텔레그램 알림. 리뷰 일일크롤 직후 cron 권장.
증가 없으면 전송 안 함."""
from django.core.management.base import BaseCommand
from cpc import coupang_rocket_service as crs


class Command(BaseCommand):
    help = '쿠팡 리뷰 증가분 텔레그램 알림'

    def handle(self, *args, **o):
        rep = crs.get_review_report()
        items = rep.get('products') or []
        if not items:
            self.stdout.write('리뷰 증가 없음 — 전송 안 함')
            return
        lines = [f"⭐ [쿠팡] 새 리뷰 +{rep['total_increase']}건 ({rep.get('date','')})", '']
        for it in items[:30]:
            lines.append(f"· {it['product_name']} — +{it['increase']} (총 {it['total']})")
        msg = '\n'.join(lines)
        try:
            from cpc.telegram import send_telegram
            send_telegram(msg)
            self.stdout.write(f"텔레그램 전송 완료 — {rep['total_increase']}건 증가")
        except Exception as e:
            self.stdout.write(f'텔레그램 실패: {e}')
