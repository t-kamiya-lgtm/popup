import { NextResponse } from "next/server";
import { getSession } from "./session";

/**
 * Every admin API route needs the same "is there a logged-in account"
 * check before it can call withAccount(). Returns the accountId, or a
 * ready-to-return 401 response — callers do:
 *
 *   const accountId = await requireAccountId();
 *   if (accountId instanceof NextResponse) return accountId;
 */
export async function requireAccountId(): Promise<number | NextResponse> {
  const session = await getSession();
  if (!session.accountId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return session.accountId;
}
