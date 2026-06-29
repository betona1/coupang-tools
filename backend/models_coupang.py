# 쿠팡 관련 모델 (cpc/models.py 추출 — 참조용)
# DB: ads(<DB_HOST>) + joacham

from django.db import models


class CoupangApiAccount(models.Model):
    """쿠팡 WING Open API 계정 (재고조회용 키)"""
    cupang_id = models.CharField(max_length=50, unique=True)   # 쿠팡 계정 식별자 (예: exansys)
    account_name = models.CharField(max_length=100, blank=True, default='')  # 사업자명/별칭 (예: 13엑사엔시스)
    vendor_id = models.CharField(max_length=20)                # vendorId / X-Requested-By (예: A00962985)
    access_key = models.CharField(max_length=100)              # access-key (UUID)
    secret_key_enc = models.TextField()                        # Fernet 암호화된 secret-key
    wing_login_id = models.CharField(max_length=100, blank=True, default='')   # 쿠팡 판매자(WING) 로그인 ID
    wing_password_enc = models.TextField(blank=True, default='')               # Fernet 암호화된 WING 비밀번호
    wing_cookies = models.TextField(blank=True, default='')                    # Fernet 암호화된 세션 쿠키 JSON (쿠키 로그인용)
    wing_authed_at = models.DateTimeField(null=True, blank=True)               # 마지막 WING 인증(쿠키 저장) 시각
    account_status = models.CharField(max_length=30, blank=True, default='미확인')  # 정상/신규등록제한/폐점/로그인실패/미확인
    status_detail = models.CharField(max_length=200, blank=True, default='')   # 상태 상세 메시지
    status_checked_at = models.DateTimeField(null=True, blank=True)            # 상태 확인 시각
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cupang_api_account'
        ordering = ['cupang_id']

class CoupangRocketProduct(models.Model):
    """추적 대상 로켓그로스 옵션 상품 (옵션ID = vendorItemId)"""
    account = models.ForeignKey(CoupangApiAccount, on_delete=models.CASCADE, related_name='products')
    vendor_item_id = models.CharField(max_length=30, unique=True)   # 로켓그로스 옵션ID (재고추적 기본키)
    marketplace_vendor_item_id = models.CharField(max_length=30, blank=True, default='')  # 판매자윙(마켓플레이스) 옵션ID
    seller_product_id = models.CharField(max_length=30, blank=True, default='')  # 노출 상품 ID
    product_name = models.CharField(max_length=500, blank=True, default='')
    option_name = models.CharField(max_length=300, blank=True, default='')   # 옵션명 (색상/수량 등)
    barcode = models.CharField(max_length=100, blank=True, default='')
    image_url = models.CharField(max_length=600, blank=True, default='')     # 쿠팡 CDN 원본 이미지 URL
    image_file = models.CharField(max_length=200, blank=True, default='')    # 로컬 저장 파일명
    image_crawled_at = models.DateTimeField(null=True, blank=True)
    alarm_enabled = models.BooleanField(default=False)        # 품절/재고부족 알람 사용
    alarm_threshold = models.IntegerField(default=10)         # 이 수량 이하면 알람
    alarm_notified = models.BooleanField(default=False)       # 현재 알람 발송됨(중복방지, 회복 시 해제)
    is_active = models.BooleanField(default=True)
    last_price = models.IntegerField(null=True, blank=True)
    last_stock = models.IntegerField(null=True, blank=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cupang_rocket_product'
        ordering = ['-id']

class CoupangInventoryLog(models.Model):
    """재고 조회 로그 (시계열) — 10분 간격 전량 영구보존"""
    vendor_item_id = models.CharField(max_length=30, db_index=True)
    sale_price = models.IntegerField(null=True, blank=True)
    stock = models.IntegerField(null=True, blank=True)
    prev_stock = models.IntegerField(null=True, blank=True)   # 직전 측정 재고
    delta = models.IntegerField(null=True, blank=True)        # 변동량 (+증가 / -판매)
    marked_restock = models.BooleanField(default=False)       # 증가(delta>0) 분류: False=주문취소(기본), True=입고
    checked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cupang_inventory_log'
        indexes = [models.Index(fields=['vendor_item_id', 'checked_at'])]

class CoupangDailySales(models.Model):
    """일별 판매량 (그날 첫재고 - 끝재고)"""
    vendor_item_id = models.CharField(max_length=30, db_index=True)
    date = models.DateField()
    sold_quantity = models.IntegerField(default=0)        # 구간 감소분 합 (판매)
    restock_quantity = models.IntegerField(default=0)     # 구간 증가분 합 (입고 보정)
    first_stock = models.IntegerField(null=True, blank=True)   # 그날 첫(가장 이른) 재고
    last_stock = models.IntegerField(null=True, blank=True)    # 그날 끝(가장 늦은) 재고
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cupang_daily_sales'
        unique_together = ('vendor_item_id', 'date')
        ordering = ['-date']

class FakePurchaseMark(models.Model):
    """일반 주문(orders_order)을 '가구매'로 지정 + 원가 보정.
    order_code = orders_order.order_unique_code"""
    order_code = models.CharField(max_length=100, unique=True)
    is_fake = models.BooleanField(default=True)
    adjusted_cost = models.IntegerField(null=True, blank=True)   # 손실원가 수동보정(미지정 시 자동계산)
    # 가구매 정산 내역 스냅샷 (지정 시점에 주문에서 가져옴)
    receiver_name = models.CharField(max_length=100, blank=True, default='')
    product_name = models.CharField(max_length=255, blank=True, default='')
    site_name = models.CharField(max_length=100, blank=True, default='')
    quantity = models.IntegerField(null=True, blank=True)
    settlement_price = models.IntegerField(null=True, blank=True)   # 정산가
    purchase_price = models.IntegerField(null=True, blank=True)     # 고객 구입가(돌려줄 금액)
    fee = models.IntegerField(null=True, blank=True)               # 수수료 = 구입가 - 정산가
    shipping_price = models.IntegerField(null=True, blank=True)    # 배송비
    product_cost = models.IntegerField(null=True, blank=True)      # 원가 = 사입단가 × 구성수량
    unit_cost = models.IntegerField(null=True, blank=True)         # 사입 단가(개당)
    bundle_count = models.IntegerField(default=1)                  # 구성품 수량
    transferred = models.BooleanField(default=False)              # 구입가 이체완료
    transferred_at = models.DateTimeField(null=True, blank=True)  # 이체완료 시각
    order_date = models.DateField(null=True, blank=True)
    memo = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'fake_purchase_mark'
        ordering = ['-order_date', '-id']

class FakePurchaseManual(models.Model):
    """수동 가구매 입력 (내가 남에게 사준 건 등 — 통장입금내역 대조용)"""
    purchase_date = models.DateField()
    recipient = models.CharField(max_length=100, blank=True, default='')   # 받는사람/이름
    site_name = models.CharField(max_length=100, blank=True, default='')
    product_name = models.CharField(max_length=255, blank=True, default='')
    is_rocket = models.BooleanField(default=False)                          # 로켓(로켓그로스) 상품 구매
    amount = models.IntegerField(default=0)                                  # 구매금액(구입가)
    product_cost = models.IntegerField(default=0)                            # 제품원가 = 단가×구성×수량
    unit_cost = models.IntegerField(default=0)                               # 사입 단가(개당)
    bundle_count = models.IntegerField(default=1)                            # 구성수량
    quantity = models.IntegerField(default=1)                                # 주문수량
    fee = models.IntegerField(default=0)                                     # 수수료 — 로켓 영업비용(90일 무료=0)
    shipping = models.IntegerField(default=2640)                             # 배송비 — 로켓 영업비용
    deposit_memo = models.CharField(max_length=255, blank=True, default='')  # 통장입력내역 메모
    memo = models.CharField(max_length=255, blank=True, default='')
    transferred = models.BooleanField(default=False)                         # 이체완료
    transferred_at = models.DateTimeField(null=True, blank=True)             # 이체완료 시각
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'fake_purchase_manual'
        ordering = ['-purchase_date', '-id']

class FakePurchaseConfig(models.Model):
    """가구매 전역 설정 (싱글톤). 기본 배송비 등."""
    default_shipping_cost = models.IntegerField(default=2640)   # CJ 기본 배송비
    packaging_cost = models.IntegerField(default=100)          # 기본 포장비
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'fake_purchase_config'

class CoupangRestock(models.Model):
    """입고(재입고) 이력. source=manual(수동)/coupang(자동, 추후).
    추후 쿠팡 입고 API 연동 시 자동 insert 예정."""
    vendor_item_id = models.CharField(max_length=30, db_index=True)
    restock_date = models.DateField()
    quantity = models.IntegerField()
    source = models.CharField(max_length=10, default='manual')
    memo = models.CharField(max_length=200, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cupang_restock'
        ordering = ['-restock_date', '-id']

class CoupangExpectedRestock(models.Model):
    """입고 예정 — 예정수량 등록 후, 윈도우(기본 7일) 내에 재고가 예정수량에
    근접(조금 작게)하게 증가하면 그 증가 이벤트를 '입고'로 자동 분류하고 실제 입고일시 기록."""
    vendor_item_id = models.CharField(max_length=30, db_index=True)
    expected_quantity = models.IntegerField()                 # 입고 예정 수량
    window_days = models.IntegerField(default=7)              # 매칭 허용 기간(일)
    status = models.CharField(max_length=10, default='pending')  # pending/matched/expired
    matched_at = models.DateTimeField(null=True, blank=True)     # 실제 입고 일시(매칭된 증가 이벤트 시각)
    matched_qty = models.IntegerField(null=True, blank=True)     # 실제 증가 수량
    matched_log_id = models.BigIntegerField(null=True, blank=True)
    memo = models.CharField(max_length=200, blank=True, default='')
    registered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cupang_expected_restock'
        ordering = ['-registered_at']

class CoupangSettlement(models.Model):
    """쿠팡 주차별 지급(정산) 내역 — settlement-histories API"""
    account = models.ForeignKey(CoupangApiAccount, on_delete=models.CASCADE, related_name='settlements')
    settlement_type = models.CharField(max_length=20)          # WEEKLY / RESERVE
    settlement_date = models.DateField()                       # 정산일(지급일)
    revenue_ym = models.CharField(max_length=7)                # 매출인식월 2026-05
    recognition_from = models.DateField(null=True, blank=True)
    recognition_to = models.DateField(null=True, blank=True)
    total_sale = models.IntegerField(default=0)                # 총매출
    service_fee = models.IntegerField(default=0)               # 판매수수료
    settlement_target = models.IntegerField(default=0)         # 정산대상금액
    settlement_amount = models.IntegerField(default=0)         # 정산금액
    last_amount = models.IntegerField(default=0)               # 차주지급 보류분
    deduction_amount = models.IntegerField(default=0)          # 공제
    seller_service_fee = models.IntegerField(default=0)
    seller_discount_coupon = models.IntegerField(default=0)
    downloadable_coupon = models.IntegerField(default=0)
    store_fee_discount = models.IntegerField(default=0)
    debt_of_last_week = models.IntegerField(default=0)
    final_amount = models.IntegerField(default=0)              # 최종 지급액
    bank_name = models.CharField(max_length=50, blank=True, default='')
    bank_account = models.CharField(max_length=50, blank=True, default='')
    bank_holder = models.CharField(max_length=100, blank=True, default='')
    status = models.CharField(max_length=20, blank=True, default='')  # DONE/SUBJECT
    raw = models.JSONField(null=True, blank=True)              # 원본 전체
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cupang_settlement'
        unique_together = ('account', 'settlement_date', 'recognition_from', 'settlement_type')
        ordering = ['-settlement_date']

class CoupangRocketSettlement(models.Model):
    """로켓그로스 정산현황 (WING status-new 주별 정산 리포트, 크롤링)"""
    account = models.ForeignKey(CoupangApiAccount, on_delete=models.CASCADE, related_name='rocket_settlements')
    settlement_date = models.DateField(null=True, blank=True)        # 정산일(지급일)
    settlement_type = models.CharField(max_length=20, blank=True, default='')  # 주별/추가지급 등
    pay_ratio = models.IntegerField(null=True, blank=True)           # 지급비율 (70 등)
    recognition_from = models.DateField(null=True, blank=True)       # 매출인식 시작
    recognition_to = models.DateField(null=True, blank=True)         # 매출인식 끝
    final_amount = models.BigIntegerField(default=0)                 # 최종지급액 (H-I-J+K)
    # ── 상세 항목 (상세보기) ──
    gross_sale = models.BigIntegerField(default=0)        # 판매액 (a)
    cancel_amount = models.BigIntegerField(default=0)     # 취소액
    revenue_a = models.BigIntegerField(default=0)         # 매출금액 (A)
    commission_b = models.BigIntegerField(default=0)      # 판매수수료 (B)
    coupon_c = models.BigIntegerField(default=0)          # 상계금액 (C, 할인쿠폰)
    base_revenue_d = models.BigIntegerField(default=0)    # 판매기준 매출액 (D=A-B-C)
    payment_h = models.BigIntegerField(default=0)         # 지급액 (H, 정산대상액의 지급비율%)
    add_offset_i = models.BigIntegerField(default=0)      # 추가 상계금액 (I)
    fulfillment_j = models.BigIntegerField(default=0)     # 쿠팡 풀필먼트서비스 비용 (J)
    inventory_k = models.BigIntegerField(default=0)       # 재고 손실 보상 (K)
    # 풀필먼트 세부
    ff_inout = models.BigIntegerField(default=0)          # 입출고비
    ff_shipping = models.BigIntegerField(default=0)       # 배송비
    ff_storage = models.BigIntegerField(default=0)        # 보관비
    ff_return = models.BigIntegerField(default=0)         # 반품 회수비
    ff_restock = models.BigIntegerField(default=0)        # 반품 재입고비
    ff_outbound = models.BigIntegerField(default=0)       # 반출 배송 서비스비
    detail_raw = models.TextField(blank=True, default='') # 상세 원문(파싱 보정용)
    has_detail = models.BooleanField(default=False)       # 상세 파싱 완료 여부
    raw = models.JSONField(null=True, blank=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cupang_rocket_settlement'
        unique_together = ('account', 'settlement_date', 'settlement_type', 'recognition_from')
        ordering = ['-settlement_date']

class CoupangPriceChange(models.Model):
    """가격 변동 이력 (판매가가 바뀐 순간만 기록)"""
    vendor_item_id = models.CharField(max_length=30, db_index=True)
    old_price = models.IntegerField(null=True, blank=True)
    new_price = models.IntegerField(null=True, blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cupang_price_change'
        ordering = ['-changed_at']

class CoupangRocketConfig(models.Model):
    """쿠팡로켓 전역 설정 (싱글톤)"""
    check_interval_min = models.IntegerField(default=10)   # 자동점검 주기(분): 5/10/15/20/30
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cupang_rocket_config'

class CoupangProductCostMap(models.Model):
    """쿠팡 상품 원가/번들 매핑 — 상품별 정산 원가 정확화.
    importbase 자동매칭이 안 되거나 번들(봉다리) 단위가 다른 상품의 원가를 데이터로 보정.
    원가 = unit_cost × bundle_size × 판매수량.
    매칭키: 노출상품ID(exposure_id) 우선, 없으면 product_seller_code(S코드)."""
    exposure_id = models.CharField(max_length=50, blank=True, default='', db_index=True)   # 노출상품ID(=주문DB product_code)
    product_seller_code = models.CharField(max_length=80, blank=True, default='', db_index=True)  # S코드(보조 매칭키)
    product_name = models.CharField(max_length=300, blank=True, default='')   # 참고용 상품명
    unit_cost = models.IntegerField(default=0)        # 개당 원가
    bundle_size = models.IntegerField(default=1)      # 1판매단위당 개수(봉다리 묶음수량)
    ship_excluded = models.BooleanField(default=False)  # 배송비 미부담(우리가 안 보냄/합배송/공급사발송) → 배송비 0
    importbase_name = models.CharField(max_length=200, blank=True, default='')  # importbase 매칭명(참고)
    memo = models.CharField(max_length=200, blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'coupang_product_cost_map'

class CoupangAdCost(models.Model):
    """쿠팡 광고비 (WING 광고관리 리포트 — 옵션ID/노출상품ID별 일별).
    쿠팡 구조: 판매자윙상품ID/로켓ID/로켓반품옵션ID 등 옵션ID는 계속 새로 생기지만
    노출상품ID(exposure_id)가 같으면 같은 상품 → 집계는 노출상품ID 기준."""
    cupang_id = models.CharField(max_length=50, db_index=True)
    ad_date = models.DateField(db_index=True)
    exposure_id = models.CharField(max_length=50, blank=True, default='', db_index=True)  # 노출상품ID(주 매칭키)
    vendor_item_id = models.CharField(max_length=50, blank=True, default='')              # 옵션ID(윙/로켓/반품 등)
    campaign_name = models.CharField(max_length=200, blank=True, default='')
    ad_type = models.CharField(max_length=30, blank=True, default='')      # 수동/매니지드 등
    product_name = models.CharField(max_length=300, blank=True, default='')
    impressions = models.IntegerField(default=0)        # 노출수
    clicks = models.IntegerField(default=0)             # 클릭수
    ad_cost = models.IntegerField(default=0)            # 광고비(집행)
    ad_orders = models.IntegerField(default=0)          # 광고 전환 판매수
    ad_sales = models.IntegerField(default=0)           # 광고 전환매출
    source = models.CharField(max_length=20, default='excel')  # excel / wing
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'coupang_ad_cost'
        indexes = [models.Index(fields=['cupang_id', 'ad_date']),
                   models.Index(fields=['exposure_id', 'ad_date'])]

class CoupangAdChange(models.Model):
    """쿠팡 광고 설정 변경 이력 (수동 기록). 예산변경/상품별 광고시작·분리/ON·OFF·기타.
    쿠팡은 예산을 API로 못 바꾸므로 변경은 광고센터에서 직접 하고 그 내역을 여기 기록."""
    CHANGE_TYPES = [
        ('budget', '예산변경'),
        ('product_split', '상품별 광고시작/분리'),
        ('onoff', '캠페인 ON/OFF'),
        ('etc', '기타'),
    ]
    cupang_id = models.CharField(max_length=50, db_index=True)
    change_date = models.DateField(db_index=True)                       # 변경(설정)한 날짜
    change_type = models.CharField(max_length=20, default='etc')
    campaign_name = models.CharField(max_length=200, blank=True, default='')
    budget_before = models.IntegerField(null=True, blank=True)          # 변경 전 예산
    budget_after = models.IntegerField(null=True, blank=True)           # 변경 후 예산
    products = models.JSONField(default=list, blank=True)               # 관련 상품 [{name, exposure_id}]
    memo = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'coupang_ad_change'
        ordering = ['-change_date', '-id']

class CoupangVidMap(models.Model):
    """옵션ID → 노출상품ID 카탈로그 캐시 (전 상품 seller-products 목록+상세 1회 순회로 구축).
    광고보고서엔 옵션ID만 있어 노출ID 매칭에 사용. 윙/로켓 옵션ID 모두 같은 노출ID로 매핑."""
    vendor_item_id = models.CharField(max_length=50, unique=True)   # 옵션ID(윙 mp_vid 또는 로켓 rg_vid)
    exposure_id = models.CharField(max_length=50, db_index=True)    # 노출상품ID(productId)
    seller_product_id = models.CharField(max_length=50, blank=True, default='')
    cupang_id = models.CharField(max_length=50, blank=True, default='', db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'coupang_vid_map'


# ── 지마켓 분산 작업큐 (판매중지/삭제/수집 — work-stealing) ──
