# Military Info

국방부 병영 식단 CSV를 수집하는 프로젝트입니다.

- **제9030부대 (`OA-9561`)**: GitHub Actions로 CSV를 갱신하고 Notion에 동기화합니다.
- **식단 API (`OA-9555`)**: Vercel Cron으로 PostgreSQL에 적재하고 Next.js API로 조회합니다.

## 로컬 실행

Node.js 22와 npm 10 이상이 필요합니다. 식단 API에는 PostgreSQL이 필요합니다.

```bash
npm ci
cp .env.example .env.local
# .env.local에 사용할 기능의 환경변수 설정
npm run db:migrate
npm run dev
```

개발 서버: <http://localhost:3000> · 식단 조회: `GET /api/data`

## 제9030부대 → Notion

[워크플로](.github/workflows/sync-9030-meals.yml)가 매일 한국시간 06:00에 실행됩니다. GitHub Actions Secrets에 `NOTION_API_KEY`와 `NOTION_DATABASE_ID` 또는 `NOTION_DATA_SOURCE_ID`를 등록하고, 대상 데이터베이스에 Notion Integration을 연결해야 합니다. CSV 자동 커밋을 위해 Actions의 `Read and write permissions`도 허용합니다.

기본 동기화 범위는 오늘 기준 ±14일입니다. 전체 날짜를 동기화하려면 **Actions → Sync 9030 meals → Run workflow → full_sync**를 선택합니다.

로컬에서는 Notion 환경변수를 셸에 설정한 뒤 실행합니다.

```bash
npm run data:update:9030
npm run notion:sync:9030
```

## 검사

```bash
npm run test:sync
npm test
npm run lint
npm run typecheck
npm run build
```

## 참고

- [환경변수 예시](.env.example)
- [CSV 수집 아키텍처](docs/architecture.md)
- [구현 현황 및 운영 체크리스트](docs/implementation-status.md)
