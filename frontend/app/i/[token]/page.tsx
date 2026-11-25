import Welcome from "@/components/Welcome";
import { invitationStatus } from "@backend/services/access-mail";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const status = await invitationStatus(token);
  if (!status) notFound();
  if (status === "queued") {
    return (
      <main className="narrow">
        <h1>Your invitation is pending</h1>
        <p>Once HR sends your invitation, open the email or return to this link to start onboarding.</p>
      </main>
    );
  }
  return <Welcome token={token} />;
}
