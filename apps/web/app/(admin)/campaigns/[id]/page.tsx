import { notFound, redirect } from "next/navigation";
import { getCampaignDetail } from "@/lib/campaigns";
import { withAccount } from "@/lib/db";
import { getSession } from "@/lib/session";
import { CampaignForm } from "./campaign-form";

export default async function CampaignEditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) notFound();

  const detail = await withAccount(session.accountId, (client) => getCampaignDetail(client, campaignId));
  if (!detail) notFound();

  return <CampaignForm initial={detail} />;
}
