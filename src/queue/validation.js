import { z } from 'zod';

const id = z.string().trim().min(1).max(100);
const name = z.string().trim().min(1).max(120);
export const schemas = {
  accountRegister: z.object({ email: z.string().trim().email().max(254), password: z.string().min(10).max(128) }).strict(),
  accountLogin: z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).strict(),
  accountPreferences: z.object({
    profile: z.enum(['standard', 'wheelchair', 'visual', 'reduced']).optional(),
    highContrast: z.boolean().optional(),
    largeText: z.boolean().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0),
  ticket: z.object({ serviceId: id, profile: z.enum(['standard', 'wheelchair', 'visual', 'reduced']).default('standard') }).strict(),
  service: z.object({ name, prefix: z.string().regex(/^[A-Z]{1,8}$/), avgMinutes: z.number().positive().max(480), active: z.boolean().optional() }).strict(),
  serviceUpdate: z.object({ name: name.optional(), avgMinutes: z.number().positive().max(480).optional(), active: z.boolean().optional() }).strict(),
  desk: z.object({ name, buildingId: id, floor: z.number().int(), locationId: id,
    status: z.enum(['OPEN', 'PAUSED', 'CLOSED']).default('CLOSED'), serviceIds: z.array(id).min(1).max(50) }).strict(),
  call: z.object({ serviceId: id }).strict(),
  status: z.object({ status: z.enum(['SERVING', 'COMPLETED', 'MISSED']) }).strict(),
  reassign: z.object({ deskId: id }).strict(),
  assistant: z.object({ question: z.string().trim().min(2).max(500), consent: z.literal(true),
    history: z.array(z.object({ role: z.enum(['user', 'model']), text: z.string().min(1).max(1200) }).strict()).max(6).optional(),
    route: z.object({
      floor: z.string().max(80), origin: z.string().max(180), destination: z.string().max(180),
      currentStepIndex: z.number().int().min(0).max(99), currentStep: z.string().max(400),
      steps: z.array(z.object({ action: z.enum(['walk', 'turn', 'elevator', 'stairs', 'ramp', 'arrive']), text: z.string().min(1).max(400), distance: z.number().nonnegative().max(10000).optional(), landmark: z.string().max(180).optional() }).strict()).min(1).max(100),
      totalDistance: z.number().nonnegative().max(100000), verified: z.literal(false), locationDetected: z.literal(false),
      landmarks: z.array(z.object({ id, label: z.string().min(1).max(180) }).strict()).max(30).optional(),
    }).strict().optional(),
  }).strict(),
};
schemas.deskUpdate = schemas.desk.partial();
export const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body);
  next();
};
