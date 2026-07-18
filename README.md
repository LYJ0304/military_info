# Military Info

국방부 공개 CSV를 하루 한 번 가져와 PostgreSQL에 적재하고, 최신 병영 식단을 제공하는 Next.js 서비스입니다.
자세한 설계와 구현 현황은 [아키텍처](docs/architecture.md)와 [구현 현황](docs/implementation-status.md) 문서를 참고하세요.


## 데이터 흐름

```text
Vercel Cron
  → GET /api/cron/import-csv
  → CRON_SECRET 검증
  → 국방부 CSV 다운로드
  → SHA-256 체크섬 및 CSV 검증
  → PostgreSQL batch upsert
  → import 실행 결과 기록
  → GET /api/data에서 조회
```

CSV 원본은 Vercel의 로컬 파일 시스템에 저장하지 않습니다. 다운로드한 바이트는 Function 메모리에서 처리하며, 파싱된 데이터와 import 이력만 PostgreSQL에 저장합니다.

## 기술 구성

- Next.js App Router
- Drizzle ORM
- PostgreSQL 또는 Neon
- Vercel Functions 및 Vercel Cron
- Vitest
- NextAuth 카카오 OAuth

별도의 NestJS, FastAPI 또는 상시 실행 서버는 필요하지 않습니다.

## 환경변수

`.env.example`을 복사해 로컬 환경변수를 만듭니다.

```bash
cp .env.example .env.local
```

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | 예 | PostgreSQL 연결 문자열. Neon에서는 pooled URL 권장 |
| `CSV_DOWNLOAD_URL` | 예 | 국방부 CSV 변환 엔드포인트 |
| `CRON_SECRET` | 예 | Cron 인증용 16자 이상의 임의 문자열 |
| `NEXTAUTH_URL` | OAuth 사용 시 | 로컬 또는 운영 서비스 기준 URL |
| `NEXTAUTH_SECRET` | OAuth 사용 시 | NextAuth 세션 서명용 비밀값 |
| `KAKAO_CLIENT_ID` | OAuth 사용 시 | 카카오 REST API 키 |
| `KAKAO_CLIENT_SECRET` | OAuth 사용 시 | 카카오 Client Secret |

비밀값에는 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

로컬 개발용 예시:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
CSV_DOWNLOAD_URL=https://opendata.mnd.go.kr/openinf/opencom/down2csv.jsp
CRON_SECRET=replace-with-a-long-random-secret
```

## 로컬 실행

의존성을 설치하고 migration을 실행합니다.

```bash
npm install
npm run db:migrate
npm run dev
```

`DATABASE_URL`은 migration과 애플리케이션이 모두 사용합니다. Neon을 사용하면 콘솔의 Connect 화면에서 pooled connection string을 복사하는 것을 권장합니다.

개발 서버:

```text
http://localhost:3000
```

상태 확인:

```bash
curl http://localhost:3000/api/health
```

## CSV import 수동 실행

개발 서버가 실행 중인 상태에서 다음 요청을 보냅니다.

```bash
curl \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/import-csv
```

정상 실행 결과에는 run ID, 체크섬, 전체 행 수, 정상 행 수와 실패 행 수가 포함됩니다.

주요 상태:

- `COMPLETED`: 모든 행 처리 성공
- `PARTIALLY_COMPLETED`: 정상 행은 저장했고 일부 잘못된 행은 제외
- `SKIPPED`: 동일 체크섬을 이미 처리했거나 다른 import가 실행 중
- `FAILED`: 다운로드, CSV 또는 DB 처리 실패

인증 헤더가 없거나 잘못되면 `401`을 반환합니다. 서버에 `CRON_SECRET`이 설정되지 않았다면 `500`을 반환합니다.

## 데이터 조회 API

```bash
curl "http://localhost:3000/api/data?page=1&pageSize=30"
curl "http://localhost:3000/api/data?page=1&pageSize=30&date=2026-05-01"
```

쿼리 파라미터:

- `page`: 기본값 1
- `pageSize`: 기본값 30, 최대 100
- `date`: 선택값, `YYYY-MM-DD`

응답에는 다음 정보가 포함됩니다.

- 식단 목록
- 페이지네이션
- 가장 최근 import 상태
- 마지막 성공 import 시각
- 데이터가 없을 경우 빈 배열

## DB migration

스키마를 변경한 후 migration 파일을 생성합니다.

```bash
npm run db:generate
```

생성된 migration을 대상 DB에 적용합니다.

```bash
npm run db:migrate
```

운영 DB migration은 배포 전에 명시적으로 실행합니다. 애플리케이션 시작 시 자동 migration을 실행하지 않습니다.

## 중복 및 재시도

파일 단위 중복:

- 다운로드 원본 바이트의 SHA-256 체크섬 계산
- `import_files(source, checksum)` 복합 PK 사용
- 이미 완료된 체크섬은 다시 적재하지 않고 `SKIPPED` 기록

행 단위 중복:

- CSV 식단을 조식·중식·석식·증특식 단위로 정규화
- `source + mealDate + mealType + menuName + rawCalories` unique key 사용
- PostgreSQL `ON CONFLICT DO UPDATE`로 batch upsert
- 한 batch에 동일 키가 반복되지 않도록 적재 전에 중복 제거

재시도:

- 전체 import를 하나의 긴 트랜잭션으로 묶지 않음
- 500개 단위로 upsert
- 중간 실패 후 같은 체크섬을 다시 실행 가능
- source별 15분 lease lock으로 동시 실행 방지
- 완전 성공일 때만 원본에서 사라진 기존 데이터를 삭제
- 부분 성공 또는 실패 시 기존 데이터를 보존

## Import 이력 확인

실패 원인은 Vercel Function 로그와 `import_runs` 테이블에서 확인합니다.

```sql
SELECT
  id,
  source,
  checksum,
  status,
  total_rows,
  imported_rows,
  failed_rows,
  error_message,
  started_at,
  completed_at
FROM import_runs
ORDER BY started_at DESC
LIMIT 20;
```

파일 처리 상태:

```sql
SELECT source, checksum, status, run_id, completed_at
FROM import_files
ORDER BY created_at DESC
LIMIT 20;
```

DB에는 최대 2,000자의 안전한 오류 요약만 저장하며, API 응답에는 내부 stack trace나 DB 오류를 노출하지 않습니다.

## Vercel 배포

1. Git 저장소를 Vercel 프로젝트로 가져옵니다.
2. Framework Preset이 Next.js인지 확인합니다.
3. Neon 또는 기존 PostgreSQL을 준비합니다.
4. 운영 DB에 `npm run db:migrate`를 실행합니다.
5. Vercel 프로젝트의 Settings → Environment Variables에 변수를 등록합니다.
6. Production 환경으로 배포합니다.
7. 배포 후 Cron Jobs와 Function 로그를 확인합니다.

Vercel에 등록할 운영 변수:

```text
DATABASE_URL
CSV_DOWNLOAD_URL
CRON_SECRET
NEXTAUTH_URL
NEXTAUTH_SECRET
KAKAO_CLIENT_ID
KAKAO_CLIENT_SECRET
```

환경변수를 변경한 후에는 다시 배포해야 적용됩니다.

### Vercel Cron

`vercel.json`에는 다음 스케줄이 설정되어 있습니다.

```text
0 0 * * *
```

Vercel Cron은 UTC 기준입니다. UTC 00:00은 한국시간 오전 9시입니다.

Vercel Hobby 플랜에서는 Cron을 하루 한 번만 실행할 수 있으며, 지정한 시간부터 최대 약 59분 안에 실행될 수 있습니다. 따라서 정확히 한국시간 오전 9시 정각에 실행된다고 가정하면 안 됩니다.

Vercel은 `CRON_SECRET`이 설정되어 있으면 Cron 요청에 다음 헤더를 포함합니다.

```text
Authorization: Bearer <CRON_SECRET>
```

### 커스텀 도메인

1. Vercel 프로젝트의 Settings → Domains에서 개인 도메인을 추가합니다.
2. Vercel 안내에 따라 DNS 레코드를 등록합니다.
3. `NEXTAUTH_URL`을 실제 HTTPS 도메인으로 설정합니다.

예:

```env
NEXTAUTH_URL=https://example.com
```

4. 카카오 개발자 콘솔에 운영 Redirect URI를 추가합니다.

```text
https://example.com/api/auth/callback/kakao
```

Vercel 기본 도메인과 커스텀 도메인을 함께 사용하는 경우, OAuth 기준 도메인을 하나로 정하고 `NEXTAUTH_URL`과 카카오 Redirect URI를 동일하게 유지합니다.

## CSV 파일 관리

운영 중 내려받는 CSV는 Git에 커밋하지 않습니다.

- 루트 및 일반 디렉터리의 `*.csv`는 `.gitignore` 대상
- 테스트용 소형 fixture인 `tests/fixtures/*.csv`만 Git에 포함
- Vercel 로컬 파일 시스템을 영구 저장소로 사용하지 않음
- 임시 파일이 필요하면 `/tmp`만 사용하고 보존을 가정하지 않음
- 현재 구현은 파일을 생성하지 않고 메모리에서 직접 처리

추후 원본 CSV 보관이 필요해지면 downloader 결과를 저장하는 별도 adapter를 추가하고 Vercel Blob 같은 오브젝트 스토리지를 연결할 수 있습니다.

## 데이터 품질 정책

현재 원본 CSV에는 열량 컬럼에 `175ml`, `108g`처럼 kcal가 아닌 값이 존재합니다. 이 행들은 오류로 기록하고 나머지 정상 행을 적재하므로 import 상태는 `PARTIALLY_COMPLETED`가 될 수 있습니다.

부분 성공에서는 기존 데이터를 삭제하지 않아 제공자 오류로 인한 데이터 손실을 방지합니다.

## 검사 명령

```bash
npm test
npm run lint
npm run typecheck
npm run build
```
