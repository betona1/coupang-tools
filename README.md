# 쿠팡 통합 운영 도구 (Coupang Tools)

쿠팡(로켓그로스/마켓플레이스) 셀러 운영 자동화 모듈 모음 — **정산·재고관리·광고·가구매·리뷰**.
Django REST + React 앱(gmarket_cpc)에서 쿠팡 관련 모듈만 모은 것 + 데스크톱 리뷰 수집기.

> 🔑 **모든 비밀정보(DB·API키·아이디·비번)는 `.env`로 입력** — 코드엔 없음. 설정법: **[docs/SETUP.md](docs/SETUP.md)**.
> 시작: `.env.example` 복사 → `.env` 작성 → 모듈 사용.

---

## 📦 모듈 구성

### 1. 쿠팡 재고관리 (로켓그로스)
- `backend/services/coupang_rocket_service.py` — 핵심. 재고추적(1분 폴링)·일별판매·입고예정·베스트상품·대시보드 통계.
- `backend/commands/crawl_coupang_rocket_stock.py` — 재고 폴링 (cron 1분).
- 옵션ID(rgVid) 기준 재고 변동 → 판매/입고 자동 분류. 입고예정(예비입고)으로 유령판매 방지.
- 프론트: `frontend/pages/CoupangRocketPage.tsx` — 상품/옵션 재고·베스트(주말평일 판정)·시간대 패턴·30일 추이·리뷰 모달.

### 2. 쿠팡 정산 (Settlement)
- `backend/services/coupang_rocket_settlement.py` + rocket_service 내 정산 함수.
- `backend/commands/sync_coupang_settlement.py` — 정산 동기화 (cron).
- 로켓그로스(WING) + 마켓플레이스(Open API) 통합. 상품별/옵션별 대조, 노출상품ID 기준 매칭.
- 원가: 사입엑셀(위안화)·importbase·CoupangProductCostMap. 배송비/오너클랜배송 처리.
- 프론트: `frontend/pages/CoupangSettlementPage.tsx` — 통합정산/상품별/광고효율/옵션대조 탭.

### 3. 쿠팡 광고 (Ads)
- `backend/services/coupang_ad_crawl.py` — advertising.coupang.com GraphQL 크롤(uc 로그인).
- `backend/commands/crawl_coupang_ads.py` — 정상계정 자동수집 (cron 13:00).
- 캠페인별 광고비/ROAS, 옵션ID→노출ID 환산(카탈로그+상품명매칭), 설정 변경이력.
- 프론트: `frontend/pages/CoupangAdsPage.tsx` — 캠페인별/상품별/변경이력 탭.

### 4. 쿠팡 가구매 (Fake Purchase)
- `backend/services/coupang_gagumae_crawl.py` — 가구매방(crossbuy) 크롤 → FakePurchaseManual 적재.
- 구매완료 designation(받는사람·옵션·금액·입금자) → 통장입금 대조용 가구매 입력.
- 노출상품ID(external_product_id) = 로켓상품 매칭.

### 5. 쿠팡 리뷰 (Reviews)
- `backend/services/coupang_review_crawl.py` — **서버 수집** (undetected_chromedriver로 Akamai 우회).
- `backend/commands/crawl_coupang_reviews.py` — 로켓상품 전체/지정 리뷰 수집.
- `desktop/` — **데스크톱 GUI**(PySide6+QWebEngine, 가정용 IP). 서버 throttle 시 대안.
- 평균별점·별점분포·목록. DB `coupang_review`(joacham). 리뷰 UI는 쿠팡로켓 베스트상품 모달 ⭐리뷰 탭.

### 6. 공통 인프라
- `backend/services/coupang_wing_auth.py` — WING 로그인(uc, 프로필+쿠키, OTP/SMS, 상태감지).
- `backend/services/coupang_image_service.py` — 상품이미지 CDN 다운로드.
- `backend/commands/check_coupang_status.py` — 계정 상태분류(정상/신규등록제한/폐점).
- `backend/commands/sync_coupang_vidmap.py` — 옵션ID→노출ID 카탈로그.
- `backend/commands/discover_wing_review_api.py` — WING 리뷰 API 발굴.
- `backend/models_coupang.py` — 쿠팡 모델 17종(참조).

---

## 🔑 핵심 개념

| 용어 | 설명 |
|------|------|
| **노출상품ID** (displayedProductId / seller_product_id / external_product_id) | 상품 식별 주키. `coupang.com/vp/products/{이것}`. 옵션ID 무관 동일상품 = 동일 노출ID. 정산·리뷰·가구매 매칭 기준. |
| **옵션ID** (vendorItemId / rgVid·mpVid) | 윙/로켓/반품마다 새로 생성. 재고추적 기본키. |
| **Akamai 우회** | curl·일반 Selenium=Access Denied. **undetected_chromedriver(uc)=통과**. IP 아니라 브라우저 지문 문제. |

자세한 사용법·스키마·운영 주의는 **[docs/MANUAL.md](docs/MANUAL.md)**.
