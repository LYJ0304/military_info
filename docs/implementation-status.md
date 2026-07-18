# 구현 현황과 운영 체크리스트

## 1. 완료된 작업

### 프로젝트 기반

- Next.js 16 App Router
- TypeScript strict 모드
- Tailwind CSS
- NextAuth 카카오 provider 골격
- ESLint, typecheck, build 명령

### PostgreSQL

- Drizzle ORM과 postgres.js 도입
- 초기 migration 생성
- Neon pooled URL을 사용할 수 있는 lazy DB client
- import run, checksum claim, lease lock, menu, daily summary 스키마
- batch upsert와 stale 데이터 정리 repository
- 페이지네이션 조회 repository

### CSV

- OA-9555 전용 POST form source adapter
- timeout 및 파일 크기 제한 downloader
- HTTP 상태와 빈 응답 검증
- SHA-256 체크섬
- UTF-8 BOM과 CP949/EUC-KR 처리
- 필수 컬럼 검증
- quoted field를 지원하는 `csv-parse`
- 날짜의 요일 suffix 제거
- kcal 숫자 변환
- 부분 실패 오류 수집

### Import

- source별 15분 lease lock
- 파일 체크섬 멱등성
- 실패 체크섬 재시도
- 500개 batch upsert
- batch 내 업무 키 중복 제거
- 실행 및 파일 상태 저장
- 완전 성공 시에만 stale 데이터 삭제
- 내부 오류를 노출하지 않는 결과 타입

### API 및 배포

- `GET /api/cron/import-csv`
- `CRON_SECRET` Bearer 인증
- `GET /api/data`
- 페이지네이션과 날짜 필터
- 최근 import 상태 및 마지막 성공 시각
- Vercel Hobby 일 1회 Cron
- 운영 CSV Git 제외
- Neon, Vercel, 커스텀 도메인 문서

## 2. 요구 테스트 대응

| 요구사항 | 테스트 |
| --- | --- |
| 정상 CSV 파싱 | `parser.test.ts` |
| UTF-8 BOM | `parser.test.ts` |
| 필수 컬럼 누락 | `parser.test.ts` |
| quoted comma | `parser.test.ts` |
| 잘못된 날짜·숫자 | `parser.test.ts` |
| 빈 CSV | `parser.test.ts` |
| 동일 체크섬 | `import-menu-csv.test.ts` |
| upsert 멱등성 | `import-menu-csv.test.ts` |
| Cron 인증 누락 | `verify-cron.test.ts`, `cron-route.test.ts` |
| 잘못된 Cron secret | `verify-cron.test.ts` |
| 외부 CSV HTTP 실패 | `downloader.test.ts` |
| DB 실패 상태 변경 | `import-menu-csv.test.ts` |

추가 테스트:

- Content-Type이 잘못된 정상 본문
- 최대 파일 크기 초과
- Cron 동시 실행 409
- Cron 내부 오류 비노출
- 데이터 조회 빈 상태
- 조회 페이지네이션 및 import 메타데이터
- 잘못된 날짜·페이지 파라미터

## 3. 실제 CSV 확인 결과

로컬에서 받은 OA-9555 CSV:

```text
전체 행: 11,531
정상 행: 11,529
오류 행: 2
```

확인된 오류:

- 4,360행 석식열량: `175ml`
- 4,490행 석식열량: `108g`

이 두 행은 제외하고 나머지를 적재하므로 현재 원본의 첫 실행은 `PARTIALLY_COMPLETED`가 될 가능성이 높다.

## 4. 환경변수

Vercel Production에 등록:

```text
DATABASE_URL
CSV_DOWNLOAD_URL
CRON_SECRET
NEXTAUTH_URL
NEXTAUTH_SECRET
KAKAO_CLIENT_ID
KAKAO_CLIENT_SECRET
```

권장 값:

- `DATABASE_URL`: Neon pooled connection string
- `CSV_DOWNLOAD_URL`: `https://opendata.mnd.go.kr/openinf/opencom/down2csv.jsp`
- `CRON_SECRET`: 최소 16자 이상의 무작위 문자열
- `NEXTAUTH_URL`: 커스텀 HTTPS 도메인

## 5. 최초 배포 체크리스트

- [ ] Neon 또는 PostgreSQL 생성
- [ ] Production `DATABASE_URL` 준비
- [ ] `npm run db:migrate` 실행
- [ ] Vercel 환경변수 등록
- [ ] Production 배포
- [ ] `/api/health` 확인
- [ ] Authorization 헤더를 포함해 Cron 수동 실행
- [ ] `import_runs` 상태 확인
- [ ] `/api/data` 결과 확인
- [ ] Vercel Cron Jobs에서 스케줄 확인
- [ ] 커스텀 도메인 DNS 연결
- [ ] `NEXTAUTH_URL`을 커스텀 도메인으로 변경
- [ ] 카카오 운영 Redirect URI 등록

## 6. 아직 실행하지 못한 검증

환경정보가 없으므로 다음 작업은 수행하지 않았다.

- 실제 Neon/운영 PostgreSQL migration 적용
- 실제 DB를 사용한 repository 통합 테스트
- Vercel Production 배포
- Vercel Cron의 실제 자동 호출
- 커스텀 도메인 DNS 연결
- 카카오 운영 OAuth 로그인
- 운영 DB에 전체 CSV 적재

단위 테스트는 repository port를 구현한 fake store를 사용한다. 실제 SQL과 migration의 최종 검증은 배포 전 임시 또는 운영 PostgreSQL에서 수행해야 한다.

## 7. 운영 시 확인할 항목

매일 다음 정보를 확인할 수 있다.

```sql
SELECT
  id,
  status,
  checksum,
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

문제별 확인:

- `FAILED`: Vercel Function 로그와 `error_message`
- 반복 `SKIPPED`: 체크섬이 실제로 변경되지 않았는지 확인
- lock 충돌: `import_locks.locked_until` 확인
- 데이터 없음: migration 및 첫 import 실행 여부 확인
- 계속되는 부분 성공: 원본 오류 샘플 확인

## 8. Git 파일 정책

- 실제 운영 CSV: Git 제외
- 테스트 fixture: `tests/fixtures/*.csv`만 포함
- `.env.local`: Git 제외
- migration SQL: Git 포함
- Drizzle snapshot: Git 포함
- 원본 CSV 보관: 현재 미사용

## 9. 향후 개선 후보

- 실제 PostgreSQL을 사용하는 통합 테스트
- import 실행 이력 관리자 화면
- 실패 행을 별도 테이블에 장기 보관
- 원본 CSV Vercel Blob 저장 adapter
- 데이터 source 다중화
- Cron 실패 알림
- 메뉴 조회 화면 구현 및 카카오 로그인 후 개인화
