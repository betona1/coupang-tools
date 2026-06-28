# 설치 & 사용법 (Setup)

모든 비밀정보(DB·API키·아이디·비번)는 **`.env` 와 앱 설정**으로 입력합니다. 코드엔 없습니다.

---

## 1. 설치

```bash
# 백엔드 (Django 앱 gmarket_cpc 내에서 동작)
pip install django djangorestframework undetected-chromedriver selenium \
            beautifulsoup4 requests pymysql openpyxl cryptography

# 데스크톱 리뷰 수집기
pip install PySide6 PySide6-Addons beautifulsoup4 openpyxl pymysql
```

## 2. `.env` 작성 — ① 인프라 비밀정보

`.env.example` 를 `.env` 로 복사 후 채웁니다.

| 항목 | 채울 값 |
|------|---------|
| `DB_*` | 상품/광고/정산 DB(ads) 호스트·아이디·비번 |
| `JOACHAM_DB_*` | 주문/리뷰/가구매 DB(joacham) 호스트·아이디·비번 |
| `FERNET_KEY` | 암호화 키 — 아래 명령으로 1회 생성 |
| `GAGUMAE_*` | 가구매방 URL·아이디·비번 |

```bash
# Fernet 키 생성 (DB에 저장되는 쿠팡 API키/WING비번을 암호화)
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> `.env` 는 `.gitignore` 로 제외되어 **절대 커밋되지 않습니다.**

## 3. 쿠팡 계정 자격증명 입력 — ② 계정별 API키/WING 아이디·비번

쿠팡 **Open API 키**와 **WING 로그인**은 계정마다 다르므로 `.env` 가 아니라
**DB `cupang_api_account` 테이블**에 저장합니다(웹 앱의 ⚙ 계정설정 UI 또는 직접 입력).
저장 시 `FERNET_KEY` 로 자동 암호화됩니다 (`secret_key_enc`, `wing_password_enc`).

| 컬럼 | 입력 |
|------|------|
| `cupang_id` | 계정 식별자(별칭) |
| `vendor_id`, `access_key`, `secret_key` | 쿠팡 Open API 키 ([wing.coupang.com] → API 발급) |
| `wing_login_id`, `wing_password` | WING 로그인 아이디·비번 (광고/정산/리뷰 크롤용) |

- **웹 UI**: 쿠팡 페이지 → ⚙ 계정설정 → 계정 추가 → 키/아이디/비번 입력 → 저장(암호화).
- 입력된 키/비번은 `*_enc`(암호화)로만 저장되고 평문은 어디에도 안 남습니다.

## 4. DB 테이블 (리뷰)

```bash
# 데스크톱/서버 리뷰 수집 전 1회 (joacham DB)
mysql ... < desktop/DB_SCHEMA.sql   # coupang_review 테이블 생성
```

## 5. 사용 — 모듈별 명령은 [MANUAL.md](MANUAL.md) 참조

```bash
python manage.py crawl_coupang_rocket_stock      # 재고
python manage.py sync_coupang_settlement         # 정산
python manage.py crawl_coupang_ads --all         # 광고
python manage.py crawl_coupang_reviews --all     # 리뷰
# 가구매: from cpc import coupang_gagumae_crawl as g; g.import_room(10)
```

데스크톱 리뷰 수집기: `python desktop/coupang_review_gui.py` (또는 `빌드_exe.bat`).

---

## 보안 요약

- **코드에 비밀정보 없음.** API키/WING비번 = DB 암호화(`*_enc`), DB/가구매방 비번 = `.env`.
- `.env`·`webprofile/`·`output/`·쿠키 = `.gitignore` 제외.
- 키·아이디·비번은 위 ②③ 절차로만 입력하세요.
