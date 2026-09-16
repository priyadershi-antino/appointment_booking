import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, ROLE_PERMISSIONS } from '../src/config/permissions.js';
import { localToUtc, addDaysToDateKey, toDateKey } from '../src/domain/time/zone.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEMO_PASSWORD = 'Demo@12345';
const IST = 'Asia/Kolkata';

/** Absolute instant for a wall-clock time on a given local date. */
const at = (dateKey: string, wall: string, zone = IST): Date => {
  const [h, m] = wall.split(':').map(Number);
  return localToUtc(dateKey, (h ?? 0) * 60 + (m ?? 0), zone).instant;
};

const hhmm = (minutes: number): number => minutes;
const H = (hours: number, mins = 0): number => hours * 60 + mins;

async function main(): Promise<void> {
  console.info('Seeding…');

  // Order matters: children before parents.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "appointment_history", "booking_answers", "appointments", "booking_questions",
      "notification_logs", "notification_templates", "outbox_events", "audit_logs",
      "idempotency_keys", "availability_override_windows", "availability_overrides",
      "availability_rules", "time_off", "holidays", "service_providers", "services",
      "cancellation_policies", "customers", "providers", "refresh_tokens",
      "role_permissions", "permissions", "users", "business_settings"
    RESTART IDENTITY CASCADE;
  `);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ── Business settings ─────────────────────────────────────────────────────
  await prisma.businessSettings.create({
    data: {
      name: 'Meridian Health Clinic',
      timezone: IST,
      currency: 'INR',
      supportEmail: 'care@meridianclinic.example',
      defaultSlotIntervalMin: 15,
      defaultMinNoticeMin: 120,
      defaultMaxAdvanceDays: 30,
    },
  });

  // ── Permissions ───────────────────────────────────────────────────────────
  await prisma.permission.createMany({
    data: ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSION_DESCRIPTIONS[key] })),
  });
  const permissions = await prisma.permission.findMany();
  const permissionId = new Map(permissions.map((p) => [p.key, p.id]));

  await prisma.rolePermission.createMany({
    data: Object.entries(ROLE_PERMISSIONS).flatMap(([role, keys]) =>
      keys.map((key) => ({
        role: role as 'ADMIN' | 'PROVIDER' | 'CUSTOMER',
        permissionId: permissionId.get(key)!,
      })),
    ),
  });

  // ── Cancellation policies ─────────────────────────────────────────────────
  const standardPolicy = await prisma.cancellationPolicy.create({
    data: {
      name: 'Standard',
      description:
        'Free cancellation until 24 hours before your appointment. Rescheduling is allowed up to 2 hours before.',
      allowCancellation: true,
      cancellationDeadlineMin: 1440,
      allowReschedule: true,
      rescheduleDeadlineMin: 120,
      maxReschedules: 3,
      isDefault: true,
    },
  });

  const flexiblePolicy = await prisma.cancellationPolicy.create({
    data: {
      name: 'Flexible',
      description: 'Cancel or reschedule any time up to 1 hour before your appointment.',
      allowCancellation: true,
      cancellationDeadlineMin: 60,
      allowReschedule: true,
      rescheduleDeadlineMin: 60,
      maxReschedules: 5,
    },
  });

  // ── Admin ─────────────────────────────────────────────────────────────────
  await prisma.user.create({
    data: {
      name: 'Priya Menon',
      email: 'admin@example.com',
      passwordHash,
      role: 'ADMIN',
      phone: '+91 98450 11223',
      timezone: IST,
    },
  });

  // ── Providers ─────────────────────────────────────────────────────────────
  // One deliberately sits in a DST-observing zone, so timezone handling is exercised
  // by the demo data rather than only by the test suite.
  const providerSpecs = [
    {
      name: 'Dr Anita Rao',
      email: 'provider@example.com',
      slug: 'anita-rao',
      title: 'Consultant Physician',
      bio: 'Fifteen years in internal medicine, with a focus on preventive care and long-term condition management.',
      timezone: IST,
      phone: '+91 98450 22334',
      hours: [
        // Mon-Fri 09:00-13:00 and 14:00-18:00. Wednesday afternoons off.
        ...[1, 2, 4, 5].flatMap((weekday) => [
          { weekday, startMinute: H(9), endMinute: H(13) },
          { weekday, startMinute: H(14), endMinute: H(18) },
        ]),
        { weekday: 3, startMinute: H(9), endMinute: H(13) },
        { weekday: 6, startMinute: H(10), endMinute: H(14) },
      ],
    },
    {
      name: 'Dr Vikram Shah',
      email: 'vikram@example.com',
      slug: 'vikram-shah',
      title: 'Dermatologist',
      bio: 'Specialises in clinical and cosmetic dermatology. Consults in person and online.',
      timezone: IST,
      phone: '+91 98450 33445',
      hours: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        startMinute: H(11),
        endMinute: H(19),
      })),
    },
    {
      name: 'Dr Sarah Whitfield',
      email: 'sarah@example.com',
      slug: 'sarah-whitfield',
      title: 'Telehealth Consultant',
      // New York observes daylight saving, so this provider exercises the DST paths.
      timezone: 'America/New_York',
      phone: '+1 212 555 0148',
      hours: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        startMinute: H(9),
        endMinute: H(17),
      })),
    },
  ];

  const providers: { id: string; timezone: string; name: string }[] = [];
  for (const spec of providerSpecs) {
    const user = await prisma.user.create({
      data: {
        name: spec.name,
        email: spec.email,
        passwordHash,
        role: 'PROVIDER',
        phone: spec.phone,
        timezone: spec.timezone,
        provider: {
          create: {
            slug: spec.slug,
            title: spec.title,
            bio: spec.bio ?? null,
            timezone: spec.timezone,
          },
        },
      },
      include: { provider: true },
    });

    const providerId = user.provider!.id;
    await prisma.availabilityRule.createMany({
      data: spec.hours.map((h) => ({
        providerId,
        weekday: h.weekday,
        startMinute: hhmm(h.startMinute),
        endMinute: hhmm(h.endMinute),
      })),
    });

    providers.push({ ...user.provider!, name: spec.name });
  }

  // ── Services ──────────────────────────────────────────────────────────────
  const serviceSpecs = [
    {
      name: 'General Consultation',
      slug: 'general-consultation',
      description:
        'A standard consultation covering new symptoms, ongoing concerns, or a general check-in.',
      category: 'Consultation',
      durationMin: 30,
      bufferBeforeMin: 10,
      bufferAfterMin: 10,
      slotIntervalMin: 15,
      priceMinor: 100_000,
      locationType: 'IN_PERSON' as const,
      locationDetail: 'Meridian Clinic, 2nd Floor, Indiranagar, Bengaluru',
      minNoticeMin: 120,
      maxAdvanceDays: 30,
      maxPerDay: 12,
      policyId: standardPolicy.id,
      providerIdx: [0, 1],
      color: '#2563eb',
    },
    {
      name: 'Premium Consultation',
      slug: 'premium-consultation',
      description:
        'An extended appointment with a full review of history, investigations and a written care plan.',
      category: 'Consultation',
      durationMin: 60,
      bufferBeforeMin: 10,
      bufferAfterMin: 15,
      slotIntervalMin: 30,
      priceMinor: 250_000,
      locationType: 'IN_PERSON' as const,
      locationDetail: 'Meridian Clinic, 2nd Floor, Indiranagar, Bengaluru',
      minNoticeMin: 240,
      maxAdvanceDays: 45,
      maxPerDay: 6,
      policyId: standardPolicy.id,
      providerIdx: [0],
      color: '#7c3aed',
    },
    {
      name: 'Follow-up Visit',
      slug: 'follow-up-visit',
      description: 'A shorter review appointment for patients seen within the last three months.',
      category: 'Follow-up',
      durationMin: 15,
      bufferBeforeMin: 5,
      bufferAfterMin: 5,
      slotIntervalMin: 15,
      priceMinor: 50_000,
      locationType: 'IN_PERSON' as const,
      locationDetail: 'Meridian Clinic, 2nd Floor, Indiranagar, Bengaluru',
      minNoticeMin: 60,
      maxAdvanceDays: 30,
      maxPerDay: 16,
      policyId: flexiblePolicy.id,
      providerIdx: [0, 1],
      color: '#059669',
    },
    {
      name: 'Online Consultation',
      slug: 'online-consultation',
      description: 'A video consultation. You will receive a secure joining link by email.',
      category: 'Telehealth',
      durationMin: 30,
      bufferBeforeMin: 0,
      bufferAfterMin: 10,
      slotIntervalMin: 15,
      priceMinor: 80_000,
      locationType: 'ONLINE' as const,
      locationDetail: 'Video call — link sent on confirmation',
      minNoticeMin: 60,
      maxAdvanceDays: 60,
      maxPerDay: null,
      policyId: flexiblePolicy.id,
      providerIdx: [1, 2],
      color: '#ea580c',
    },
  ];

  const services: {
    id: string;
    name: string;
    durationMin: number;
    bufferBeforeMin: number;
    bufferAfterMin: number;
    priceMinor: number;
    currency: string;
    paymentMode: 'FREE' | 'PAY_AT_BOOKING' | 'PAY_LATER';
    locationType: 'IN_PERSON' | 'ONLINE' | 'PHONE';
    locationDetail: string | null;
  }[] = [];
  for (const spec of serviceSpecs) {
    const created = await prisma.service.create({
      data: {
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        category: spec.category,
        durationMin: spec.durationMin,
        bufferBeforeMin: spec.bufferBeforeMin,
        bufferAfterMin: spec.bufferAfterMin,
        slotIntervalMin: spec.slotIntervalMin,
        priceMinor: spec.priceMinor,
        currency: 'INR',
        paymentMode: 'FREE',
        locationType: spec.locationType,
        locationDetail: spec.locationDetail,
        minNoticeMin: spec.minNoticeMin,
        maxAdvanceDays: spec.maxAdvanceDays,
        maxPerDay: spec.maxPerDay,
        maxPerCustomerPerDay: 1,
        color: spec.color,
        cancellationPolicyId: spec.policyId,
        sortOrder: services.length,
        providers: {
          create: spec.providerIdx.map((idx) => ({ providerId: providers[idx]!.id })),
        },
      },
    });
    services.push(created);
  }

  // A couple of intake questions on the general consultation.
  await prisma.bookingQuestion.createMany({
    data: [
      {
        serviceId: services[0]!.id,
        label: 'What would you like to discuss?',
        helpText: 'A sentence or two is plenty — it helps the doctor prepare.',
        type: 'TEXTAREA',
        isRequired: true,
        options: [],
        sortOrder: 0,
      },
      {
        serviceId: services[0]!.id,
        label: 'Have you visited us before?',
        type: 'SELECT',
        isRequired: true,
        options: ['First visit', 'Within the last year', 'More than a year ago'],
        sortOrder: 1,
      },
    ],
  });

  // ── Customers ─────────────────────────────────────────────────────────────
  const customerSpecs = [
    { name: 'Rahul Verma', email: 'customer@example.com', phone: '+91 99000 11122' },
    { name: 'Deepa Iyer', email: 'deepa@example.com', phone: '+91 99000 22233' },
    { name: 'Arjun Nair', email: 'arjun@example.com', phone: '+91 99000 33344' },
    { name: 'Meera Krishnan', email: 'meera@example.com', phone: '+91 99000 44455' },
  ];

  const customers: { id: string; name: string; timezone: string }[] = [];
  // The first customer has a login; the rest are guest records, which is realistic and
  // exercises the nullable userId path.
  const withLogin = await prisma.user.create({
    data: {
      name: customerSpecs[0]!.name,
      email: customerSpecs[0]!.email,
      passwordHash,
      role: 'CUSTOMER',
      phone: customerSpecs[0]!.phone,
      timezone: IST,
      customer: {
        create: {
          name: customerSpecs[0]!.name,
          email: customerSpecs[0]!.email,
          phone: customerSpecs[0]!.phone,
          timezone: IST,
        },
      },
    },
    include: { customer: true },
  });
  customers.push(withLogin.customer!);

  for (const spec of customerSpecs.slice(1)) {
    customers.push(
      await prisma.customer.create({
        data: { name: spec.name, email: spec.email, phone: spec.phone, timezone: IST },
      }),
    );
  }

  // ── Holidays and time off ─────────────────────────────────────────────────
  const today = toDateKey(new Date(), IST);
  await prisma.holiday.createMany({
    data: [
      { name: 'Gandhi Jayanti', date: new Date('2026-10-02T00:00:00Z') },
      { name: 'Diwali', date: new Date('2026-11-08T00:00:00Z') },
      { name: 'Christmas Day', date: new Date('2026-12-25T00:00:00Z') },
    ],
  });

  // Dr Shah takes a few days off next week, so the effect is visible in the booking UI.
  const leaveStart = addDaysToDateKey(today, 9);
  const leaveEnd = addDaysToDateKey(today, 12);
  await prisma.timeOff.create({
    data: {
      providerId: providers[1]!.id,
      type: 'VACATION',
      startsAt: at(leaveStart, '00:00'),
      endsAt: at(leaveEnd, '00:00'),
      isAllDay: true,
      reason: 'Annual leave',
    },
  });

  // A single afternoon blocked out for a departmental meeting.
  const meetingDay = addDaysToDateKey(today, 3);
  await prisma.timeOff.create({
    data: {
      providerId: providers[0]!.id,
      type: 'BLOCKED',
      startsAt: at(meetingDay, '15:00'),
      endsAt: at(meetingDay, '17:00'),
      reason: 'Clinical governance meeting',
    },
  });

  // A date override: shorter hours on one specific day.
  const shortDay = addDaysToDateKey(today, 5);
  await prisma.availabilityOverride.create({
    data: {
      providerId: providers[0]!.id,
      date: new Date(`${shortDay}T00:00:00Z`),
      type: 'CUSTOM_HOURS',
      reason: 'Conference in the morning',
      windows: { create: [{ startMinute: H(14), endMinute: H(18) }] },
    },
  });

  // ── Appointments ──────────────────────────────────────────────────────────
  // A realistic mix so the dashboard, analytics and history views have something to show.
  let sequence = 1;
  const code = (): string => `APT-2026-${String(sequence++).padStart(6, '0')}`;

  async function book(params: {
    dateKey: string;
    wall: string;
    serviceIdx: number;
    providerIdx: number;
    customerIdx: number;
    status: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'PENDING';
    notes?: string;
    cancellationReason?: string;
  }) {
    const service = services[params.serviceIdx]!;
    const provider = providers[params.providerIdx]!;
    const customer = customers[params.customerIdx]!;
    const startsAt = at(params.dateKey, params.wall, provider.timezone);
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

    const appointment = await prisma.appointment.create({
      data: {
        code: code(),
        status: params.status,
        serviceId: service.id,
        providerId: provider.id,
        customerId: customer.id,
        startsAt,
        endsAt,
        // Overwritten by the database trigger; supplied only to satisfy the NOT NULL.
        blockStartsAt: startsAt,
        blockEndsAt: endsAt,
        timezone: customer.timezone,
        serviceName: service.name,
        durationMin: service.durationMin,
        bufferBeforeMin: service.bufferBeforeMin,
        bufferAfterMin: service.bufferAfterMin,
        priceMinor: service.priceMinor,
        currency: service.currency,
        paymentMode: service.paymentMode,
        providerName: provider.name,
        locationType: service.locationType,
        locationDetail: service.locationDetail,
        customerNotes: params.notes ?? null,
        rootAppointmentId: '00000000-0000-0000-0000-000000000000',
        confirmedAt: params.status === 'PENDING' ? null : startsAt,
        completedAt: params.status === 'COMPLETED' ? endsAt : null,
        cancelledAt: params.status === 'CANCELLED' ? new Date() : null,
        cancelledByType: params.status === 'CANCELLED' ? 'CUSTOMER' : null,
        cancellationCode: params.status === 'CANCELLED' ? 'SCHEDULE_CONFLICT' : null,
        cancellationReason: params.cancellationReason ?? null,
        createdByType: 'CUSTOMER',
      },
    });

    // Self-rooted: the chain identity of an appointment that has never been moved.
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { rootAppointmentId: appointment.id },
    });

    await prisma.appointmentHistory.create({
      data: {
        appointmentId: appointment.id,
        action: 'CREATED',
        toStatus: params.status,
        actorType: 'CUSTOMER',
        actorLabel: customer.name,
      },
    });

    return appointment;
  }

  // Past: completed, plus one no-show and one cancellation.
  await book({ dateKey: addDaysToDateKey(today, -14), wall: '10:00', serviceIdx: 0, providerIdx: 0, customerIdx: 0, status: 'COMPLETED', notes: 'Recurring headaches, worse in the evening.' });
  await book({ dateKey: addDaysToDateKey(today, -10), wall: '11:30', serviceIdx: 2, providerIdx: 0, customerIdx: 1, status: 'COMPLETED' });
  await book({ dateKey: addDaysToDateKey(today, -8), wall: '15:00', serviceIdx: 0, providerIdx: 1, customerIdx: 2, status: 'NO_SHOW' });
  await book({ dateKey: addDaysToDateKey(today, -6), wall: '12:00', serviceIdx: 1, providerIdx: 0, customerIdx: 3, status: 'CANCELLED', cancellationReason: 'Work travel came up' });
  await book({ dateKey: addDaysToDateKey(today, -3), wall: '09:30', serviceIdx: 3, providerIdx: 1, customerIdx: 1, status: 'COMPLETED' });
  await book({ dateKey: addDaysToDateKey(today, -2), wall: '16:00', serviceIdx: 2, providerIdx: 0, customerIdx: 0, status: 'COMPLETED' });

  // Upcoming.
  await book({ dateKey: addDaysToDateKey(today, 1), wall: '10:00', serviceIdx: 0, providerIdx: 0, customerIdx: 1, status: 'CONFIRMED', notes: 'Follow-up on blood test results.' });
  await book({ dateKey: addDaysToDateKey(today, 1), wall: '14:30', serviceIdx: 2, providerIdx: 0, customerIdx: 2, status: 'CONFIRMED' });
  await book({ dateKey: addDaysToDateKey(today, 2), wall: '11:00', serviceIdx: 3, providerIdx: 1, customerIdx: 0, status: 'CONFIRMED' });
  await book({ dateKey: addDaysToDateKey(today, 4), wall: '12:00', serviceIdx: 1, providerIdx: 0, customerIdx: 3, status: 'CONFIRMED' });
  await book({ dateKey: addDaysToDateKey(today, 7), wall: '15:30', serviceIdx: 0, providerIdx: 1, customerIdx: 1, status: 'CONFIRMED' });

  // ── Notification templates ────────────────────────────────────────────────
  await prisma.notificationTemplate.createMany({
    data: [
      {
        event: 'BOOKING_CONFIRMED',
        channel: 'EMAIL',
        recipient: 'CUSTOMER',
        subject: 'Your appointment is confirmed — {{serviceName}} on {{date}}',
        body: 'Hello {{customerName}},\n\nYour {{serviceName}} with {{providerName}} is confirmed for {{date}} at {{time}} ({{timezone}}).\n\nBooking reference: {{code}}\n\n{{cancellationPolicy}}\n\nManage your booking: {{manageUrl}}',
      },
      {
        event: 'BOOKING_CANCELLED',
        channel: 'EMAIL',
        recipient: 'CUSTOMER',
        subject: 'Your appointment on {{date}} has been cancelled',
        body: 'Hello {{customerName}},\n\nYour {{serviceName}} with {{providerName}} on {{date}} at {{time}} has been cancelled.\n\nBooking reference: {{code}}',
      },
      {
        event: 'BOOKING_RESCHEDULED',
        channel: 'EMAIL',
        recipient: 'CUSTOMER',
        subject: 'Your appointment has moved to {{date}}',
        body: 'Hello {{customerName}},\n\nYour {{serviceName}} with {{providerName}} is now on {{date}} at {{time}} ({{timezone}}).\n\nBooking reference: {{code}}',
      },
      {
        event: 'APPOINTMENT_REMINDER',
        channel: 'EMAIL',
        recipient: 'CUSTOMER',
        subject: 'Reminder: {{serviceName}} on {{date}}',
        body: 'Hello {{customerName}},\n\nThis is a reminder of your {{serviceName}} with {{providerName}} on {{date}} at {{time}} ({{timezone}}).\n\n{{locationDetail}}',
      },
      {
        event: 'BOOKING_CREATED',
        channel: 'EMAIL',
        recipient: 'PROVIDER',
        subject: 'New booking: {{customerName}} on {{date}}',
        body: '{{customerName}} booked {{serviceName}} for {{date}} at {{time}}.\n\nReference: {{code}}',
      },
    ],
  });

  const counts = {
    users: await prisma.user.count(),
    providers: await prisma.provider.count(),
    services: await prisma.service.count(),
    customers: await prisma.customer.count(),
    appointments: await prisma.appointment.count(),
    availabilityRules: await prisma.availabilityRule.count(),
  };

  console.info('Seed complete:', counts);
  console.info(`\nDemo sign-in (password for all accounts: ${DEMO_PASSWORD})`);
  console.info('  Admin     admin@example.com');
  console.info('  Provider  provider@example.com');
  console.info('  Customer  customer@example.com\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
