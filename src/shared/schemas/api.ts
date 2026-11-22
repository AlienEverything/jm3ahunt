import { z } from "zod";
import { SettingsSchema } from "./settings";
import { ZonesSchema } from "./zones";

const DisplayName = z.string().trim().min(1).max(32);
const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,24}$/);
const Password = z.string().min(8).max(128);
const Emoji = z.string().min(1).max(16);
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const GroupName = z.string().trim().min(1).max(40);
const MatchName = z.string().trim().min(1).max(60);
const Id = z.string().min(1).max(64);

export const GuestBody = z.strictObject({ displayName: DisplayName });
export const RegisterBody = z.strictObject({ username: Username, password: Password });
export const LoginBody = z.strictObject({ username: Username, password: z.string().min(1).max(128) });
export const PatchMeBody = z.strictObject({
  displayName: DisplayName.optional(),
  avatarColor: HexColor.optional(),
  avatarEmoji: Emoji.optional(),
});

export const CreateGroupBody = z.strictObject({
  name: GroupName,
  icon: Emoji,
  password: z.string().min(4).max(64).optional(),
  maxMembers: z.number().int().min(2).max(50).optional(),
});
export const PatchGroupBody = z.strictObject({
  name: GroupName.optional(),
  icon: Emoji.optional(),
  /** null removes the password. */
  password: z.string().min(4).max(64).nullable().optional(),
  maxMembers: z.number().int().min(2).max(50).optional(),
});
export const SetMemberRoleBody = z.strictObject({ role: z.enum(["admin", "member"]) });
export const JoinGroupBody = z.strictObject({
  codeOrToken: z.string().trim().min(6).max(64),
  password: z.string().max(64).optional(),
});

export const PresetKindSchema = z.enum(["game", "zones"]);
export const CreatePresetBody = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("game"), name: z.string().trim().min(1).max(40), mode: z.literal("hide_seek"), data: z.strictObject({ settings: SettingsSchema }) }),
  z.strictObject({ kind: z.literal("zones"), name: z.string().trim().min(1).max(40), mode: z.literal("hide_seek"), data: z.strictObject({ zones: ZonesSchema }) }),
]);
export const PatchPresetBody = z.strictObject({
  name: z.string().trim().min(1).max(40).optional(),
  /** Validated against the preset's kind by the route. */
  data: z.union([z.strictObject({ settings: SettingsSchema }), z.strictObject({ zones: ZonesSchema })]).optional(),
});

export const CreateMatchBody = z
  .strictObject({
    name: MatchName,
    /** Saved group preset id or built-in preset id (classic, manhunt_jail, ...). */
    presetId: Id.optional(),
    settings: SettingsSchema.optional(),
    zones: ZonesSchema.optional(),
    quickStart: z.boolean().optional(),
  })
  .refine((b) => !(b.presetId && b.settings), { message: "Use presetId or settings, not both", path: ["settings"] });

export const PutSettingsBody = z.strictObject({ settings: SettingsSchema });
export const PutZonesBody = z.strictObject({ zones: ZonesSchema });

export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export type GuestBody = z.infer<typeof GuestBody>;
export type RegisterBody = z.infer<typeof RegisterBody>;
export type LoginBody = z.infer<typeof LoginBody>;
export type PatchMeBody = z.infer<typeof PatchMeBody>;
export type CreateGroupBody = z.infer<typeof CreateGroupBody>;
export type PatchGroupBody = z.infer<typeof PatchGroupBody>;
export type SetMemberRoleBody = z.infer<typeof SetMemberRoleBody>;
export type JoinGroupBody = z.infer<typeof JoinGroupBody>;
export type CreatePresetBody = z.infer<typeof CreatePresetBody>;
export type PatchPresetBody = z.infer<typeof PatchPresetBody>;
export type CreateMatchBody = z.infer<typeof CreateMatchBody>;
export type PutSettingsBody = z.infer<typeof PutSettingsBody>;
export type PutZonesBody = z.infer<typeof PutZonesBody>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
