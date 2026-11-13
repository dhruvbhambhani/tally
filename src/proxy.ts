import { NextResponse, type NextRequest } from "next/server";

const WORKSPACE_COOKIE = "tally_ws";
const SHARED_HOST = process.env.TALLY_SHARED === "1" || (!!process.env.VERCEL && process.env.TALLY_SHARED !== "0");

/**
 * On a shared host, give every browser its own workspace id before the first
 * page renders, so no visitor can ever see another visitor's files.
 */
export function proxy(request: NextRequest) {
  if (!SHARED_HOST || request.cookies.has(WORKSPACE_COOKIE)) return NextResponse.next();
  const id = crypto.randomUUID();
  request.cookies.set(WORKSPACE_COOKIE, id); // visible to this same request's render
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(WORKSPACE_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365 });
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
