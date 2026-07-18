# Military Info

외부 OpenAPI 정보를 조회하고 카카오 OAuth로 로그인하는 Next.js 서비스입니다.

## 시작하기

```bash
cp .env.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 환경변수

- `NEXTAUTH_SECRET`: `openssl rand -base64 32` 등으로 생성한 임의 문자열
- `KAKAO_CLIENT_ID`: 카카오 REST API 키
- `KAKAO_CLIENT_SECRET`: 카카오 Client Secret
- `OPENAPI_BASE_URL`: 연동할 OpenAPI 기본 URL
- `OPENAPI_API_KEY`: 외부 API 인증키

카카오 개발자 콘솔의 Redirect URI에는 아래 주소를 등록합니다.

```text
http://localhost:3000/api/auth/callback/kakao
```

운영 환경에서는 도메인만 실제 서비스 주소로 변경합니다.

## 명령어

```bash
npm run dev       # 개발 서버
npm run lint      # 정적 검사
npm run typecheck # TypeScript 검사
npm run build     # 운영 빌드
```
