"""쿠팡 가구매방(crossbuy) 크롤 → FakePurchaseManual 적재.

가구매방(GAGUMAE_BASE)은 서버에서 직접 접근 가능(Akamai 없음, 로그인 requests).
열린 구매방의 '내 상품' + 배정(designation)을 읽어, **구매완료(purchased=1)** 건을
우리 '쿠팡 가구매(FakePurchaseManual)'에 받는사람·금액·옵션·입금자 정보로 적재한다.

- 노출상품ID(external_product_id) == 우리 로켓상품 seller_product_id → is_rocket + 원가 매칭.
- 로켓이 아니면 원가/구매내역은 추후 대조(여기선 amount만).
"""
import os
import json
import requests
from datetime import datetime
from django.db import connections

def _env(key, default=""):
    """backend/.env 직접 파싱(Django가 임의 키를 os.environ에 안 올림)."""
    v = os.getenv(key)
    if v:
        return v
    p = os.path.join(os.path.dirname(__file__), "..", ".env")
    try:
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, val = line.split("=", 1)
                if k.strip() == key:
                    return val.strip()
    except Exception:
        pass
    return default


BASE = _env("GAGUMAE_BASE", "")
USER = _env("GAGUMAE_USER", "")
PW = _env("GAGUMAE_PW", "")
API = BASE + "/dashboard/crossbuy/api.php?action="


def _session():
    s = requests.Session()
    s.headers.update({"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"})
    r = s.post(BASE + "/dashboard/api/login.php",
               data=json.dumps({"username": USER, "password": PW}), timeout=20)
    d = r.json()
    if not d.get("ok"):
        raise RuntimeError(f"가구매방 로그인 실패: {d}")
    return s


def list_rooms(s):
    """열린/지난 구매방 목록 (index 페이지 파싱)."""
    import re
    html = s.get(BASE + "/dashboard/keyword/index.php", timeout=20).text
    rooms = []
    for m in re.finditer(r"room\.php\?id=(\d+)'[^>]*>.*?(\d{4}-\d{2}-\d{2})\s*맞구매방", html, re.S):
        rid, date = int(m.group(1)), m.group(2)
        if not any(x["id"] == rid for x in rooms):
            rooms.append({"id": rid, "date": date})
    return rooms


def _rocket_cost_map():
    """노출ID → (is_rocket, product_name, unit_cost, bundle, 원가) — 우리 ads DB 로켓상품/원가맵."""
    out = {}
    with connections["default"].cursor() as c:
        c.execute("SELECT seller_product_id, MIN(product_name) FROM cupang_rocket_product "
                  "WHERE seller_product_id<>'' GROUP BY seller_product_id")
        for exp, name in c.fetchall():
            out[str(exp)] = {"is_rocket": True, "product_name": name,
                             "unit_cost": 0, "bundle": 1}
        # 원가맵(있으면) 덮어쓰기
        try:
            c.execute("SELECT exposure_id, unit_cost, bundle_size FROM coupang_product_cost_map")
            for exp, uc, bs in c.fetchall():
                if str(exp) in out:
                    out[str(exp)].update(unit_cost=uc or 0, bundle=bs or 1)
        except Exception:
            pass
    return out


def crawl_room(room_id, only_purchased=True):
    """방 한 개의 내 상품 + 배정을 표준 dict 목록으로 반환."""
    s = _session()
    r = s.get(API + f"my_products&room_id={room_id}", timeout=25)
    prods = r.json().get("products", [])
    rmap = _rocket_cost_map()
    rooms = {x["id"]: x["date"] for x in list_rooms(s)}
    rdate = rooms.get(int(room_id), datetime.now().strftime("%Y-%m-%d"))
    rows = []
    for p in prods:
        exp = str(p.get("external_product_id") or "")
        meta = rmap.get(exp, {"is_rocket": False, "product_name": p.get("product_name"),
                              "unit_cost": 0, "bundle": 1})
        for d in (p.get("designations") or []):
            if only_purchased and not d.get("purchased"):
                continue
            qty = int(d.get("quantity") or 1)
            bundle = meta["bundle"] or 1
            unit = meta["unit_cost"] or 0
            rows.append({
                "purchase_date": rdate,
                "recipient": d.get("buyer_name") or d.get("buyer_username") or "",
                "site_name": "쿠팡가구매방",
                "product_name": f"{p.get('product_name','')[:80]} [{d.get('option_text','')}]".strip(),
                "external_product_id": exp,
                "is_rocket": bool(meta["is_rocket"]),
                "amount": int(d.get("price") or 0),
                "quantity": qty,
                "unit_cost": unit,
                "bundle_count": bundle,
                "product_cost": unit * bundle * qty,
                "shipping": int(d.get("buyer_shipping_fee") or 0),
                "deposit_memo": f"{d.get('buyer_depositor_name','')}/{d.get('buyer_bank','')} {d.get('buyer_account_number','')}".strip(" /"),
                "memo": f"가구매방#{room_id} {d.get('buyer_username','')} 페이백{'O' if d.get('payback_received') else 'X'}",
                "purchased": bool(d.get("purchased")),
            })
    return {"room_id": int(room_id), "date": rdate, "rows": rows}


def import_room(room_id, dry_run=True):
    """방 → FakePurchaseManual 적재. dry_run=True 면 미리보기만."""
    from .models import FakePurchaseManual
    data = crawl_room(room_id, only_purchased=True)
    rows = data["rows"]
    if dry_run:
        return {"dry_run": True, "room_id": data["room_id"], "date": data["date"],
                "count": len(rows), "rows": rows}
    created = 0
    for r in rows:
        # 중복방지: 같은 날짜+받는사람+상품+금액 이미 있으면 스킵
        exists = FakePurchaseManual.objects.filter(
            purchase_date=r["purchase_date"], recipient=r["recipient"],
            product_name=r["product_name"], amount=r["amount"]).exists()
        if exists:
            continue
        FakePurchaseManual.objects.create(
            purchase_date=r["purchase_date"], recipient=r["recipient"],
            site_name=r["site_name"], product_name=r["product_name"],
            is_rocket=r["is_rocket"], amount=r["amount"], quantity=r["quantity"],
            unit_cost=r["unit_cost"], bundle_count=r["bundle_count"],
            product_cost=r["product_cost"], shipping=r["shipping"],
            deposit_memo=r["deposit_memo"], memo=r["memo"])
        created += 1
    return {"dry_run": False, "room_id": data["room_id"], "date": data["date"],
            "imported": created, "skipped": len(rows) - created, "total": len(rows)}
