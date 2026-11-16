import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

type PaidPlan = "pro" | "premium";

type LoginSearch = {
  signup?: string | string[];
  mode?: string | string[];
  plan?: string | string[];
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function paidPlan(value: string | undefined): PaidPlan | null {
  return value === "pro" || value === "premium" ? value : null;
}

function wantsSignup(searchParams: LoginSearch, plan: PaidPlan | null): boolean {
  // `signup` presente (mesmo vazio) ou mode=register abre direto no cadastro.
  // Um plano pago vindo da landing também cai no cadastro: a conta vem antes
  // do checkout que já existe na aba Plano.
  return (
    searchParams.signup !== undefined ||
    first(searchParams.mode) === "register" ||
    plan !== null
  );
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: LoginSearch;
}): Promise<Metadata> {
  const t = await getTranslations("login");
  const plan = paidPlan(first(searchParams.plan));
  const signup = wantsSignup(searchParams, plan);
  const title = signup ? t("metaTitleRegister") : t("metaTitleLogin");
  const description = signup ? t("metaDescriptionRegister") : t("metaDescriptionLogin");
  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: "/login" },
    openGraph: { title, description, url: "/login" },
  };
}

// A query define o modo no HTML do servidor. Sem isso, /login?signup=1
// saía como "Entrar" e só virava cadastro depois da hidratação.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: LoginSearch }) {
  const plan = paidPlan(first(searchParams.plan));
  if (plan) {
    const user = await getSessionUser();
    if (user) redirect(`/app?checkout=${plan}`);
  }
  const signup = wantsSignup(searchParams, plan);
  return <LoginForm initialMode={signup ? "register" : "login"} plan={plan} />;
}
