import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/require-member";

export default async function HomePage() {
  const member = await getCurrentMember();
  redirect(member ? "/lps" : "/login");
}
