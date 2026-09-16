import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  AppointmentStatus,
  type ActorType,
  ErrorCode,
  type CancellationReasonCode,
} from '@booking/shared';
import { prisma, type TransactionClient } from '../../lib/prisma.js';
import { AppError, isExclusionViolation } from '../../lib/errors.js';
import { toDateKey } from '../../domain/time/zone.js';
import { assertSlotBookable, OCCUPYING_STATUSES } from '../slots/slots.service.js';

export interface CreateBookingInput {
  serviceId: string;
  providerId?: string | null;
  startsAt: Date;
  customer: { name: string; email: string; phone?: string | null; timezone: string };
  customerNotes?: string | null;
  answers?: { questionId: string; value: string }[];
  actorType: ActorType;
  actorUserId?: string | null;
  now: Date;
}

/**
 * Advisory-lock key. PostgreSQL takes two 32-bit integers, so the composite identity is
 * hashed down to that.
 *
 * Locks are always taken in a fixed, sorted order across a transaction, which is what
 * stops two reschedules moving in opposite directions between the same pair of slots from
 * deadlocking each other.
 */
function lockKey(parts: string): number {
  const digest = createHash('sha1').update(parts).digest();
  // Signed 32-bit, which is what pg_advisory_xact_lock expects.
  return digest.readInt32BE(0);
}

async function acquireLocks(tx: TransactionClient, keys: number[]): Promise<void> {
  for (const key of [...new Set(keys)].sort((a, b) => a - b)) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1::int, $2::int)', 1, key);
  }
}

/** Sequential, human-readable reference. Generated inside the transaction it belongs to. */
async function nextCode(tx: TransactionClient, year: number): Promise<string> {
  const rows = await tx.$queryRawUnsafe<{ max: string | null }[]>(
    `SELECT MAX(SUBSTRING(code FROM 10)) AS max FROM appointments WHERE code LIKE $1`,
    `APT-${year}-%`,
  );
  const next = Number(rows[0]?.max ?? 0) + 1;
  return `APT-${year}-${String(next).padStart(6, '0')}`;
}

function newManageToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

/**
 * Creates a booking.
 *
 * The write path, in order, and each step is there for a reason:
 *
 *   1. Engine check OUTSIDE the transaction, to turn predictable failures (closed, on
 *      leave, too soon) into precise errors rather than a bare conflict.
 *   2. Advisory locks on (provider, slot) and (provider, day), which serialise the few
 *      requests contending for the same slot and make the per-day cap count trustworthy.
 *      A cap cannot be expressed as a constraint, so it needs this.
 *   3. Re-check the cap inside the lock, because the count read in step 1 is already stale.
 *   4. Insert. The exclusion constraint has the final say: if another transaction
 *      committed an overlapping row microseconds earlier, PostgreSQL raises 23P01 and we
 *      translate it to 409 SLOT_UNAVAILABLE.
 *
 * Step 4 is the actual guarantee. Steps 1-3 exist to make the common cases explainable
 * and to enforce the rules a constraint cannot express.
 */
export async function createBooking(input: CreateBookingInput) {
  const service = await prisma.service.findFirst({
    where: { id: input.serviceId, deletedAt: null },
    include: { providers: true, cancellationPolicy: true },
  });
  if (!service) throw new AppError(ErrorCode.SERVICE_NOT_FOUND);
  if (!service.isActive) throw new AppError(ErrorCode.SERVICE_INACTIVE);

  if (input.startsAt.getTime() <= input.now.getTime()) {
    throw new AppError(ErrorCode.APPOINTMENT_IN_PAST);
  }

  // Resolve the customer up front: a guest booking creates or reuses a record keyed on
  // email, so repeat guests accumulate a history rather than a pile of duplicates.
  const customer = await prisma.customer.upsert({
    where: { email: input.customer.email },
    create: {
      name: input.customer.name,
      email: input.customer.email,
      phone: input.customer.phone ?? null,
      timezone: input.customer.timezone,
    },
    update: {
      name: input.customer.name,
      phone: input.customer.phone ?? undefined,
      timezone: input.customer.timezone,
    },
  });

  // Step 1 — engine check. Also resolves "any provider" to a concrete one.
  const slot = await assertSlotBookable({
    serviceId: service.id,
    providerId: input.providerId ?? '',
    startsAt: input.startsAt,
    now: input.now,
    customerId: customer.id,
  }).catch(async (error) => {
    if (input.providerId) throw error;
    // "Any provider" — let the engine pick.
    const { findSlots } = await import('../slots/slots.service.js');
    const utcKey = toDateKey(input.startsAt, 'UTC');
    const result = await findSlots({
      serviceId: service.id,
      from: utcKey,
      to: utcKey,
      timezone: 'UTC',
      now: input.now,
      customerId: customer.id,
    });
    const found = result.days
      .flatMap((day) => day.slots)
      .find((s) => new Date(s.startUtc).getTime() === input.startsAt.getTime());
    if (!found) throw new AppError(ErrorCode.SLOT_UNAVAILABLE);
    return {
      startUtc: new Date(found.startUtc),
      endUtc: new Date(found.endUtc),
      providerId: found.providerId,
      providerName: found.providerName,
    };
  });

  const provider = await prisma.provider.findUnique({
    where: { id: slot.providerId },
    include: { user: { select: { name: true } } },
  });
  if (!provider || !provider.isActive) throw new AppError(ErrorCode.PROVIDER_INACTIVE);

  const startsAt = input.startsAt;
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
  const providerDateKey = toDateKey(startsAt, provider.timezone);

  // PAY_AT_BOOKING would hold at PENDING awaiting confirmation; FREE confirms outright.
  const status =
    service.paymentMode === 'PAY_AT_BOOKING'
      ? AppointmentStatus.PENDING
      : AppointmentStatus.CONFIRMED;

  const manage = newManageToken();

  try {
    const appointment = await prisma.$transaction(
      async (tx) => {
        // Step 2 — serialise contenders for this slot and this provider-day.
        await acquireLocks(tx, [
          lockKey(`slot:${slot.providerId}:${startsAt.toISOString()}`),
          lockKey(`day:${slot.providerId}:${providerDateKey}`),
        ]);

        // Step 3 — re-count caps now that we hold the lock. The earlier read is stale by
        // definition; this is the count that decides.
        if (service.maxPerDay !== null) {
          const dayStart = new Date(startsAt);
          dayStart.setUTCHours(0, 0, 0, 0);
          const used = await tx.appointment.count({
            where: {
              providerId: slot.providerId,
              status: { in: [...OCCUPYING_STATUSES] },
              startsAt: {
                gte: new Date(dayStart.getTime() - 86_400_000),
                lt: new Date(dayStart.getTime() + 2 * 86_400_000),
              },
            },
          });
          if (used >= service.maxPerDay) {
            throw new AppError(ErrorCode.PROVIDER_DAILY_LIMIT);
          }
        }

        if (service.maxPerCustomerPerDay !== null) {
          const dayStart = new Date(startsAt);
          dayStart.setUTCHours(0, 0, 0, 0);
          const used = await tx.appointment.count({
            where: {
              customerId: customer.id,
              status: { in: [...OCCUPYING_STATUSES] },
              startsAt: {
                gte: dayStart,
                lt: new Date(dayStart.getTime() + 86_400_000),
              },
            },
          });
          if (used >= service.maxPerCustomerPerDay) {
            throw new AppError(ErrorCode.CUSTOMER_DAILY_LIMIT);
          }
        }

        const id = randomUUID();
        const code = await nextCode(tx, startsAt.getUTCFullYear());

        // Step 4 — the insert. The exclusion constraint decides.
        const created = await tx.appointment.create({
          data: {
            id,
            code,
            status,
            serviceId: service.id,
            providerId: slot.providerId,
            customerId: customer.id,
            startsAt,
            endsAt,
            // Overwritten by the trigger from the snapshot buffers below.
            blockStartsAt: startsAt,
            blockEndsAt: endsAt,
            timezone: input.customer.timezone,
            serviceName: service.name,
            durationMin: service.durationMin,
            bufferBeforeMin: service.bufferBeforeMin,
            bufferAfterMin: service.bufferAfterMin,
            priceMinor: service.priceMinor,
            currency: service.currency,
            paymentMode: service.paymentMode,
            providerName: provider.user.name,
            locationType: service.locationType,
            locationDetail: service.locationDetail,
            customerNotes: input.customerNotes ?? null,
            // Self-rooted until it is ever moved.
            rootAppointmentId: id,
            confirmedAt: status === AppointmentStatus.CONFIRMED ? input.now : null,
            holdExpiresAt:
              status === AppointmentStatus.PENDING
                ? new Date(input.now.getTime() + 15 * 60_000)
                : null,
            manageTokenHash: manage.hash,
            manageTokenExpiresAt: new Date(endsAt.getTime() + 30 * 86_400_000),
            createdByType: input.actorType,
          },
        });

        await tx.appointmentHistory.create({
          data: {
            appointmentId: created.id,
            action: 'CREATED',
            toStatus: status,
            actorType: input.actorType,
            actorUserId: input.actorUserId ?? null,
            actorLabel: customer.name,
          },
        });

        if (input.answers?.length) {
          const questions = await tx.bookingQuestion.findMany({
            where: { id: { in: input.answers.map((a) => a.questionId) } },
          });
          await tx.bookingAnswer.createMany({
            data: input.answers.map((answer) => ({
              appointmentId: created.id,
              questionId: answer.questionId,
              // Snapshot the wording: editing the question later must not change what
              // this customer was actually asked.
              questionLabel:
                questions.find((q) => q.id === answer.questionId)?.label ?? 'Question',
              value: answer.value,
            })),
          });
        }

        // Side effects go into the outbox inside the same transaction. A committed
        // booking therefore always eventually notifies, and a rolled-back one never does.
        // The plain manage token is carried here because only the hash is stored on the
        // appointment — the email cannot link to a booking it has no way to address.
        // The worker strips it from the row once the message is delivered, so it does
        // not linger in the database after it has served its purpose.
        await tx.outboxEvent.create({
          data: {
            eventType:
              status === AppointmentStatus.CONFIRMED ? 'BOOKING_CONFIRMED' : 'BOOKING_CREATED',
            payload: { appointmentId: created.id, manageToken: manage.token },
          },
        });

        return created;
      },
      { timeout: 15_000 },
    );

    return { appointment, manageToken: manage.token };
  } catch (error) {
    // The race we designed for: another transaction committed an overlapping booking
    // first. PostgreSQL rejected ours, which is exactly the intended outcome.
    if (isExclusionViolation(error)) {
      throw new AppError(ErrorCode.SLOT_UNAVAILABLE);
    }
    throw error;
  }
}

export interface CancelInput {
  appointmentId: string;
  actorType: ActorType;
  actorUserId?: string | null;
  reasonCode?: CancellationReasonCode | null;
  reason?: string | null;
  now: Date;
  /** Admin and provider cancellations bypass the customer-facing deadline. */
  enforceDeadline: boolean;
}

export async function cancelBooking(input: CancelInput) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    include: { service: { include: { cancellationPolicy: true } } },
  });
  if (!appointment) throw new AppError(ErrorCode.APPOINTMENT_NOT_FOUND);

  if (
    appointment.status !== AppointmentStatus.CONFIRMED &&
    appointment.status !== AppointmentStatus.PENDING
  ) {
    throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION);
  }

  const policy = appointment.service.cancellationPolicy;
  if (input.enforceDeadline && policy) {
    if (!policy.allowCancellation) throw new AppError(ErrorCode.CANCELLATION_NOT_ALLOWED);
    const deadline = appointment.startsAt.getTime() - policy.cancellationDeadlineMin * 60_000;
    if (input.now.getTime() > deadline) {
      throw new AppError(ErrorCode.CANCELLATION_DEADLINE_PASSED);
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancelledAt: input.now,
        cancelledByType: input.actorType,
        cancelledByUserId: input.actorUserId ?? null,
        cancellationCode: input.reasonCode ?? null,
        cancellationReason: input.reason ?? null,
      },
    });

    await tx.appointmentHistory.create({
      data: {
        appointmentId: appointment.id,
        action: 'CANCELLED',
        fromStatus: appointment.status,
        toStatus: AppointmentStatus.CANCELLED,
        actorType: input.actorType,
        actorUserId: input.actorUserId ?? null,
        note: input.reason ?? null,
      },
    });

    await tx.outboxEvent.create({
      data: { eventType: 'BOOKING_CANCELLED', payload: { appointmentId: appointment.id } },
    });

    return updated;
  });
}

export interface RescheduleInput {
  appointmentId: string;
  newStartsAt: Date;
  actorType: ActorType;
  actorUserId?: string | null;
  now: Date;
  enforceDeadline: boolean;
}

/**
 * Moves an appointment to a new time.
 *
 * The ordering here is not stylistic. The predecessor is retired to RESCHEDULED FIRST,
 * and only then is the successor inserted. Inserting first would make the new row collide
 * with the old one's still-active buffered interval — which, for the single most common
 * reschedule ("move it fifteen minutes"), means a spurious 409 telling the customer their
 * own appointment is unavailable.
 *
 * Both writes share one transaction, so a failed move leaves the original booking exactly
 * as it was rather than cancelling it and stranding the customer.
 */
export async function rescheduleBooking(input: RescheduleInput) {
  const original = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    include: { service: { include: { cancellationPolicy: true } }, customer: true },
  });
  if (!original) throw new AppError(ErrorCode.APPOINTMENT_NOT_FOUND);
  if (original.status !== AppointmentStatus.CONFIRMED) {
    throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION);
  }

  const policy = original.service.cancellationPolicy;
  if (input.enforceDeadline && policy) {
    if (!policy.allowReschedule) throw new AppError(ErrorCode.RESCHEDULE_NOT_ALLOWED);
    const deadline = original.startsAt.getTime() - policy.rescheduleDeadlineMin * 60_000;
    if (input.now.getTime() > deadline) {
      throw new AppError(ErrorCode.RESCHEDULE_DEADLINE_PASSED);
    }
    if (original.rescheduleCount >= policy.maxReschedules) {
      throw new AppError(
        ErrorCode.RESCHEDULE_NOT_ALLOWED,
        'This appointment has already been rescheduled the maximum number of times.',
      );
    }
  }

  if (input.newStartsAt.getTime() <= input.now.getTime()) {
    throw new AppError(ErrorCode.APPOINTMENT_IN_PAST);
  }

  const provider = await prisma.provider.findUnique({
    where: { id: original.providerId },
    include: { user: { select: { name: true } } },
  });
  if (!provider) throw new AppError(ErrorCode.PROVIDER_NOT_FOUND);

  const newEndsAt = new Date(input.newStartsAt.getTime() + original.durationMin * 60_000);
  const providerDateKey = toDateKey(input.newStartsAt, provider.timezone);
  const manage = newManageToken();

  try {
    return await prisma.$transaction(async (tx) => {
      await acquireLocks(tx, [
        lockKey(`slot:${original.providerId}:${original.startsAt.toISOString()}`),
        lockKey(`slot:${original.providerId}:${input.newStartsAt.toISOString()}`),
        lockKey(`day:${original.providerId}:${providerDateKey}`),
      ]);

      // Retire the predecessor first — see the note above.
      await tx.appointment.update({
        where: { id: original.id },
        data: { status: AppointmentStatus.RESCHEDULED },
      });

      const id = randomUUID();
      const code = await nextCode(tx, input.newStartsAt.getUTCFullYear());

      const successor = await tx.appointment.create({
        data: {
          id,
          code,
          status: AppointmentStatus.CONFIRMED,
          serviceId: original.serviceId,
          providerId: original.providerId,
          customerId: original.customerId,
          startsAt: input.newStartsAt,
          endsAt: newEndsAt,
          blockStartsAt: input.newStartsAt,
          blockEndsAt: newEndsAt,
          timezone: original.timezone,
          serviceName: original.serviceName,
          durationMin: original.durationMin,
          bufferBeforeMin: original.bufferBeforeMin,
          bufferAfterMin: original.bufferAfterMin,
          priceMinor: original.priceMinor,
          currency: original.currency,
          paymentMode: original.paymentMode,
          providerName: original.providerName,
          locationType: original.locationType,
          locationDetail: original.locationDetail,
          customerNotes: original.customerNotes,
          rescheduledFromId: original.id,
          rootAppointmentId: original.rootAppointmentId,
          rescheduleCount: original.rescheduleCount + 1,
          confirmedAt: input.now,
          manageTokenHash: manage.hash,
          manageTokenExpiresAt: new Date(newEndsAt.getTime() + 30 * 86_400_000),
          createdByType: input.actorType,
        },
      });

      await tx.appointmentHistory.createMany({
        data: [
          {
            appointmentId: original.id,
            action: 'RESCHEDULED',
            fromStatus: AppointmentStatus.CONFIRMED,
            toStatus: AppointmentStatus.RESCHEDULED,
            actorType: input.actorType,
            actorUserId: input.actorUserId ?? null,
            metadata: {
              from: original.startsAt.toISOString(),
              to: input.newStartsAt.toISOString(),
              successorId: successor.id,
            },
          },
          {
            appointmentId: successor.id,
            action: 'CREATED',
            toStatus: AppointmentStatus.CONFIRMED,
            actorType: input.actorType,
            actorUserId: input.actorUserId ?? null,
            metadata: { predecessorId: original.id },
          },
        ],
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'BOOKING_RESCHEDULED',
          payload: {
            appointmentId: successor.id,
            manageToken: manage.token,
            previousStartsAt: original.startsAt.toISOString(),
          },
        },
      });

      return { appointment: successor, manageToken: manage.token };
    });
  } catch (error) {
    if (isExclusionViolation(error)) throw new AppError(ErrorCode.SLOT_UNAVAILABLE);
    throw error;
  }
}

/** Marks a past appointment completed or as a no-show. Staff only. */
export async function markOutcome(input: {
  appointmentId: string;
  outcome: 'COMPLETED' | 'NO_SHOW';
  actorType: ActorType;
  actorUserId?: string | null;
  now: Date;
}) {
  const appointment = await prisma.appointment.findUnique({ where: { id: input.appointmentId } });
  if (!appointment) throw new AppError(ErrorCode.APPOINTMENT_NOT_FOUND);
  if (appointment.status !== AppointmentStatus.CONFIRMED) {
    throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: input.outcome,
        completedAt: input.outcome === 'COMPLETED' ? input.now : null,
      },
    });

    await tx.appointmentHistory.create({
      data: {
        appointmentId: appointment.id,
        action: input.outcome,
        fromStatus: AppointmentStatus.CONFIRMED,
        toStatus: input.outcome,
        actorType: input.actorType,
        actorUserId: input.actorUserId ?? null,
      },
    });

    return updated;
  });
}

export function hashManageToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
