"""입고필요(현재고 < 1달판매 AND 선입고 미등록) 옵션을 텔레그램으로 알림.
cron 매일 1회 권장. 입고필요 없으면 전송 안 함.
"""
from django.core.management.base import BaseCommand
from cpc import coupang_rocket_service as crs


class Command(BaseCommand):
    help = '쿠팡 로켓 입고필요 옵션 텔레그램 알림'

    def handle(self, *args, **o):
        stats = crs.get_dashboard_stats()
        items = stats.get('restock_needed') or []
        if not items:
            self.stdout.write('입고필요 없음 — 전송 안 함')
            return
        lines = [f'📦 [쿠팡로켓] 입고 필요 {len(items)}건 (현재고 < 1달 판매량)', '']
        for it in items[:30]:
            lines.append(f"· {it['product_name']} [{it['option_name']}] — 재고 {it['last_stock']} / 월판매 {it['month_qty']}")
        lines += ['', '선입고(예정) 등록하면 알림에서 빠집니다.']
        msg = '\n'.join(lines)
        try:
            from cpc.telegram import send_telegram
            send_telegram(msg)
            self.stdout.write(f'텔레그램 전송 완료 — {len(items)}건')
        except Exception as e:
            self.stdout.write(f'텔레그램 실패: {e}')
