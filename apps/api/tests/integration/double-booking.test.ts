import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { OCCUPYING_STATUSES } from '../../src/modules/slots/slots.service.js';
import { anonymous, errorCodeOf } from '../helpers/api.js';
import { H, buildWorld, createCustomerUser, instantAt, uniqueEmail } from '../helpers/factories.js';

/**
 * The double-booking guarantee.
 *
 * This is the file that matters. Everything else in the system is convenience; if these
 * assertions fail, the product is broken in the one way a booking product may not be.
 *
 * The tests deliberately attack the guarantee from below as well as above: through the
 * API, through Prisma, and through raw SQL. A guarantee that only holds when the
 * application is well-behaved is not a guarantee — it is a convention.
 */

const bookingBody = (serviceId: string, providerId: string, startsAt: Date, email: string) => ({
  serviceId,
  providerId,
  startsAt: startsAt.toISOString(),
  customer: { name: 'Race Contender', email, timezone: 'Asia/Kolkata' },
});

/**
 * Inserts an appointment row with raw SQL, bypassing every line of application code.
 *
 * This is the "stray script at 2am" case. If the constraint only held for rows written by
 * the booking service, it would be an application rule wearing a database costume.
 */
async function rawInsertAppointment(input: {
  serviceId: string;
  providerId: string;
  customerId: string;
  startsAt: Date;
  endsAt: Date;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  status?: string;
  /** Deliberately wrong block range, to prove the trigger overrides whatever is supplied. */
  blockStartsAt?: Date;
  blockEndsAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO appointments (
       id, code, status, "serviceId", "providerId", "customerId",
       "startsAt", "endsAt", "blockStartsAt", "blockEndsAt", timezone,
       "serviceName", "durationMin", "bufferBeforeMin", "bufferAfterMin",
       "priceMinor", currency, "paymentMode", "providerName", "locationType",
       "rootAppointmentId", "updatedAt"
     ) VALUES (
       $1::uuid, $2, $3::"AppointmentStatus", $4::uuid, $5::uuid, $6::uuid,
       $7, $8, $9, $10, $11,
       $12, $13, $14, $15,
       $16, $17, $18::"PaymentMode", $19, $20::"LocationType",
       $1::uuid, now()
     )`,
    id,
    `RAW-${id.slice(0, 8)}`,
    input.status ?? 'CONFIRMED',
    input.serviceId,
    input.providerId,
    input.customerId,
    input.startsAt,
    input.endsAt,
    input.blockStartsAt ?? input.startsAt,
    input.blockEndsAt ?? input.endsAt,
    'Asia/Kolkata',
    'Raw Service',
    Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000),
    input.bufferBeforeMin ?? 0,
    input.bufferAfterMin ?? 0,
    0,
    'INR',
    'FREE',
    'Raw Provider',
    'IN_PERSON',
  );
  return id;
}

describe('the double-booking guarantee', () => {
  it('lets exactly one of six simultaneous requests win the same slot', async () => {
    const world = await buildWorld({ durationMin: 30, slotIntervalMin: 15 });
    const startsAt = instantAt(world.monday, H(11), world.provider.timezone);

    // Six separate customers from six separate addresses, so neither the per-customer
    // daily cap nor the booking rate limiter can be what rejects them.
    const attempts = Array.from({ length: 6 }, () =>
      anonymous()
        .post('/appointments')
        .send(
          bookingBody(world.service.id, world.provider.providerId, startsAt, uniqueEmail('racer')),
        ),
    );

    const responses = await Promise.all(attempts);
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);

    for (const response of responses.filter((r) => r.status === 409)) {
      expect(errorCodeOf(response)).toBe('SLOT_UNAVAILABLE');
    }

    // And the database agrees with the HTTP responses, which is the assertion that would
    // catch a bug where the API reported a conflict it had not actually prevented.
    const stored = await prisma.appointment.count({
      where: { providerId: world.provider.providerId, startsAt },
    });
    expect(stored).toBe(1);
  });

  it('rejects an overlapping row written by raw SQL, with no application code involved', async () => {
    const world = await buildWorld();
    const customer = await createCustomerUser();
    const startsAt = instantAt(world.monday, H(13), world.provider.timezone);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);

    await rawInsertAppointment({
      serviceId: world.service.id,
      providerId: world.provider.providerId,
      customerId: customer.customerId,
      startsAt,
      endsAt,
    });

    // Starts fifteen minutes in — squarely overlapping.
    await expect(
      rawInsertAppointment({
        serviceId: world.service.id,
        providerId: world.provider.providerId,
        customerId: customer.customerId,
        startsAt: new Date(startsAt.getTime() + 15 * 60_000),
        endsAt: new Date(endsAt.getTime() + 15 * 60_000),
      }),
    ).rejects.toThrow(/exclusion|23P01|appointments_no_overlap/i);
  });

  it('allows back-to-back appointments, because the reserved range is half-open', async () => {
    const world = await buildWorld({ bufferBeforeMin: 0, bufferAfterMin: 0, durationMin: 30 });
    const customer = await createCustomerUser();
    const first = instantAt(world.monday, H(14), world.provider.timezone);
    const firstEnd = new Date(first.getTime() + 30 * 60_000);

    await rawInsertAppointment({
      serviceId: world.service.id,
      providerId: world.provider.providerId,
      customerId: customer.customerId,
      startsAt: first,
      endsAt: firstEnd,
    });

    // One ends at 14:30, the next starts at 14:30. They touch but do not overlap.
    await expect(
      rawInsertAppointment({
        serviceId: world.service.id,
        providerId: world.provider.providerId,
        customerId: customer.customerId,
        startsAt: firstEnd,
        endsAt: new Date(firstEnd.getTime() + 30 * 60_000),
      }),
    ).resolves.toBeTruthy();
  });

  it('derives the reserved range from the buffers, ignoring what the caller supplies', async () => {
    const world = await buildWorld();
    const customer = await createCustomerUser();
    const startsAt = instantAt(world.monday, H(15), world.provider.timezone);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);

    // A caller trying to under-report its own footprint so it fits somewhere it should not.
    const id = await rawInsertAppointment({
      serviceId: world.service.id,
      providerId: world.provider.providerId,
      customerId: customer.customerId,
      startsAt,
      endsAt,
      bufferBeforeMin: 10,
      bufferAfterMin: 10,
      blockStartsAt: startsAt,
      blockEndsAt: endsAt,
    });

    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id } });
    expect(stored.blockStartsAt.getTime()).toBe(startsAt.getTime() - 10 * 60_000);
    expect(stored.blockEndsAt.getTime()).toBe(endsAt.getTime() + 10 * 60_000);
  });

  it('stacks buffers between neighbours rather than merging them', async () => {
    const world = await buildWorld({ bufferBeforeMin: 10, bufferAfterMin: 10, durationMin: 30 });
    const customer = await createCustomerUser();
    const first = instantAt(world.monday, H(10), world.provider.timezone);
    const firstEnd = new Date(first.getTime() + 30 * 60_000);

    await rawInsertAppointment({
      serviceId: world.service.id,
      providerId: world.provider.providerId,
      customerId: customer.customerId,
      startsAt: first,
      endsAt: firstEnd,
      bufferBeforeMin: 10,
      bufferAfterMin: 10,
    });

    // 10:30 + the first one's 10-minute trailing buffer + this one's 10-minute leading
    // buffer means the earliest legal start is 10:50. 10:45 must therefore be refused.
    await expect(
      rawInsertAppointment({
        serviceId: world.service.id,
        providerId: world.provider.providerId,
        customerId: customer.customerId,
        startsAt: new Date(first.getTime() + 45 * 60_000),
        endsAt: new Date(first.getTime() + 75 * 60_000),
        bufferBeforeMin: 10,
        bufferAfterMin: 10,
      }),
    ).rejects.toThrow(/exclusion|23P01|appointments_no_overlap/i);

    // …and 10:50 exactly must be accepted, or the rule is too strict rather than correct.
    await expect(
      rawInsertAppointment({
        serviceId: world.service.id,
        providerId: world.provider.providerId,
        customerId: customer.customerId,
        startsAt: new Date(first.getTime() + 50 * 60_000),
        endsAt: new Date(first.getTime() + 80 * 60_000),
        bufferBeforeMin: 10,
        bufferAfterMin: 10,
      }),
    ).resolves.toBeTruthy();
  });

  it('frees the slot the moment an appointment is cancelled, without deleting the row', async () => {
    const world = await buildWorld();
    const customer = await createCustomerUser();
    const startsAt = instantAt(world.monday, H(12), world.provider.timezone);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);

    const id = await rawInsertAppointment({
      serviceId: world.service.id,
      providerId: world.provider.providerId,
      customerId: customer.customerId,
      startsAt,
      endsAt,
    });

    await prisma.appointment.update({ where: { id }, data: { status: 'CANCELLED' } });

    // The slot is bookable again…
    const replacement = await anonymous()
      .post('/appointments')
      .send(bookingBody(world.service.id, world.provider.providerId, startsAt, uniqueEmail('after')));
    expect(replacement.status).toBe(201);

    // …and the cancelled record still exists. History is never destroyed.
    expect(await prisma.appointment.findUnique({ where: { id } })).not.toBeNull();
  });

  it('keeps the occupying-status list in step with the constraint predicate', async () => {
    const [row] = await prisma.$queryRawUnsafe<{ definition: string }[]>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE conname = 'appointments_no_overlap'`,
    );

    expect(row).toBeDefined();
    const definition = row!.definition;

    // Drift here is silent and expensive in both directions: a status the engine treats
    // as busy but the constraint ignores means real double bookings, and the reverse
    // means slots that can never be booked again.
    for (const status of OCCUPYING_STATUSES) {
      expect(definition).toContain(status);
    }
    for (const status of ['CANCELLED', 'RESCHEDULED']) {
      expect(definition).not.toContain(status);
    }
  });
});
