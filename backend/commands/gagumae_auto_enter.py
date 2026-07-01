"""치트키 가구매방 자동입장 — 매주 수요일 start_hour부터 retry_min 간격 시도.
성공하면 그만(입장기록), 실패하면 fail_notify_min 마다 텔레그램 알림.
cron: 매분(수 16-23) 실행 → 커맨드가 retry_min/알림간격을 self-throttle (UI에서 설정변경).
"""
from datetime import timedelta, datetime
from django.core.management.base import BaseCommand
from django.db import connections
from cpc import coupang_gagumae_crawl as g


def _cfg():
    with connections['default'].cursor() as c:
        c.execute("SELECT gagumae_auto_enter, gagumae_start_hour, gagumae_retry_min, "
                  "gagumae_fail_notify_min, gagumae_telegram, gagumae_entered_room, "
                  "gagumae_last_notify, gagumae_last_attempt FROM fake_purchase_config LIMIT 1")
        r = c.fetchone()
    if not r:
        return None
    return dict(auto=r[0], start_hour=r[1] or 16, retry_min=r[2] or 5,
                fail_min=r[3] or 30, telegram=r[4], entered=r[5] or 0,
                last_notify=r[6], last_attempt=r[7])


def _set(**kw):
    if not kw:
        return
    cols = ', '.join(f"{k}=%s" for k in kw)
    with connections['default'].cursor() as c:
        c.execute(f"UPDATE fake_purchase_config SET {cols}", list(kw.values()))


def _tg(cfg, msg):
    if not cfg['telegram']:
        return
    try:
        from cpc.telegram import send_telegram
        send_telegram(msg)
    except Exception:
        pass


class Command(BaseCommand):
    help = '치트키 가구매방 자동입장 (수요일 반복시도 + 실패시 주기 알림)'

    def handle(self, *args, **o):
        cfg = _cfg()
        if not cfg or not cfg['auto']:
            self.stdout.write('자동입장 꺼짐/설정없음 — 스킵'); return
        now = datetime.now()
        if now.weekday() != 2:          # 2=수요일만
            return
        if now.hour < cfg['start_hour']:  # 시작시각 전
            return
        # retry_min 스로틀 (마지막 시도 후 retry_min 분 안 지났으면 스킵)
        if cfg['last_attempt']:
            la = cfg['last_attempt']
            if now - la < timedelta(minutes=cfg['retry_min']):
                return
        _set(gagumae_last_attempt=now)

        try:
            room = g.get_open_room()
        except Exception as e:
            room = None
            self.stdout.write(f'접속 실패: {str(e)[:80]}')
        # 이미 입장한 방 → 성공(그만)
        if room and room['id'] == cfg['entered']:
            self.stdout.write(f"방 {room['id']} 이미 입장 — 완료"); return
        # 열린 방 있으면 입장 시도
        if room:
            res = g.enter_room(room['id'])
            if isinstance(res, dict) and res.get('ok') is not False:
                _set(gagumae_entered_room=room['id'])
                self.stdout.write(f"✅ {room['date']} 맞구매방(#{room['id']}) 입장 완료")
                _tg(cfg, f"🎯 [치트키] {room['date']} 맞구매방 자동입장 완료!\n방 #{room['id']} 참여됨 — 상품등록/구매자배정 확인하세요.")
                return
            self.stdout.write(f"입장 실패: {res}")
        # 실패(방 없음 or 입장실패) → fail_notify_min 마다 알림
        send = True
        if cfg['last_notify']:
            ln = cfg['last_notify']
            if now - ln < timedelta(minutes=cfg['fail_min']):
                send = False
        if send:
            _set(gagumae_last_notify=now)
            _tg(cfg, f"⏳ [치트키] {now:%m-%d %H:%M} 아직 맞구매방 입장 못함 (계속 {cfg['retry_min']}분마다 시도중)")
            self.stdout.write('실패 알림 발송')
        else:
            self.stdout.write('열린방 없음 (알림 스로틀)')
