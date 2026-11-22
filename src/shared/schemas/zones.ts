import { z } from "zod";

export const ROLES = ["seeker", "hider"] as const;
export const RoleSchema = z.enum(ROLES);

export const ZONE_TYPES = [
  "main",
  "safe",
  "restricted",
  "jail",
  "rescue",
  "capture",
  "flag",
  "control",
  "spawn",
  "objective",
] as const;
export const ZoneTypeSchema = z.enum(ZONE_TYPES);

/** GeoJSON order: [lng, lat]. */
export const LngLatSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

// Structural bounds only; zones/validate.ts reports friendly range errors (10 m – 20 km).
const RadiusSchema = z.number().finite().positive().max(100_000);
const SecSchema = z.number().int().min(0).max(24 * 3600);

export const CircleShapeSchema = z.strictObject({
  kind: z.literal("circle"),
  center: LngLatSchema,
  radiusM: RadiusSchema,
});

export const PolygonShapeSchema = z.strictObject({
  kind: z.literal("polygon"),
  /** Outer ring, open or closed; rectangles are polygons. */
  ring: z.array(LngLatSchema).min(3).max(200),
});

export const ZoneShapeSchema = z.discriminatedUnion("kind", [CircleShapeSchema, PolygonShapeSchema]);

export const ShrinkPhaseSchema = z.strictObject({
  holdSec: SecSchema,
  shrinkSec: SecSchema,
  center: LngLatSchema,
  radiusM: RadiusSchema,
});

export const WaypointSchema = z.strictObject({
  center: LngLatSchema,
  radiusM: RadiusSchema,
  holdSec: SecSchema,
  moveSec: SecSchema,
});

export const ZoneBehaviorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("static") }),
  z.strictObject({
    kind: z.literal("shrinking"),
    startDelaySec: SecSchema,
    warningSec: SecSchema,
    phases: z.array(ShrinkPhaseSchema).min(1).max(12),
  }),
  z.strictObject({
    kind: z.literal("moving"),
    startDelaySec: SecSchema,
    warningSec: SecSchema,
    waypoints: z.array(WaypointSchema).min(1).max(12),
  }),
]);

export const ZoneSchema = z.strictObject({
  id: z.string().min(1).max(32),
  type: ZoneTypeSchema,
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  opacity: z.number().min(0).max(1),
  shape: ZoneShapeSchema,
  enabled: z.boolean(),
  /** Roles that see this zone. Empty = nobody (hidden mechanic). */
  visibleTo: z.array(RoleSchema).max(ROLES.length),
  /** Only the main zone may be dynamic in this build. */
  behavior: ZoneBehaviorSchema,
});

export const ZonesSchema = z.array(ZoneSchema).max(50);

export type Role = z.infer<typeof RoleSchema>;
export type ZoneType = z.infer<typeof ZoneTypeSchema>;
export type LngLat = z.infer<typeof LngLatSchema>;
export type CircleShape = z.infer<typeof CircleShapeSchema>;
export type PolygonShape = z.infer<typeof PolygonShapeSchema>;
export type ZoneShape = z.infer<typeof ZoneShapeSchema>;
export type ShrinkPhase = z.infer<typeof ShrinkPhaseSchema>;
export type Waypoint = z.infer<typeof WaypointSchema>;
export type ZoneBehavior = z.infer<typeof ZoneBehaviorSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
