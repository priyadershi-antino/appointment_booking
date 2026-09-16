import type { Metadata } from 'next';
import { ManageBooking } from './manage-booking';

export const metadata: Metadata = { title: 'Manage your appointment' };

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ManageBooking token={token} />;
}
