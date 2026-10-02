import { PublicBooking } from "@/components/public/public-booking";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicBooking slug={slug} />;
}
