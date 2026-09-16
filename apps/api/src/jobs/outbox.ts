import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { childLogger } from '../lib/logger.js';
import { clock } from '../lib/clock.js';
import { getEmailProvider } from '../integrations/email/index.js';
import { buildAppointmentEmail } from '../integrations/email/templates.js';

const log = childLogger('outbox');

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

/**
 * Transactional outbox worker.
 *
 * The booking transaction writes an `OutboxEvent` row alongside the appointment itself,
 * so the two commit or roll back together. This worker drains those rows afterwards.
 *
 * That ordering is what makes notifications trustworthy: a committed booking always has
 * a pending row waiting to be delivered, and a rolled-back one never leaves one behind.
 * Sending inline from the request would break both halves — a crash after commit loses
 * the email silently, and a failed transaction that already sent one tells a customer
 * about an appointment that does not exist.
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED`, so running several API instances is
 * safe: each picks up a disjoint batch instead of racing over the same rows.
 */
interface Claimed {
  id: string;
  eventType: string;
  payload: { appointmentId?: string; manageToken?: string; previousStartsAt?: string };
  attempts: number;
}

async function deliver(event: Claimed): Promise<void> {
  const appointmentId = event.payload?.appointmentId;
  if (!appointmentId) throw new Error(`Outbox event ${event.id} carries no appointmentId`);

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      customer: { select: { name: true, email: true } },
      service: { include: { cancellationPolicy: { select: { description: true } } } },
    },
  });

  if (!appointment) {
    // The appointment is gone; retrying will never help, so treat this as delivered
    // rather than looping it all the way to the dead-letter queue.
    log.warn({ eventId: event.id, appointmentId }, 'Appointment missing, skipping notification');
    return;
  }

  const message = buildAppointmentEmail(event.eventType as Parameters<typeof buildAppointmentEmail>[0], {
    customerName: appointment.customer.name,
    customerEmail: appointment.customer.email,
    serviceName: appointment.serviceName,
    providerName: appointment.providerName,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    timezone: appointment.timezone,
    durationMin: appointment.durationMin,
    priceMinor: appointment.priceMinor,
    currency: appointment.currency,
    locationDetail: appointment.locationDetail,
    code: appointment.code,
    manageToken: event.payload.manageToken ?? null,
    cancellationPolicy: appointment.service.cancellationPolicy?.description ?? null,
    previousStartsAt: event.payload.previousStartsAt
      ? new Date(event.payload.previousStartsAt)
      : null,
  });

  await getEmailProvider().send(message);

  // Logged for the admin notification history, so a delivery problem is visible in the
  // product rather than only in process logs.
  await prisma.notificationLog.create({
    data: {
      appointmentId: appointment.id,
      event: event.eventType as 'BOOKING_CONFIRMED',
      channel: 'EMAIL',
      recipientType: 'CUSTOMER',
      recipient: appointment.customer.email,
      subject: message.subject,
      status: 'SENT',
      sentAt: clock.now(),
    },
  });
}

export async function drainOutboxOnce(): Promise<number> {
  const now = clock.now();

  // Claim a batch atomically. SKIP LOCKED means concurrent workers never collide.
  const claimed = await prisma.$queryRawUnsafe<Claimed[]>(
    `
    WITH candidates AS (
      SELECT id FROM outbox_events
      WHERE "processedAt" IS NULL
        AND "deadLetteredAt" IS NULL
        AND "scheduledFor" <= $1
        AND attempts < $2
      ORDER BY "scheduledFor"
      LIMIT $3
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events o
    SET attempts = o.attempts + 1
    FROM candidates c
    WHERE o.id = c.id
    RETURNING o.id, o."eventType", o.payload, o.attempts
    `,
    now,
    MAX_ATTEMPTS,
    BATCH_SIZE,
  );

  let delivered = 0;

  for (const event of claimed) {
    try {
      await deliver(event);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          processedAt: clock.now(),
          lastError: null,
          // The manage token has been delivered; there is no reason to keep a plaintext
          // copy of it sitting in the database afterwards.
          payload: { appointmentId: event.payload.appointmentId },
        },
      });
      delivered += 1;
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      const exhausted = event.attempts >= MAX_ATTEMPTS;

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          lastError: failure.slice(0, 500),
          // Give up rather than retry forever, but keep the row so the failure is
          // visible and can be replayed by hand.
          deadLetteredAt: exhausted ? clock.now() : null,
        },
      });

      log[exhausted ? 'error' : 'warn'](
        { eventId: event.id, attempts: event.attempts, err: error },
        exhausted ? 'Outbox event dead-lettered' : 'Outbox delivery failed, will retry',
      );
    }
  }

  return delivered;
}

/**
 * Releases PENDING appointments whose hold has expired.
 *
 * Without this, an abandoned payment-pending booking would squat its slot forever and
 * keep counting against the customer's daily cap. The grace period avoids racing a
 * confirmation that is in flight at the moment the hold lapses.
 */
export async function sweepExpiredHolds(): Promise<number> {
  const cutoff = new Date(clock.now().getTime() - env.PENDING_SWEEP_GRACE_SEC * 1000);

  const expired = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `
    SELECT id FROM appointments
    WHERE status = 'PENDING' AND "holdExpiresAt" IS NOT NULL AND "holdExpiresAt" < $1
    LIMIT 50
    FOR UPDATE SKIP LOCKED
    `,
    cutoff,
  );

  for (const { id } of expired) {
    await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({ where: { id } });
      // Re-check under the transaction: a webhook may have confirmed it in the meantime.
      if (!appointment || appointment.status !== 'PENDING') return;

      await tx.appointment.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: clock.now(),
          cancelledByType: 'SYSTEM',
          cancellationReason: 'Hold expired before confirmation',
        },
      });

      await tx.appointmentHistory.create({
        data: {
          appointmentId: id,
          action: 'EXPIRED',
          fromStatus: 'PENDING',
          toStatus: 'CANCELLED',
          actorType: 'SYSTEM',
          note: 'Hold expired',
        },
      });
    });
  }

  if (expired.length > 0) log.info({ count: expired.length }, 'Released expired holds');
  return expired.length;
}

/**
 * Marks past confirmed appointments as completed, so the dashboard reflects reality
 * without a receptionist ticking every row by hand.
 */
export async function autoCompletePast(): Promise<number> {
  const cutoff = new Date(clock.now().getTime() - 60 * 60_000);
  const result = await prisma.appointment.updateMany({
    where: { status: 'CONFIRMED', endsAt: { lt: cutoff } },
    data: { status: 'COMPLETED', completedAt: clock.now() },
  });
  if (result.count > 0) log.info({ count: result.count }, 'Auto-completed past appointments');
  return result.count;
}

let timer: NodeJS.Timeout | null = null;

/**
 * In-process poller rather than a separate queue service.
 *
 * At this scale a queue would be a second deployable, a second failure mode and a Redis
 * dependency in exchange for very little. The outbox table already provides durability
 * and at-least-once delivery; this just drains it.
 */
export function startBackgroundJobs(): void {
  if (!env.ENABLE_BACKGROUND_JOBS || timer) return;

  const tick = async (): Promise<void> => {
    try {
      await drainOutboxOnce();
      await sweepExpiredHolds();
      await autoCompletePast();
    } catch (error) {
      // A failed tick must never take the API down with it.
      log.error({ err: error }, 'Background tick failed');
    }
  };

  timer = setInterval(() => void tick(), env.OUTBOX_POLL_INTERVAL_MS);
  timer.unref();
  void tick();

  log.info({ intervalMs: env.OUTBOX_POLL_INTERVAL_MS }, 'Background jobs started');
}

export function stopBackgroundJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
