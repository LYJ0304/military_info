import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-20">
      <div className="max-w-2xl space-y-6">
        <p className="text-sm font-semibold tracking-widest text-emerald-700">
          MILITARY INFO
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          군 관련 정보를 한곳에서 확인하세요.
        </h1>
        <p className="text-lg leading-8 text-zinc-600">
          외부 OpenAPI 데이터를 안전하게 조회하고 필요한 정보만 간결하게
          보여주는 서비스입니다.
        </p>
        <Link
          className="inline-flex rounded-lg bg-[#FEE500] px-5 py-3 font-semibold text-[#191919] transition hover:brightness-95"
          href="/api/auth/signin/kakao"
        >
          카카오로 시작하기
        </Link>
      </div>
    </main>
  );
}
