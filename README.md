# Military Info

국방부 공공데이터의 병영 식단을 수집하고 활용하는 프로젝트입니다. 현재 `master`에는 다음 두 경로가 구현되어 있습니다.

1. **제9030부대 자동화**: GitHub Actions가 `OA-9561` CSV를 갱신해 Git에 보관하고, 최근 식단을 Notion 데이터베이스에 동기화합니다.
2. **Next.js 식단 서비스**: Vercel Cron이 `OA-9555` CSV를 PostgreSQL에 적재하고 API로 조회할 수 있는 파이프라인을 제공합니다.

상세 설계와 구현 범위는 [아키텍처](docs/architecture.md)와 [구현 현황](docs/implementation-status.md)을 참고하세요.

## 현재 구현 현황

| 영역 | 상태 | 설명 |
| --- | --- | --- |
| 제9030부대 CSV 수집 | 구현 완료 | 국방부 `OA-9561` CSV 다운로드 및 CP949/EUC-KR 처리 |
| GitHub Actions 자동화 | 구현 완료 | 매일 한국시간 06시, 12시, 18시 실행 및 수동 실행 지원 |
| CSV 버전 관리 | 구현 완료 | 내용이 변경된 경우에만 Actions bot이 커밋·푸시 |
| Notion 동기화 | 구현 완료 | 날짜별 페이지 생성·수정, 중복 방지, 속성 자동 구성 |
| Next.js 조회 API | 구현 완료 | PostgreSQL 기반 페이지네이션 및 날짜 필터 |
| Vercel CSV import | 구현 완료 | `OA-9555` 대상 체크섬·lease lock·batch upsert |
| 카카오 로그인 | 기본 골격 구현 | 실제 운영 키와 Redirect URI 설정 필요 |
| 운영 배포 | 환경별 설정 필요 | GitHub Secrets, Notion 공유 권한, DB migration 및 Vercel 변수 필요 |

## 제9030부대 자동화

### 데이터 흐름

```text
GitHub Actions (schedule / workflow_dispatch)
  → 국방부 OA-9561 CSV 다운로드
  → 파일 크기·헤더·날짜·인코딩 검증
  → data/OA-9561_제9030부대_식단정보.csv 갱신
  → 변경된 경우에만 bot commit + push
  → 날짜별 조식·중식·석식·증특식 집계
  → Notion 페이지 조회
  → 없으면 생성, 값이 다르면 수정, 같으면 건너뜀
```

워크플로 파일은 [`.github/workflows/sync-9030-meals.yml`](.github/workflows/sync-9030-meals.yml), 실행 스크립트는 [`scripts/meal-sync.mjs`](scripts/meal-sync.mjs)입니다.

### 실행 일정과 범위

- 예약 실행: 매일 한국시간 `06:00`, `12:00`, `18:00`
- 수동 실행: GitHub의 **Actions → Sync 9030 meals → Run workflow**
- 기본 동기화 범위: 오늘 기준 과거 14일~미래 14일
- 전체 동기화: 수동 실행에서 `full_sync` 선택
- 동시 실행: `sync-9030-meals` concurrency group으로 직렬화
- 제한 시간: 20분

전체 동기화는 CSV의 모든 날짜를 Notion에 조회·생성하므로 최초 실행에만 선택하는 것을 권장합니다.

### GitHub 설정

저장소의 **Settings → Secrets and variables → Actions**에 다음 repository secrets를 등록합니다.

| Secret | 필수 | 설명 |
| --- | --- | --- |
| `NOTION_API_KEY` | 예 | Notion Integration API secret |
| `NOTION_DATABASE_ID` | 조건부 | 대상 Notion Database ID |
| `NOTION_DATA_SOURCE_ID` | 조건부 | 알고 있는 경우 Database ID보다 우선 사용 |

`NOTION_DATABASE_ID`와 `NOTION_DATA_SOURCE_ID` 중 하나는 반드시 필요합니다. 로컬 `.env.local` 값은 GitHub Actions로 자동 전달되지 않으므로 Secrets에 별도로 등록해야 합니다.

CSV 자동 커밋을 사용하려면 **Settings → Actions → General → Workflow permissions**에서 `Read and write permissions`를 허용해야 합니다.

### Notion 설정

1. Notion Integration을 대상 데이터베이스에 연결합니다.
2. 읽기, 콘텐츠 생성, 콘텐츠 수정 권한을 부여합니다.
3. 워크플로를 수동 실행해 연결을 확인합니다.

동기화 스크립트는 데이터베이스의 기존 제목 속성을 자동으로 찾고 아래 속성이 없으면 생성합니다.

| 속성 | 형식 |
| --- | --- |
| 날짜 | Date |
| 부대 | Rich text |
| 조식·중식·석식·증특식 | Rich text |
| 조식·중식·석식·증특식 열량 | Number |
| 총열량 | Number |
| 원본 ID | Rich text |
| 마지막 동기화 | Date |

페이지 제목은 `제9030부대 YYYY-MM-DD` 형식입니다. 이 제목으로 기존 페이지를 검색하기 때문에 같은 날짜를 반복 실행해도 중복 생성되지 않습니다. 같은 제목의 페이지가 둘 이상 발견되면 데이터 손상을 피하기 위해 동기화를 실패 처리합니다.

### 실패 및 재시도

- Notion의 HTTP `429`와 `5xx` 응답은 최대 5회 재시도합니다.
- 국방부 응답이 비어 있거나 10MB를 초과하거나 HTML이면 CSV를 교체하지 않습니다.
- CSV는 임시 파일에 먼저 기록한 뒤 원본 경로로 교체합니다.
- Notion 동기화가 실패해도 앞 단계에서 커밋된 최신 CSV는 보존됩니다.
- 실패 내역은 GitHub Actions run의 단계별 로그에서 확인합니다.

## 로컬 실행

### 요구 사항

- Node.js 22
- npm 10 이상
- PostgreSQL 기능을 사용할 경우 PostgreSQL 또는 Neon

의존성 설치:

```bash
npm ci
```

제9030부대 CSV 갱신:

```bash
npm run data:update:9030
```

Notion 동기화:

```bash
NOTION_API_KEY=secret_xxx \
NOTION_DATABASE_ID=xxxxxxxx \
npm run notion:sync:9030
```

전체 날짜를 동기화하려면 `FULL_SYNC=true`를 추가합니다. 기본 범위는 다음 환경변수로 조절할 수 있습니다.

```text
SYNC_PAST_DAYS=14
SYNC_FUTURE_DAYS=14
```

실제 API 키와 ID는 저장소에 커밋하지 않습니다.

### 검사 명령

```bash
npm run test:sync
npm test
npm run lint
npm run typecheck
npm run build
```

## Next.js 식단 서비스

### 데이터 흐름

```text
Vercel Cron
  → GET /api/cron/import-csv
  → CRON_SECRET 검증
  → 국방부 OA-9555 CSV 다운로드
  → SHA-256 체크섬 및 CSV 검증
  → PostgreSQL batch upsert
  → import 실행 결과 기록
  → GET /api/data에서 조회
```

CSV 원본은 Vercel Function 메모리에서 처리하며 PostgreSQL에는 정규화한 식단과 import 이력만 저장합니다. 이 경로는 제9030부대 GitHub Actions/Notion 자동화와 독립적으로 동작합니다.

### 기술 구성

- Next.js 16 App Router
- React 19
- Drizzle ORM
- PostgreSQL 또는 Neon
- Vercel Functions 및 Vercel Cron
- NextAuth 카카오 OAuth
- Vitest

### 환경변수

`.env.example`을 참고해 `.env.local`을 준비합니다.

```bash
cp .env.example .env.local
```

| 변수 | 사용 경로 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | Next.js/Drizzle | PostgreSQL 연결 문자열, Neon은 pooled URL 권장 |
| `CSV_DOWNLOAD_URL` | Vercel import | 국방부 CSV 변환 endpoint |
| `CRON_SECRET` | Vercel import | Cron Bearer 인증용 secret |
| `NEXTAUTH_URL` | OAuth | 서비스 기준 URL |
| `NEXTAUTH_SECRET` | OAuth | 세션 서명 secret |
| `KAKAO_CLIENT_ID` | OAuth | 카카오 REST API 키 |
| `KAKAO_CLIENT_SECRET` | OAuth | 카카오 Client Secret |
| `NOTION_API_KEY` | Notion sync | Notion Integration secret |
| `NOTION_DATABASE_ID` | Notion sync | 대상 Database ID |
| `NOTION_DATA_SOURCE_ID` | Notion sync | 선택적 Data Source ID |

비밀값에는 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

### 개발 서버와 DB

```bash
npm run db:migrate
npm run dev
```

- 애플리케이션: `http://localhost:3000`
- 상태 확인: `GET /api/health`
- Cron import: `GET /api/cron/import-csv`
- 식단 조회: `GET /api/data`

Cron import 수동 호출:

```bash
curl \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/import-csv
```

식단 조회:

```bash
curl "http://localhost:3000/api/data?page=1&pageSize=30"
curl "http://localhost:3000/api/data?page=1&pageSize=30&date=2026-05-01"
```

`pageSize`는 최대 100이며 `date`는 `YYYY-MM-DD` 형식입니다.

### Import 안전장치

- 원본 SHA-256 체크섬으로 파일 중복 처리 방지
- source별 15분 lease lock으로 동시 실행 방지
- 메뉴 업무 키 기준 메모리 중복 제거
- 500개 단위 PostgreSQL upsert
- 실패 체크섬 재시도 가능
- 완전 성공일 때만 원본에서 사라진 기존 데이터 삭제
- 부분 성공·실패 시 기존 데이터 보존
- 내부 오류와 stack trace를 API 응답에 노출하지 않음

Import 상태는 `COMPLETED`, `PARTIALLY_COMPLETED`, `SKIPPED`, `FAILED`로 기록합니다.

## Vercel 배포

1. PostgreSQL 또는 Neon을 준비합니다.
2. 운영 DB에 `npm run db:migrate`를 실행합니다.
3. Vercel 환경변수에 DB, Cron, OAuth 값을 등록합니다.
4. Production으로 배포합니다.
5. `/api/health`, Cron Jobs, Function 로그를 확인합니다.

`vercel.json`의 Cron은 매일 UTC `00:00`에 `/api/cron/import-csv`를 호출합니다. 이는 한국시간 오전 9시 구간이며 Vercel 플랜에 따라 실제 실행 시각이 지연될 수 있습니다.

## CSV 파일 정책

- `*.csv`는 기본적으로 `.gitignore` 대상입니다.
- 테스트 fixture인 `tests/fixtures/*.csv`는 Git에 포함합니다.
- `data/OA-9561_제9030부대_식단정보.csv`는 GitHub Actions가 갱신하는 운영 예외로 추적합니다.
- 다른 운영 CSV는 별도 요구가 없는 한 Git에 저장하지 않습니다.

## 주요 디렉터리

```text
.github/workflows/             # GitHub Actions
scripts/meal-sync.mjs          # OA-9561 다운로드 및 Notion 동기화
data/                          # 추적 중인 제9030부대 CSV
src/app/api/                   # Next.js Route Handlers
src/lib/csv/                   # CSV 다운로드·검증·파싱
src/lib/import/                # PostgreSQL import orchestration
src/lib/db/                    # Drizzle schema와 repositories
drizzle/                       # DB migrations
tests/                         # Vitest 및 Node test
```

## 관련 문서

- [CSV 수집 아키텍처](docs/architecture.md)
- [구현 현황 및 운영 체크리스트](docs/implementation-status.md)
