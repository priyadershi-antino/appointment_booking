import { notFound } from 'next/navigation';
import { api, type ServiceSummary } from '@/lib/api';
import { BookingFlow } from './booking-flow';

export const dynamic = 'force-dynamic';

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let service: ServiceSummary;
  try {
    service = await api<ServiceSummary>(`/services/${slug}`);
  } catch {
    notFound();
  }

  return <BookingFlow service={service} />;
}
