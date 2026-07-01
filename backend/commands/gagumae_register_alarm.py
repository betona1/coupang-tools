"""맞구매 상품등록 알람 — 목요일 12시까지 상품등록(구매자지정) 안 했으면 텔레그램.
열린 방에 내 상품이 0개면 '상품등록해야합니다' 알림. cron: 목요일 오전 몇 번.
"""
from django.core.management.base import BaseCommand
from django.db import connections
from cpc import coupang_gagumae_crawl as g


class Command(BaseCommand):
    help = '맞구매 상품등록 마감(목 12시) 알람'

    def handle(self, *args, **o):
        # 텔레그램 on/off
        with connections['default'].cursor() as c:
            c.execute("SELECT gagumae_telegram FROM fake_purchase_config LIMIT 1")
            row = c.fetchone()
        if row and not row[0]:
            self.stdout.write('텔레그램 꺼짐 — 스킵'); return
        try:
            room = g.get_open_room()
        except Exception as e:
            self.stdout.write(f'접속 실패: {str(e)[:80]}'); return
        if not room:
            self.stdout.write('열린 방 없음 — 스킵'); return
        reg = g.my_products_count(room['id'])
        if reg['products'] > 0:
            self.stdout.write(f"이미 상품 {reg['products']}개 등록됨 — 알람 안 함"); return
        # 미등록 → 알람
        base = g._creds()[0]
        link = f"{base}/dashboard/crossbuy/room.php?id={room['id']}"
        msg = (f"🛒 맞구매 상품등록 해야합니다!\n"
               f"{room['date']} 맞구매방(#{room['id']}) — 아직 상품/구매자지정 안 함.\n"
               f"⏰ 목요일 12시 마감. 지금 등록하세요:\n{link}")
        try:
            from cpc.telegram import send_telegram
            send_telegram(msg)
            self.stdout.write('상품등록 알람 발송')
        except Exception as e:
            self.stdout.write(f'텔레그램 실패: {e}')
