import { env } from '../../config/env.js';
import { formatLocal } from '../../domain/time/zone.js';
import type { EmailMessage } from './index.js';

export interface AppointmentEmailData {
  customerName: string;
  customerEmail: string;
  serviceName: string;
  providerName: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  durationMin: number;
  priceMinor: number;
  currency: string;
  locationDetail: string | null;
  code: string;
  /** Plain manage token. Present only on the message that introduces it. */
  manageToken?: string | null;
  cancellationPolicy?: string | null;
  /** For a reschedule, where the appointment used to be. */
  previousStartsAt?: Date | null;
}

type EventKind =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CREATED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_RESCHEDULED'
  | 'APPOINTMENT_REMINDER';

const COPY: Record<EventKind, { subject: (d: AppointmentEmailData) => string; lead: string; tone: string }> = {
  BOOKING_CONFIRMED: {
    subject: (d) => `Confirmed: ${d.serviceName} on ${formatLocal(d.startsAt, d.timezone, 'd MMM')}`,
    lead: 'Your appointment is confirmed.',
    tone: '#0a6b3d',
  },
  BOOKING_CREATED: {
    subject: (d) => `Received: ${d.serviceName} on ${formatLocal(d.startsAt, d.timezone, 'd MMM')}`,
    lead: 'We have received your booking and it is awaiting confirmation.',
    tone: '#8a5300',
  },
  BOOKING_CANCELLED: {
    subject: (d) => `Cancelled: ${d.serviceName} on ${formatLocal(d.startsAt, d.timezone, 'd MMM')}`,
    lead: 'Your appointment has been cancelled.',
    tone: '#a8112a',
  },
  BOOKING_RESCHEDULED: {
    subject: (d) => `Moved: ${d.serviceName} is now ${formatLocal(d.startsAt, d.timezone, 'd MMM')}`,
    lead: 'Your appointment has been moved to a new time.',
    tone: '#4f2fe0',
  },
  APPOINTMENT_REMINDER: {
    subject: (d) => `Reminder: ${d.serviceName} on ${formatLocal(d.startsAt, d.timezone, 'd MMM')}`,
    lead: 'This is a reminder about your upcoming appointment.',
    tone: '#1d4ed8',
  },
};

const money = (minor: number, currency: string): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    minor / 100,
  );

/** Minimal escaping — every value below is customer-supplied or catalog text. */
const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function buildAppointmentEmail(
  event: EventKind,
  data: AppointmentEmailData,
): EmailMessage {
  const copy = COPY[event];
  const date = formatLocal(data.startsAt, data.timezone, 'EEEE d MMMM yyyy');
  const time = formatLocal(data.startsAt, data.timezone, 'HH:mm');
  const endTime = formatLocal(data.endsAt, data.timezone, 'HH:mm');
  const manageUrl = data.manageToken ? `${env.FRONTEND_URL}/manage/${data.manageToken}` : null;
  const active = event !== 'BOOKING_CANCELLED';

  const rows: [string, string][] = [
    ['Service', data.serviceName],
    ['With', data.providerName],
    ['When', `${date}, ${time}–${endTime} (${data.timezone})`],
    ['Duration', `${data.durationMin} minutes`],
    ['Where', data.locationDetail ?? 'Online'],
    ['Reference', data.code],
  ];
  if (data.priceMinor > 0) rows.push(['Price', money(data.priceMinor, data.currency)]);
  if (data.previousStartsAt) {
    rows.splice(3, 0, [
      'Previously',
      formatLocal(data.previousStartsAt, data.timezone, 'EEEE d MMMM, HH:mm'),
    ]);
  }

  const text = [
    `Hello ${data.customerName},`,
    '',
    copy.lead,
    '',
    ...rows.map(([label, value]) => `${label.padEnd(11)}${value}`),
    ...(manageUrl && active ? ['', `Reschedule or cancel: ${manageUrl}`] : []),
    ...(data.cancellationPolicy && active ? ['', data.cancellationPolicy] : []),
    '',
    'Meridian Clinic',
  ].join('\n');

  // Table-based layout with inline styles: mail clients strip <style> blocks and have
  // patchy flexbox support, so the plainest possible HTML is the reliable choice.
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0c0c0f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e6e6ea;border-radius:10px" cellpadding="0" cellspacing="0">
      <tr><td style="padding:24px 24px 0">
        <div style="width:36px;height:3px;background:${copy.tone};border-radius:2px"></div>
        <h1 style="margin:16px 0 4px;font-size:20px;font-weight:800;letter-spacing:-0.02em">${esc(copy.lead)}</h1>
        <p style="margin:0;font-size:14px;color:#5b5b66">Hello ${esc(data.customerName)},</p>
      </td></tr>

      <tr><td style="padding:20px 24px 0">
        <div style="background:#f4f4f6;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:28px;font-weight:800;letter-spacing:-0.02em">${esc(time)}</div>
          <div style="font-size:14px;font-weight:600;color:#5b5b66;margin-top:2px">${esc(date)}</div>
          <div style="font-size:12px;color:#8e8e9a;margin-top:4px">Times shown in ${esc(data.timezone)}</div>
        </div>
      </td></tr>

      <tr><td style="padding:16px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
          ${rows
            .map(
              ([label, value]) =>
                `<tr><td style="padding:7px 0;color:#8e8e9a;border-bottom:1px solid #f0f0f2">${esc(label)}</td><td align="right" style="padding:7px 0;font-weight:600;border-bottom:1px solid #f0f0f2">${esc(value)}</td></tr>`,
            )
            .join('')}
        </table>
      </td></tr>

      ${
        manageUrl && active
          ? `<tr><td style="padding:20px 24px 0" align="center">
               <a href="${manageUrl}" style="display:inline-block;background:#4f2fe0;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 24px;border-radius:6px">Reschedule or cancel</a>
             </td></tr>`
          : ''
      }

      ${
        data.cancellationPolicy && active
          ? `<tr><td style="padding:16px 24px 0"><p style="margin:0;font-size:12px;color:#8e8e9a;line-height:1.5">${esc(data.cancellationPolicy)}</p></td></tr>`
          : ''
      }

      <tr><td style="padding:24px">
        <p style="margin:0;padding-top:16px;border-top:1px solid #e6e6ea;font-size:12px;color:#8e8e9a">Meridian Clinic</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { to: data.customerEmail, subject: copy.subject(data), text, html };
}
