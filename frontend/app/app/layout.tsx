import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

// Lê o cookie de sessão a cada request — nunca prerenderizar estaticamente.
export const dynamic = "force-dynamic";

// Protege a área logada: sem sessão válida, manda pro /login.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <>{children}</>;
}
