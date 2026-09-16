import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ActorType,
  AppointmentStatus,
  CancellationReasonCode,
  ErrorCode,
  dateOnlySchema,
  emailSchema,
  enumOf,
  instantSchema,
  paginationSchema,
  phoneSchema,
  timezoneSchema,
  uuidSchema,
} from '@booking/shared';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { ok, created, paginated } from '../lib/http.js';
import { clock } from '../lib/clock.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth, requireAuth, requirePermission } from '../middleware/auth.js';
import { bookingLimiter } from '../middleware/rate-limit.js';
import { PERMISSIONS } from '../config/permissions.js';
import { addDaysToDateKey, toDateKey } from '../domain/time/zone.js';
import { findAvailableDates, findSlots } from './slots/slots.service.js';
import {
  cancelBooking,
  createBooking,
  hashManageToken,
  markOutcome,
  rescheduleBooking,
} from './appointments/booking.service.js';

export const apiRouter = Router();

/** Express 5 types route params loosely; validation has already narrowed them to strings. */
const param = (req: Request, key: string): string => String(req.params[key] ?? '');

// ─────────────────────────────────────────────────────────────────────────────
// Catalog — public reads, admin writes
// ─────────────────────────────────────────────────────────────────────────────

apiRouter.get('/services', async (_req: Request, res: Response) => {
  const services = await prisma.service.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      cancellationPolicy: true,
      providers: {
        where: { provider: { isActive: true, deletedAt: null } },
        include: { provider: { include: { user: { select: { name: true } } } } },
      },
    },
  });

  ok(
    res,
    services.map((service) => ({
      id: service.id,
      name: service.name,
      slug: service.slug,
      description: service.description,
      category: service.category,
      durationMin: service.durationMin,
      priceMinor: service.priceMinor,
      currency: service.currency,
      locationType: service.locationType,
      locationDetail: service.locationDetail,
      color: service.color,
      minNoticeMin: service.minNoticeMin,
      maxAdvanceDays: service.maxAdvanceDays,
      cancellationPolicy: service.cancellationPolicy
        ? {
            description: service.cancellationPolicy.description,
            allowCancellation: service.cancellationPolicy.allowCancellation,
            cancellationDeadlineMin: service.cancellationPolicy.cancellationDeadlineMin,
            allowReschedule: service.cancellationPolicy.allowReschedule,
            rescheduleDeadlineMin: service.cancellationPolicy.rescheduleDeadlineMin,
          }
        : null,
      providers: service.providers.map((link) => ({
        id: link.providerId,
        name: link.provider.user.name,
        title: link.provider.title,
        timezone: link.provider.timezone,
      })),
    })),
  );
});

apiRouter.get(
  '/services/:slug',
  validate({ params: z.object({ slug: z.string().min(1) }) }),
  async (req: Request, res: Response) => {
    const service = await prisma.service.findFirst({
      where: { slug: param(req, 'slug'), deletedAt: null },
      include: {
        cancellationPolicy: true,
        questions: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        providers: {
          where: { provider: { isActive: true, deletedAt: null } },
          include: { provider: { include: { user: { select: { name: true } } } } },
        },
      },
    });
    if (!service) throw new AppError(ErrorCode.SERVICE_NOT_FOUND);

    ok(res, {
      ...service,
      providers: service.providers.map((link) => ({
        id: link.providerId,
        name: link.provider.user.name,
        title: link.provider.title,
        bio: link.provider.bio,
        timezone: link.provider.timezone,
      })),
    });
  },
);

apiRouter.get('/providers', async (_req: Request, res: Response) => {
  const providers = await prisma.provider.findMany({
    where: { isActive: true, deletedAt: null },
    include: {
      user: { select: { name: true, email: true, avatarUrl: true } },
      services: { include: { service: { select: { id: true, name: true, slug: true } } } },
    },
  });

  ok(
    res,
    providers.map((provider) => ({
      id: provider.id,
      name: provider.user.name,
      email: provider.user.email,
      slug: provider.slug,
      title: provider.title,
      bio: provider.bio,
      timezone: provider.timezone,
      avatarUrl: provider.user.avatarUrl,
      services: provider.services.map((link) => link.service),
    })),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Slots — the backend is the sole source of truth; nothing here is computed client-side
// ─────────────────────────────────────────────────────────────────────────────

const slotQuerySchema = z
  .object({
    serviceId: uuidSchema,
    providerId: uuidSchema.optional(),
    from: dateOnlySchema,
    to: dateOnlySchema.optional(),
    timezone: timezoneSchema.default('Asia/Kolkata'),
  })
  .refine((value) => !value.to || value.to >= value.from, {
    message: 'The end date must not precede the start date',
    path: ['to'],
  });

apiRouter.get(
  '/availability/slots',
  optionalAuth,
  validate({ query: slotQuerySchema }),
  async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof slotQuerySchema>;
    const result = await findSlots({
      serviceId: query.serviceId,
      providerId: query.providerId ?? null,
      from: query.from,
      // A single date by default; the range form powers the month calendar.
      to: query.to ?? query.from,
      timezone: query.timezone,
      now: clock.now(),
      customerId: req.user?.customerId ?? null,
    });
    ok(res, result);
  },
);

apiRouter.get(
  '/availability/dates',
  optionalAuth,
  validate({ query: slotQuerySchema }),
  async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof slotQuerySchema>;
    const result = await findAvailableDates({
      serviceId: query.serviceId,
      providerId: query.providerId ?? null,
      from: query.from,
      to: query.to ?? addDaysToDateKey(query.from, 30),
      timezone: query.timezone,
      now: clock.now(),
      customerId: req.user?.customerId ?? null,
    });
    ok(res, result);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Appointments
// ─────────────────────────────────────────────────────────────────────────────

const createBookingSchema = z.object({
  serviceId: uuidSchema,
  providerId: uuidSchema.optional(),
  startsAt: instantSchema,
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: emailSchema,
    phone: phoneSchema.optional(),
    timezone: timezoneSchema.default('Asia/Kolkata'),
  }),
  notes: z.string().max(2000).optional(),
  answers: z
    .array(z.object({ questionId: uuidSchema, value: z.string().max(2000) }))
    .max(20)
    .optional(),
});

function appointmentView(appointment: {
  id: string;
  code: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  serviceName: string;
  providerName: string;
  durationMin: number;
  priceMinor: number;
  currency: string;
  locationType: string;
  locationDetail: string | null;
  customerNotes: string | null;
}) {
  return {
    id: appointment.id,
    code: appointment.code,
    status: appointment.status,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    timezone: appointment.timezone,
    serviceName: appointment.serviceName,
    providerName: appointment.providerName,
    durationMin: appointment.durationMin,
    priceMinor: appointment.priceMinor,
    currency: appointment.currency,
    locationType: appointment.locationType,
    locationDetail: appointment.locationDetail,
    notes: appointment.customerNotes,
  };
}

apiRouter.post(
  '/appointments',
  bookingLimiter,
  optionalAuth,
  validate({ body: createBookingSchema }),
  async (req: Request, res: Response) => {
    const input = req.body as z.infer<typeof createBookingSchema>;

    const result = await createBooking({
      serviceId: input.serviceId,
      providerId: input.providerId ?? null,
      startsAt: new Date(input.startsAt),
      customer: {
        name: input.customer.name,
        email: input.customer.email,
        phone: input.customer.phone ?? null,
        timezone: input.customer.timezone,
      },
      customerNotes: input.notes ?? null,
      answers: input.answers,
      actorType: req.user ? ActorType.CUSTOMER : ActorType.CUSTOMER,
      actorUserId: req.user?.id ?? null,
      now: clock.now(),
    });

    created(
      res,
      {
        appointment: appointmentView(result.appointment),
        // Returned once, never stored in plain form. It is how a guest manages their
        // booking without us exposing the appointment id.
        manageToken: result.manageToken,
      },
      'Appointment confirmed',
    );
  },
);

const listQuerySchema = paginationSchema.extend({
  status: enumOf(AppointmentStatus).optional(),
  providerId: uuidSchema.optional(),
  serviceId: uuidSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  search: z.string().max(120).optional(),
});

apiRouter.get(
  '/appointments',
  requireAuth,
  requirePermission(PERMISSIONS.APPOINTMENTS_READ),
  validate({ query: listQuerySchema }),
  async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    const user = req.user!;

    // Ownership is enforced here, not in the UI: a provider sees only their own
    // calendar, a customer only their own bookings, regardless of what they ask for.
    const scope =
      user.role === 'ADMIN'
        ? {}
        : user.providerId
          ? { providerId: user.providerId }
          : { customerId: user.customerId ?? '__none__' };

    const where = {
      ...scope,
      ...(query.status ? { status: query.status } : {}),
      ...(query.providerId && user.role === 'ADMIN' ? { providerId: query.providerId } : {}),
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.from || query.to
        ? {
            startsAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
              ...(query.to ? { lt: new Date(`${addDaysToDateKey(query.to, 1)}T00:00:00Z`) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' as const } },
              { serviceName: { contains: query.search, mode: 'insensitive' as const } },
              { customer: { name: { contains: query.search, mode: 'insensitive' as const } } },
              { customer: { email: { contains: query.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { customer: { select: { name: true, email: true, phone: true } } },
      }),
      prisma.appointment.count({ where }),
    ]);

    paginated(
      res,
      items.map((appointment) => ({
        ...appointmentView(appointment),
        customer: appointment.customer,
        providerId: appointment.providerId,
        serviceId: appointment.serviceId,
        createdAt: appointment.createdAt.toISOString(),
      })),
      query.page,
      query.pageSize,
      total,
    );
  },
);

/** Guest access: the manage token from the confirmation email, not the appointment id. */
apiRouter.get(
  '/appointments/token/:token',
  validate({ params: z.object({ token: z.string().min(20).max(200) }) }),
  async (req: Request, res: Response) => {
    const appointment = await prisma.appointment.findUnique({
      where: { manageTokenHash: hashManageToken(param(req, 'token')) },
      include: {
        service: { include: { cancellationPolicy: true } },
        history: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!appointment) throw new AppError(ErrorCode.APPOINTMENT_NOT_FOUND);
    if (appointment.manageTokenExpiresAt && appointment.manageTokenExpiresAt < clock.now()) {
      throw new AppError(ErrorCode.TOKEN_EXPIRED);
    }

    ok(res, {
      appointment: appointmentView(appointment),
      serviceId: appointment.serviceId,
      providerId: appointment.providerId,
      cancellationPolicy: appointment.service.cancellationPolicy,
      history: appointment.history.map((entry) => ({
        action: entry.action,
        at: entry.createdAt.toISOString(),
        actorType: entry.actorType,
      })),
    });
  },
);

const cancelSchema = z.object({
  token: z.string().min(20).max(200).optional(),
  reasonCode: enumOf(CancellationReasonCode).optional(),
  reason: z.string().max(1000).optional(),
});

apiRouter.post(
  '/appointments/:id/cancel',
  optionalAuth,
  validate({ params: z.object({ id: uuidSchema }), body: cancelSchema }),
  async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof cancelSchema>;
    const user = req.user;

    // Either a signed-in user with the capability, or the bearer of the manage token.
    let actorType: ActorType = ActorType.CUSTOMER;
    let enforceDeadline = true;

    if (user && (user.role === 'ADMIN' || user.providerId)) {
      actorType = user.role === 'ADMIN' ? ActorType.ADMIN : ActorType.PROVIDER;
      enforceDeadline = false;
    } else {
      const appointment = await prisma.appointment.findUnique({
        where: { id: param(req, 'id') },
        select: { manageTokenHash: true, customerId: true },
      });
      if (!appointment) throw new AppError(ErrorCode.APPOINTMENT_NOT_FOUND);

      const tokenMatches =
        body.token && appointment.manageTokenHash === hashManageToken(body.token);
      const ownsIt = user?.customerId && user.customerId === appointment.customerId;
      if (!tokenMatches && !ownsIt) throw new AppError(ErrorCode.FORBIDDEN);
    }

    const updated = await cancelBooking({
      appointmentId: param(req, 'id'),
      actorType,
      actorUserId: user?.id ?? null,
      reasonCode: body.reasonCode ?? null,
      reason: body.reason ?? null,
      now: clock.now(),
      enforceDeadline,
    });

    ok(res, { appointment: appointmentView(updated) }, 'Appointment cancelled');
  },
);

const rescheduleSchema = z.object({
  startsAt: instantSchema,
  token: z.string().min(20).max(200).optional(),
});

apiRouter.post(
  '/appointments/:id/reschedule',
  optionalAuth,
  validate({ params: z.object({ id: uuidSchema }), body: rescheduleSchema }),
  async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof rescheduleSchema>;
    const user = req.user;

    let actorType: ActorType = ActorType.CUSTOMER;
    let enforceDeadline = true;

    if (user && (user.role === 'ADMIN' || user.providerId)) {
      actorType = user.role === 'ADMIN' ? ActorType.ADMIN : ActorType.PROVIDER;
      enforceDeadline = false;
    } else {
      const appointment = await prisma.appointment.findUnique({
        where: { id: param(req, 'id') },
        select: { manageTokenHash: true, customerId: true },
      });
      if (!appointment) throw new AppError(ErrorCode.APPOINTMENT_NOT_FOUND);
      const tokenMatches =
        body.token && appointment.manageTokenHash === hashManageToken(body.token);
      const ownsIt = user?.customerId && user.customerId === appointment.customerId;
      if (!tokenMatches && !ownsIt) throw new AppError(ErrorCode.FORBIDDEN);
    }

    const result = await rescheduleBooking({
      appointmentId: param(req, 'id'),
      newStartsAt: new Date(body.startsAt),
      actorType,
      actorUserId: user?.id ?? null,
      now: clock.now(),
      enforceDeadline,
    });

    ok(
      res,
      { appointment: appointmentView(result.appointment), manageToken: result.manageToken },
      'Appointment rescheduled',
    );
  },
);

apiRouter.post(
  '/appointments/:id/outcome',
  requireAuth,
  requirePermission(PERMISSIONS.APPOINTMENTS_COMPLETE),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({ outcome: z.enum(['COMPLETED', 'NO_SHOW']) }),
  }),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const updated = await markOutcome({
      appointmentId: param(req, 'id'),
      outcome: req.body.outcome,
      actorType: user.role === 'ADMIN' ? ActorType.ADMIN : ActorType.PROVIDER,
      actorUserId: user.id,
      now: clock.now(),
    });
    ok(res, { appointment: appointmentView(updated) }, 'Appointment updated');
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

apiRouter.get(
  '/analytics/summary',
  requireAuth,
  requirePermission(PERMISSIONS.ANALYTICS_READ),
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) }),
  async (req: Request, res: Response) => {
    const days = Number((req.query as unknown as { days: number }).days);
    const now = clock.now();
    const since = new Date(now.getTime() - days * 86_400_000);

    const [grouped, revenue, byService, todayCount] = await Promise.all([
      prisma.appointment.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      prisma.appointment.aggregate({
        where: { status: 'COMPLETED', startsAt: { gte: since } },
        _sum: { priceMinor: true },
      }),
      prisma.appointment.groupBy({
        by: ['serviceName'],
        where: { createdAt: { gte: since } },
        _count: true,
        orderBy: { _count: { serviceName: 'desc' } },
        take: 5,
      }),
      prisma.appointment.count({
        where: {
          startsAt: {
            gte: new Date(`${toDateKey(now, 'Asia/Kolkata')}T00:00:00Z`),
            lt: new Date(`${addDaysToDateKey(toDateKey(now, 'Asia/Kolkata'), 1)}T00:00:00Z`),
          },
          status: { in: ['CONFIRMED', 'PENDING'] },
        },
      }),
    ]);

    const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count]));
    const total = grouped.reduce((sum, row) => sum + row._count, 0);
    const cancelled = counts.CANCELLED ?? 0;

    ok(res, {
      rangeDays: days,
      today: todayCount,
      total,
      confirmed: counts.CONFIRMED ?? 0,
      completed: counts.COMPLETED ?? 0,
      cancelled,
      noShow: counts.NO_SHOW ?? 0,
      pending: counts.PENDING ?? 0,
      cancellationRate: total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0,
      revenueMinor: revenue._sum.priceMinor ?? 0,
      averagePerDay: Math.round((total / days) * 10) / 10,
      popularServices: byService.map((row) => ({ name: row.serviceName, count: row._count })),
    });
  },
);

apiRouter.get(
  '/analytics/timeseries',
  requireAuth,
  requirePermission(PERMISSIONS.ANALYTICS_READ),
  validate({ query: z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }) }),
  async (req: Request, res: Response) => {
    const days = Number((req.query as unknown as { days: number }).days);
    const since = new Date(clock.now().getTime() - days * 86_400_000);

    const appointments = await prisma.appointment.findMany({
      where: { startsAt: { gte: since } },
      select: { startsAt: true, status: true, priceMinor: true },
    });

    const buckets = new Map<string, { date: string; booked: number; cancelled: number; revenue: number }>();
    for (const appointment of appointments) {
      const key = toDateKey(appointment.startsAt, 'Asia/Kolkata');
      const bucket = buckets.get(key) ?? { date: key, booked: 0, cancelled: 0, revenue: 0 };
      if (appointment.status === 'CANCELLED') bucket.cancelled += 1;
      else bucket.booked += 1;
      if (appointment.status === 'COMPLETED') bucket.revenue += appointment.priceMinor;
      buckets.set(key, bucket);
    }

    ok(res, [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)));
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Availability management
// ─────────────────────────────────────────────────────────────────────────────

apiRouter.get(
  '/providers/:id/availability',
  requireAuth,
  requirePermission(PERMISSIONS.AVAILABILITY_READ),
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: Request, res: Response) => {
    const [rules, overrides, timeOff, provider] = await Promise.all([
      prisma.availabilityRule.findMany({
        where: { providerId: param(req, 'id') },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      }),
      prisma.availabilityOverride.findMany({
        where: { providerId: param(req, 'id'), date: { gte: clock.now() } },
        include: { windows: true },
        orderBy: { date: 'asc' },
      }),
      prisma.timeOff.findMany({
        where: { providerId: param(req, 'id'), endsAt: { gte: clock.now() } },
        orderBy: { startsAt: 'asc' },
      }),
      prisma.provider.findUnique({ where: { id: param(req, 'id') } }),
    ]);
    if (!provider) throw new AppError(ErrorCode.PROVIDER_NOT_FOUND);

    ok(res, { timezone: provider.timezone, rules, overrides, timeOff });
  },
);

const weeklyRulesSchema = z.object({
  rules: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1440),
        endMinute: z.number().int().min(0).max(1440),
      }),
    )
    .max(50)
    .refine(
      (rules) => rules.every((rule) => rule.endMinute > rule.startMinute),
      'Each window must end after it starts',
    ),
});

apiRouter.put(
  '/providers/:id/availability',
  requireAuth,
  requirePermission(PERMISSIONS.AVAILABILITY_MANAGE),
  validate({ params: z.object({ id: uuidSchema }), body: weeklyRulesSchema }),
  async (req: Request, res: Response) => {
    const user = req.user!;
    // A provider may only edit their own hours; an admin may edit anyone's.
    if (user.role !== 'ADMIN' && user.providerId !== param(req, 'id')) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }

    const body = req.body as z.infer<typeof weeklyRulesSchema>;
    const providerId = param(req, 'id');

    await prisma.$transaction([
      prisma.availabilityRule.deleteMany({ where: { providerId } }),
      prisma.availabilityRule.createMany({
        data: body.rules.map((rule) => ({ providerId, ...rule })),
      }),
    ]);

    ok(res, { count: body.rules.length }, 'Working hours updated');
  },
);

const timeOffSchema = z.object({
  type: z.enum(['VACATION', 'SICK_LEAVE', 'PERSONAL', 'HOLIDAY', 'BLOCKED']),
  startsAt: instantSchema,
  endsAt: instantSchema,
  isAllDay: z.boolean().default(false),
  reason: z.string().max(500).optional(),
});

apiRouter.post(
  '/providers/:id/time-off',
  requireAuth,
  requirePermission(PERMISSIONS.TIMEOFF_MANAGE),
  validate({ params: z.object({ id: uuidSchema }), body: timeOffSchema }),
  async (req: Request, res: Response) => {
    const user = req.user!;
    if (user.role !== 'ADMIN' && user.providerId !== param(req, 'id')) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }

    const body = req.body as z.infer<typeof timeOffSchema>;
    if (new Date(body.endsAt) <= new Date(body.startsAt)) {
      throw new AppError(ErrorCode.INVALID_DATE_RANGE, 'Time off must end after it starts.');
    }

    const entry = await prisma.timeOff.create({
      data: {
        providerId: param(req, 'id'),
        type: body.type,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        isAllDay: body.isAllDay,
        reason: body.reason ?? null,
      },
    });

    created(res, entry, 'Time off added');
  },
);

apiRouter.delete(
  '/time-off/:id',
  requireAuth,
  requirePermission(PERMISSIONS.TIMEOFF_MANAGE),
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: Request, res: Response) => {
    const entry = await prisma.timeOff.findUnique({ where: { id: param(req, 'id') } });
    if (!entry) throw new AppError(ErrorCode.NOT_FOUND);

    const user = req.user!;
    if (user.role !== 'ADMIN' && user.providerId !== entry.providerId) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }

    await prisma.timeOff.delete({ where: { id: param(req, 'id') } });
    ok(res, { deleted: true }, 'Time off removed');
  },
);

apiRouter.get('/holidays', async (_req: Request, res: Response) => {
  ok(res, await prisma.holiday.findMany({ orderBy: { date: 'asc' } }));
});

apiRouter.get(
  '/audit-logs',
  requireAuth,
  requirePermission(PERMISSIONS.AUDIT_READ),
  validate({ query: paginationSchema }),
  async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof paginationSchema>;
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.auditLog.count(),
    ]);
    paginated(res, items, query.page, query.pageSize, total);
  },
);
