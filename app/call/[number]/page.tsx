import PagerApp from "@/app/pager-app";
export default async function CallPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  return <PagerApp initialNumber={number} />;
}
