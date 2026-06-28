import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";

// Autenticação self-contained (sem Supabase Auth, sem dependências externas).
// Usa a service role key para ler/escrever a tabela `users` e cookies de sessão
// assinados via HMAC. Pagamento ainda não implementado: todo usuário nasce no
// plano "free".

const COOKIE_NAME = "djviral_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

const authSecret = process.env.AUTH_SECRET;
if (!authSecret) {
  throw new Error("AUTH_SECRET precisa estar definido no ambiente");
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  plan: string;
};

// --- senha (scrypt) -------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const test = scryptSync(password, salt, 64);
  return hashBuf.length === test.length && timingSafeEqual(hashBuf, test);
}

// --- token de sessão (HMAC) ----------------------------------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(data: string): string {
  return b64url(createHmac("sha256", authSecret as string).update(data).digest());
}

export function createSessionToken(userId: string): string {
  const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS }));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64").toString());
    if (typeof uid !== "string" || typeof exp !== "number" || Date.now() > exp) return null;
    return uid;
  } catch {
    return null;
  }
}

// --- cookies / sessão atual ----------------------------------------------

export function sessionCookie(userId: string) {
  return {
    name: COOKIE_NAME,
    value: createSessionToken(userId),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export function clearedCookie() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

// Lê o cookie de sessão e devolve o usuário, ou null se não autenticado.
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  const userId = verifySessionToken(token);
  if (!userId) return null;

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, name, email, plan")
    .eq("id", userId)
    .single();
  if (error || !data) return null;
  return data as SessionUser;
}
