import { z } from "zod";

const uuidRegex = /^[0-9a-fA-F-]{36}$/;
const uuid = () => z.string().regex(uuidRegex);
const commandExpectationSchema = z.object({
  componentId: z.string().min(1).max(64).optional().default("main"),
  capability: z.string().min(1).max(128),
  attribute: z.string().min(1).max(128),
  equals: z.any().optional(),
  oneOf: z.array(z.any()).min(1).optional(),
  exists: z.boolean().optional()
}).superRefine((value, ctx) => {
  const hasComparator = value.oneOf !== undefined || value.equals !== undefined || value.exists !== undefined;
  if (!hasComparator) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each expectation must define at least one of: equals, oneOf, exists"
    });
  }
  if (value.oneOf !== undefined && value.equals !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Use either equals or oneOf in a single expectation, not both"
    });
  }
});

export const installedAppIdSchema = uuid().optional();

export const listDevicesSchema = {
  locationId: uuid().optional(),
  installedAppId: installedAppIdSchema
};

export const roomTemperatureMapSchema = {
  locationId: uuid().optional(),
  installedAppId: installedAppIdSchema,
  refresh: z.boolean().optional()
};

export const deviceStatusesSchema = {
  locationId: uuid().optional(),
  deviceIds: z.array(uuid()).min(1).max(200).optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
  installedAppId: installedAppIdSchema
};

export const deviceIdSchema = {
  deviceId: uuid(),
  installedAppId: installedAppIdSchema
};

export const sendCommandSchema = {
  deviceId: uuid(),
  commands: z.array(z.record(z.any())).min(1),
  installedAppId: installedAppIdSchema
};

export const sendCommandAndVerifySchema = {
  deviceId: uuid(),
  commands: z.array(z.record(z.any())).min(1),
  expectations: z.array(commandExpectationSchema).min(1),
  attempts: z.number().int().min(1).max(10).optional().default(4),
  initialDelayMs: z.number().int().min(0).max(10000).optional().default(800),
  backoffMultiplier: z.number().min(1).max(4).optional().default(1.8),
  installedAppId: installedAppIdSchema
};

export const sceneSchema = {
  sceneId: uuid(),
  installedAppId: installedAppIdSchema
};

export const ruleSchema = {
  ruleId: uuid(),
  installedAppId: installedAppIdSchema
};

export const updateRuleSchema = {
  ruleId: uuid(),
  rule: z.record(z.any()),
  installedAppId: installedAppIdSchema
};
