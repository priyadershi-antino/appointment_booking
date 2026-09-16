import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import {
  ErrorCode,
  bookingQuestionSchema,
  holidaySchema,
  providerCreateSchema,
  providerUpdateSchema,
  serviceUpdateSchema,
  serviceWriteSchema,
  staffCreateSchema,
  uuidSchema,
} from '@booking/shared';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { ok, created, noContent } from '../lib/http.js';
import { clock } from '../lib/clock.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../config/permissions.js';

export const adminRouter = Router();

const param = (req: Request, key: string): string => String(req.params[key] ?? '');

/** Every write here is performed by a signed-in staff member; record who. */
async function audit(
  req: Request,
  action: string,
  entity: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const user = req.user;
  await prisma.auditLog.create({
    data: {
      actorUserId: user?.id ?? null,
      actorType: user?.role === 'ADMIN' ? 'ADMIN' : user?.providerId ? 'PROVIDER' : 'SYSTEM',
      action,
      entity,
      entityId,
      metadata: metadata ? (metadata as object) : undefined,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    },
  });
}

/**
 * URL-safe slug, made unique by suffixing rather than failing.
 *
 * An admin naming a second service "Follow-up" should not be met with a constraint error
 * about a column they never filled in.
 */
async function uniqueSlug(base: string, table: 'service' | 'provider', ignoreId?: string): Promise<string> {
  const root =
    base
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item';

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? root : `${root}-${suffix + 1}`;
    const existing =
      table === 'service'
        ? await prisma.service.findUnique({ where: { slug: candidate }, select: { id: true } })
        : await prisma.provider.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === ignoreId) return candidate;
  }
  return `${root}-${clock.now().getTime()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────────────────────────────────────

/** Admin listing — includes inactive services, which the public endpoint hides. */
adminRouter.get(
  '/services',
  requireAuth,
  requirePermission(PERMISSIONS.SERVICES_READ),
  async (_req: Request, res: Response) => {
    const services = await prisma.service.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        cancellationPolicy: { select: { id: true, name: true, description: true } },
        questions: { orderBy: { sortOrder: 'asc' } },
        providers: { select: { providerId: true } },
        _count: { select: { appointments: true } },
      },
    });

    ok(
      res,
      services.map((service) => ({
        ...service,
        providerIds: service.providers.map((link) => link.providerId),
        appointmentCount: service._count.appointments,
      })),
    );
  },
);

adminRouter.post(
  '/services',
  requireAuth,
  requirePermission(PERMISSIONS.SERVICES_CREATE),
  validate({ body: serviceWriteSchema }),
  async (req: Request, res: Response) => {
    const input = req.body as z.infer<typeof serviceWriteSchema>;
    const slug = await uniqueSlug(input.slug ?? input.name, 'service');

    const service = await prisma.service.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        category: input.category ?? null,
        durationMin: input.durationMin,
        bufferBeforeMin: input.bufferBeforeMin,
        bufferAfterMin: input.bufferAfterMin,
        slotIntervalMin: input.slotIntervalMin,
        priceMinor: input.priceMinor,
        currency: input.currency,
        paymentMode: input.paymentMode,
        locationType: input.locationType,
        locationDetail: input.locationDetail ?? null,
        minNoticeMin: input.minNoticeMin,
        maxAdvanceDays: input.maxAdvanceDays,
        maxPerDay: input.maxPerDay ?? null,
        maxPerCustomerPerDay: input.maxPerCustomerPerDay,
        color: input.color ?? null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        cancellationPolicyId: input.cancellationPolicyId ?? null,
        providers: { create: input.providerIds.map((providerId) => ({ providerId })) },
      },
    });

    await audit(req, 'service.created', 'Service', service.id, { name: service.name });
    created(res, service, 'Service created');
  },
);

adminRouter.patch(
  '/services/:id',
  requireAuth,
  requirePermission(PERMISSIONS.SERVICES_UPDATE),
  validate({ params: z.object({ id: uuidSchema }), body: serviceUpdateSchema }),
  async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const input = req.body as z.infer<typeof serviceUpdateSchema>;

    const existing = await prisma.service.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError(ErrorCode.SERVICE_NOT_FOUND);

    // Note this does NOT touch existing appointments: they carry their own snapshot of
    // name, duration, buffers and price, so changing the catalog never rewrites history.
    const service = await prisma.$transaction(async (tx) => {
      if (input.providerIds) {
        await tx.serviceProvider.deleteMany({ where: { serviceId: id } });
        await tx.serviceProvider.createMany({
          data: input.providerIds.map((providerId) => ({ serviceId: id, providerId })),
        });
      }

      return tx.service.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: await uniqueSlug(input.slug, 'service', id) } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
          ...(input.bufferBeforeMin !== undefined ? { bufferBeforeMin: input.bufferBeforeMin } : {}),
          ...(input.bufferAfterMin !== undefined ? { bufferAfterMin: input.bufferAfterMin } : {}),
          ...(input.slotIntervalMin !== undefined ? { slotIntervalMin: input.slotIntervalMin } : {}),
          ...(input.priceMinor !== undefined ? { priceMinor: input.priceMinor } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.paymentMode !== undefined ? { paymentMode: input.paymentMode } : {}),
          ...(input.locationType !== undefined ? { locationType: input.locationType } : {}),
          ...(input.locationDetail !== undefined ? { locationDetail: input.locationDetail } : {}),
          ...(input.minNoticeMin !== undefined ? { minNoticeMin: input.minNoticeMin } : {}),
          ...(input.maxAdvanceDays !== undefined ? { maxAdvanceDays: input.maxAdvanceDays } : {}),
          ...(input.maxPerDay !== undefined ? { maxPerDay: input.maxPerDay } : {}),
          ...(input.maxPerCustomerPerDay !== undefined
            ? { maxPerCustomerPerDay: input.maxPerCustomerPerDay }
            : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.cancellationPolicyId !== undefined
            ? { cancellationPolicyId: input.cancellationPolicyId }
            : {}),
        },
      });
    });

    await audit(req, 'service.updated', 'Service', id, { fields: Object.keys(input) });
    ok(res, service, 'Service updated');
  },
);

/**
 * Soft delete only.
 *
 * A service with appointments against it must keep existing: the rows reference it, and
 * deleting would either cascade real history away or fail on a foreign key. Deactivating
 * takes it out of the booking page while leaving every past appointment intact.
 */
adminRouter.delete(
  '/services/:id',
  requireAuth,
  requirePermission(PERMISSIONS.SERVICES_DELETE),
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const service = await prisma.service.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { appointments: true } } },
    });
    if (!service) throw new AppError(ErrorCode.SERVICE_NOT_FOUND);

    await prisma.service.update({
      where: { id },
      data: {
        isActive: false,
        // Only fully retire it when nothing references it; otherwise deactivate and keep
        // it resolvable so historical appointments still render.
        deletedAt: service._count.appointments === 0 ? clock.now() : null,
      },
    });

    await audit(req, 'service.deactivated', 'Service', id, {
      appointmentCount: service._count.appointments,
    });
    ok(
      res,
      { deactivated: true, retained: service._count.appointments > 0 },
      service._count.appointments > 0
        ? 'Service deactivated. Existing appointments are unaffected.'
        : 'Service removed.',
    );
  },
);

/* Booking questions, nested under their service. */

adminRouter.post(
  '/services/:id/questions',
  requireAuth,
  requirePermission(PERMISSIONS.SERVICES_UPDATE),
  validate({ params: z.object({ id: uuidSchema }), body: bookingQuestionSchema }),
  async (req: Request, res: Response) => {
    const serviceId = param(req, 'id');
    const question = await prisma.bookingQuestion.create({
      data: { serviceId, ...(req.body as z.infer<typeof bookingQuestionSchema>) },
    });
    await audit(req, 'question.created', 'BookingQuestion', question.id, { serviceId });
    created(res, question, 'Question added');
  },
);

adminRouter.delete(
  '/questions/:id',
  requireAuth,
  requirePermission(PERMISSIONS.SERVICES_UPDATE),
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: Request, res: Response) => {
    const id = param(req, 'id');
    // Answers reference the question, so retire it rather than deleting the evidence of
    // what a customer was actually asked.
    await prisma.bookingQuestion.update({ where: { id }, data: { isActive: false } });
    await audit(req, 'question.removed', 'BookingQuestion', id);
    noContent(res);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Providers
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.get(
  '/providers',
  requireAuth,
  requirePermission(PERMISSIONS.PROVIDERS_READ),
  async (_req: Request, res: Response) => {
    const providers = await prisma.provider.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { name: true, email: true, phone: true, isActive: true } },
        services: { select: { serviceId: true } },
        _count: { select: { appointments: true, availabilityRules: true } },
      },
    });

    ok(
      res,
      providers.map((provider) => ({
        id: provider.id,
        name: provider.user.name,
        email: provider.user.email,
        phone: provider.user.phone,
        slug: provider.slug,
        title: provider.title,
        bio: provider.bio,
        timezone: provider.timezone,
        isActive: provider.isActive,
        serviceIds: provider.services.map((link) => link.serviceId),
        appointmentCount: provider._count.appointments,
        availabilityRuleCount: provider._count.availabilityRules,
      })),
    );
  },
);

/**
 * Onboards a provider: creates the sign-in account and the profile together.
 *
 * Doing both in one transaction avoids the half-created state where a provider profile
 * exists that nobody can actually sign in to, which is easy to produce and confusing to
 * diagnose after the fact.
 */
adminRouter.post(
  '/providers',
  requireAuth,
  requirePermission(PERMISSIONS.PROVIDERS_CREATE),
  validate({ body: providerCreateSchema }),
  async (req: Request, res: Response) => {
    const input = req.body as z.infer<typeof providerCreateSchema>;

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppError(ErrorCode.DUPLICATE_RESOURCE, 'That email address is already in use.');
    }

    const slug = await uniqueSlug(input.slug ?? input.name, 'provider');
    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        role: 'PROVIDER',
        phone: input.phone ?? null,
        timezone: input.timezone,
        provider: {
          create: {
            slug,
            title: input.title ?? null,
            bio: input.bio ?? null,
            timezone: input.timezone,
            services: { create: input.serviceIds.map((serviceId) => ({ serviceId })) },
          },
        },
      },
      include: { provider: true },
    });

    await audit(req, 'provider.created', 'Provider', user.provider!.id, { email: input.email });
    created(
      res,
      { id: user.provider!.id, name: user.name, email: user.email, slug },
      'Provider onboarded. They can sign in with the password you set.',
    );
  },
);

adminRouter.patch(
  '/providers/:id',
  requireAuth,
  requirePermission(PERMISSIONS.PROVIDERS_UPDATE),
  validate({ params: z.object({ id: uuidSchema }), body: providerUpdateSchema }),
  async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const input = req.body as z.infer<typeof providerUpdateSchema>;

    const provider = await prisma.provider.findFirst({ where: { id, deletedAt: null } });
    if (!provider) throw new AppError(ErrorCode.PROVIDER_NOT_FOUND);

    await prisma.$transaction(async (tx) => {
      if (input.serviceIds) {
        await tx.serviceProvider.deleteMany({ where: { providerId: id } });
        await tx.serviceProvider.createMany({
          data: input.serviceIds.map((serviceId) => ({ serviceId, providerId: id })),
        });
      }

      await tx.provider.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });

      if (input.name !== undefined || input.phone !== undefined || input.isActive !== undefined) {
        await tx.user.update({
          where: { id: provider.userId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            // Deactivating the provider also revokes their sign-in.
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
      }
    });

    await audit(req, 'provider.updated', 'Provider', id, { fields: Object.keys(input) });
    ok(res, { id }, 'Provider updated');
  },
);

adminRouter.delete(
  '/providers/:id',
  requireAuth,
  requirePermission(PERMISSIONS.PROVIDERS_DELETE),
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const provider = await prisma.provider.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: { appointments: { where: { status: { in: ['PENDING', 'CONFIRMED'] } } } },
        },
      },
    });
    if (!provider) throw new AppError(ErrorCode.PROVIDER_NOT_FOUND);

    // Refuse rather than silently strand customers holding a confirmed booking.
    if (provider._count.appointments > 0) {
      throw new AppError(
        ErrorCode.BAD_REQUEST,
        `This provider has ${provider._count.appointments} upcoming appointment(s). Cancel or reassign them first.`,
      );
    }

    await prisma.$transaction([
      prisma.provider.update({ where: { id }, data: { isActive: false } }),
      prisma.user.update({ where: { id: provider.userId }, data: { isActive: false } }),
    ]);

    await audit(req, 'provider.deactivated', 'Provider', id);
    ok(res, { deactivated: true }, 'Provider deactivated. Their history is preserved.');
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Staff accounts
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.get(
  '/staff',
  requireAuth,
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  async (_req: Request, res: Response) => {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'PROVIDER'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        timezone: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        provider: { select: { id: true } },
      },
    });
    ok(res, staff);
  },
);

/**
 * Creates an admin or a provider account.
 *
 * Privilege is only ever granted by someone who already holds it — the public register
 * endpoint hard-codes CUSTOMER precisely so that no request payload can promote itself.
 */
adminRouter.post(
  '/staff',
  requireAuth,
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ body: staffCreateSchema }),
  async (req: Request, res: Response) => {
    const input = req.body as z.infer<typeof staffCreateSchema>;

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppError(ErrorCode.DUPLICATE_RESOURCE, 'That email address is already in use.');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
        phone: input.phone ?? null,
        timezone: input.timezone,
        // A PROVIDER account is useless without a profile to hang a calendar off.
        ...(input.role === 'PROVIDER'
          ? {
              provider: {
                create: {
                  slug: await uniqueSlug(input.name, 'provider'),
                  timezone: input.timezone,
                },
              },
            }
          : {}),
      },
      select: { id: true, name: true, email: true, role: true },
    });

    await audit(req, 'staff.created', 'User', user.id, { role: input.role });
    created(res, user, `${input.role === 'ADMIN' ? 'Admin' : 'Provider'} account created`);
  },
);

adminRouter.patch(
  '/staff/:id',
  requireAuth,
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({ isActive: z.boolean() }),
  }),
  async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const { isActive } = req.body as { isActive: boolean };

    // Locking yourself out is a support ticket nobody enjoys.
    if (id === req.user!.id && !isActive) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'You cannot deactivate your own account.');
    }

    await prisma.user.update({ where: { id }, data: { isActive } });
    await audit(req, isActive ? 'staff.activated' : 'staff.deactivated', 'User', id);
    ok(res, { id, isActive }, isActive ? 'Account reactivated' : 'Account deactivated');
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Holidays & policies
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.post(
  '/holidays',
  requireAuth,
  requirePermission(PERMISSIONS.HOLIDAYS_MANAGE),
  validate({ body: holidaySchema }),
  async (req: Request, res: Response) => {
    const input = req.body as z.infer<typeof holidaySchema>;
    const holiday = await prisma.holiday.create({
      data: { name: input.name, date: new Date(`${input.date}T00:00:00Z`) },
    });
    await audit(req, 'holiday.created', 'Holiday', holiday.id, { date: input.date });
    created(res, holiday, 'Holiday added. Those slots are no longer bookable.');
  },
);

adminRouter.delete(
  '/holidays/:id',
  requireAuth,
  requirePermission(PERMISSIONS.HOLIDAYS_MANAGE),
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: Request, res: Response) => {
    await prisma.holiday.delete({ where: { id: param(req, 'id') } });
    await audit(req, 'holiday.removed', 'Holiday', param(req, 'id'));
    noContent(res);
  },
);

adminRouter.get(
  '/cancellation-policies',
  requireAuth,
  requirePermission(PERMISSIONS.SERVICES_READ),
  async (_req: Request, res: Response) => {
    ok(res, await prisma.cancellationPolicy.findMany({ orderBy: { name: 'asc' } }));
  },
);
