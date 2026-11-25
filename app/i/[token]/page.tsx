import Welcome from "@/components/Welcome";
import { pool } from "@/lib/db";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[\w-]{32}$/.test(token)) notFound();
  const { rows } = await pool.query("SELECT status FROM invitations WHERE token=$1", [token]);
  if (!rows.length) notFound();
  if (rows[0].status === "queued") {
    return (
      <main className="narrow">
        <h1>Your invitation is pending</h1>
        <p>Once HR sends your invitation, open the email or return to this link to start onboarding.</p>
      </main>
    );
  }
  return <Welcome token={token} />;
}
