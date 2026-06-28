# 쿠팡 통합 운영 도구 — 상세 메뉴얼

> 🔑 비밀정보(API키/아이디/비번)는 코드에 없음 — DB 암호화 필드(`*_enc`) + `.env`(미포함).
> 설치·키 입력법은 **[SETUP.md](SETUP.md)** 참조.

---

## 0. 보안 — 비밀정보 위치 (코드에 노출 안 됨)

| 비밀정보 | 저장 위치 | 비고 |
|---|---|---|
| 쿠팡 Open API access/secret key | DB `cupang_api_account.secret_key_enc` (Fernet 암호화) | 코드엔 없음 |
| WING 로그인 비번 | DB `cupang_api_account.wing_password_enc` (암호화) | 〃 |
| WING 세션 쿠키 | DB `wing_cookies` (암호화) | 자주 만료 |
| 가구매방 로그인 | `backend/.env` `GAGUMAE_USER/PW` | 레포 미포함 |
| DB 접속정보 | `.env` (`.env.example` 참조) | 레포 미포함 |

→ `.gitignore`로 `.env`·`webprofile/`·`output/`·쿠키 전부 제외.

---

## 1. 환경 설정

```bash
# 백엔드 (gmarket_cpc Django 앱 내에서 동작)
pip install django djangorestframework undetected-chromedriver selenium beautifulsoup4 \
            requests pymysql openpyxl cryptography
# .env 작성 (DB 2개: ads=<DB_HOST>, joacham / 가구매방 GAGUMAE_*)

# 데스크톱 리뷰 수집기
pip install PySide6 PySide6-Addons beautifulsoup4 openpyxl pymysql
```

DB: `ads`(로켓상품/광고/정산/계정), `joacham`(주문/리뷰/가구매). 둘 다 <DB_HOST>:3306.

---

## 2. 재고관리 (로켓그로스)

```bash
python manage.py crawl_coupang_rocket_stock     # 재고 폴링 (cron */1)
```
- 옵션ID별 재고 변동 → 감소=판매, 증가=입고. **입고예정(예비입고)** 걸어두면 실재고 오를 때 입고로 자동분류(유령판매 방지).
- 베스트상품: 노출ID 묶음 판매순, **주말형/평일형 판정**(±20%), 30일 일별추이(주말 빨강).

## 3. 정산

```bash
python manage.py sync_coupang_settlement        # cron 07:00
```
- 로켓그로스(WING 실수령) + 마켓플레이스(Open API revenue) 통합. **노출상품ID 기준 매칭.**
- 원가 우선순위: CoupangProductCostMap > 주문공급가 > 사입엑셀(위안화) > importbase.
- 배송비 기본 2620원(부가세포함), 오너클랜배송 상품은 0. 광고비/ROAS/광고후이익 컬럼.

## 4. 광고

```bash
python manage.py crawl_coupang_ads --all        # 정상계정 (cron 13:00)
python manage.py crawl_coupang_ads --account exansys --from 2026-06-01 --to 2026-06-19
python manage.py sync_coupang_vidmap --account exansys   # 옵션ID→노출ID 카탈로그
```
- advertising.coupang.com GraphQL(uc 로그인): getCampaignList + 상품별 보고서.
- 옵션ID→노출ID 환산: 카탈로그(CoupangVidMap) → 매출API → **상품명 토큰매칭**(보수적).
- 캠페인별 집계 + 설정 변경이력(예산변경/상품분리/ON·OFF) 수동기록.
- **계정 상태**: `check_coupang_status`(주1회)로 정상/신규등록제한 분류 → 정상만 자동수집.

## 5. 가구매 (Fake Purchase)

- 가구매방(crossbuy): 로그인 `POST /dashboard/api/login.php` → `crossbuy/api.php?action=my_products&room_id=` → designations.
- **구매완료(purchased=1)** 건 → `FakePurchaseManual`(받는사람·옵션·금액·입금자) 적재.
- 노출상품ID(external_product_id) = 로켓상품 매칭(is_rocket + 원가).
```python
from cpc import coupang_gagumae_crawl as g
g.import_room(room_id=10, dry_run=True)   # 미리보기 후 dry_run=False 적재
```

## 6. 리뷰

```bash
python manage.py crawl_coupang_reviews --all              # 로켓상품 전체
python manage.py crawl_coupang_reviews --product 7828814219
```
- **서버 수집**: undetected_chromedriver(uc)로 Akamai 우회. 상품페이지 1회 로드 → 브라우저 fetch로
  `vp/product/reviews?productId=&page=N` 끝까지 → BS4 파싱 → `coupang_review` UPSERT.
- 모든 리뷰에 고유 review_id(없으면 내용해시) → **재수집해도 중복 0**(멱등).
- **데스크톱 GUI**(`desktop/`): 서버 throttle 시 가정용 IP로 수집(PySide6+QWebEngine).
- 웹 조회: 쿠팡로켓 베스트상품 클릭 → ⭐리뷰 탭(평균별점·분포·목록).

---

## 7. ⚠️ Akamai 차단 (중요)

- 쿠팡 리뷰/상품 API는 Akamai 봇탐지. **curl·일반 Selenium=Access Denied, uc=통과** (IP 아니라 브라우저 지문).
- **대량/잦은 크롤 시 throttle**("서버에서 오류"): 짧은 시간 수백 페이지 → 차단.
- 운영 원칙: 저빈도(주1회), 요청 딜레이(페이지 0.6s/상품 5s), 차단되면 즉시 중단·대기.
- WING(wing.coupang.com)은 셀러 인증 영역이라 차단 덜함 — 리뷰는 WING 관리자 소스가 더 안정적(엔드포인트 발굴: `discover_wing_review_api`).

## 8. 크롤러 인프라

- Xvfb: `crawlers/browser.py _ensure_display()` — 공용 고정 디스플레이 `:99` 재사용(프로세스마다 새로 안 띄움 → leak 방지).
- uc 드라이버: Chrome 버전 매칭 chromedriver(`~/.cache/selenium/.../{ver}/`) 우선. 간헐 SessionNotCreated → cron 재시도.

---

## 9. cron (참고)

```
*/1 * * * *  crawl_coupang_rocket_stock     # 재고
0 7 * * *    sync_coupang_settlement         # 정산
0 13 * * *   crawl_coupang_ads --all         # 광고 (익일12:30 확정 후)
0 13 * * 1   check_coupang_status            # 계정상태 주1회
# 리뷰는 저빈도 수동/주1회 권장 (차단 회피)
```
