import { z } from 'zod';

const id = z.string().trim().min(1).max(100);
const name = z.string().trim().min(1).max(120);
export const schemas = {
  ticket: z.object({ serviceId: id, profile: z.enum(['standard', 'wheelchair', 'visual', 'reduced']).default('standard') }).strict(),
  service: z.object({ name, prefix: z.string().regex(/^[A-Z]{1,8}$/), avgMinutes: z.number().positive().max(480), active: z.boolean().optional() }).strict(),
  serviceUpdate: z.object({ name: name.optional(), avgMinutes: z.number().positive().max(480).optional(), active: z.boolean().optional() }).strict(),
  desk: z.object({ name, buildingId: id, floor: z.number().int(), locationId: id,
    status: z.enum(['OPEN', 'PAUSED', 'CLOSED']).default('CLOSED'), serviceIds: z.array(id).min(1).max(50) }).strict(),
  call: z.object({ serviceId: id }).strict(),
  status: z.object({ status: z.enum(['SERVING', 'COMPLETED', 'MISSED']) }).strict(),
  reassign: z.object({ deskId: id }).strict(),
};
schemas.deskUpdate = schemas.desk.partial();
export const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body);
  next();
};
