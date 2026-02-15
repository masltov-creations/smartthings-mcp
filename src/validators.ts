import { z } from "zod";

export const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/);

export const installedAppIdSchema = uuid.optional();

export const listDevicesSchema = {
  locationId: uuid.optional(),
  installedAppId: installedAppIdSchema
};

export const deviceIdSchema = {
  deviceId: uuid,
  installedAppId: installedAppIdSchema
};

export const sendCommandSchema = {
  deviceId: uuid,
  commands: z.array(z.record(z.any())).min(1),
  installedAppId: installedAppIdSchema
};

export const sceneSchema = {
  sceneId: uuid,
  installedAppId: installedAppIdSchema
};

export const ruleSchema = {
  ruleId: uuid,
  installedAppId: installedAppIdSchema
};

export const updateRuleSchema = {
  ruleId: uuid,
  rule: z.record(z.any()),
  installedAppId: installedAppIdSchema
};
