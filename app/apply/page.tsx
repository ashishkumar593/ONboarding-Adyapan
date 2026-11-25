import Intern from "@/components/Intern";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  return <Intern token={(await searchParams).invite || ""} />;
}
