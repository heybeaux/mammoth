import { z } from 'zod';

export const EntityIdSchema = z.string().trim().min(1).max(256);
export const SchemaVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export const TimestampSchema = z.string().datetime({ offset: true });
export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const NonEmptyStringSchema = z.string().trim().min(1);
export const UnitIntervalSchema = z.number().min(0).max(1).finite();

export type EntityId = z.infer<typeof EntityIdSchema>;
export type Digest = z.infer<typeof DigestSchema>;
