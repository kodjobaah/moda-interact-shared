import { z } from "zod";

export const WHATSAPP_INBOUND_MESSAGE_SCHEMA_VERSION = 1 as const;

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_CUSTOMER_PHONE_LENGTH = 64;
const MAX_TEXT_LENGTH = 4096;

const boundedIdentifier = (max: number = MAX_IDENTIFIER_LENGTH) =>
  z.string().trim().min(1).max(max);

const textContentSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  })
  .strict();

const audioContentSchema = z
  .object({
    type: z.literal("audio"),
    mediaId: boundedIdentifier(),
    mimeType: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH).nullable(),
    sha256: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH).nullable(),
    voice: z.boolean().nullable(),
  })
  .strict();

const unsupportedContentSchema = z
  .object({
    type: z.literal("unsupported"),
    providerType: boundedIdentifier(),
  })
  .strict();

export const WhatsAppInboundContentSchema = z.discriminatedUnion("type", [
  textContentSchema,
  audioContentSchema,
  unsupportedContentSchema,
]);

export const NormalizedWhatsAppInboundMessageSchema = z
  .object({
    schemaVersion: z.literal(WHATSAPP_INBOUND_MESSAGE_SCHEMA_VERSION),
    provider: z.literal("whatsapp"),
    providerAccountId: boundedIdentifier(),
    providerPhoneNumberId: boundedIdentifier(),
    providerMessageId: boundedIdentifier(),
    customerPhone: boundedIdentifier(MAX_CUSTOMER_PHONE_LENGTH),
    contextMessageId: boundedIdentifier().nullable(),
    occurredAt: z.iso.datetime({ offset: true }),
    content: WhatsAppInboundContentSchema,
  })
  .strict();

export type WhatsAppInboundContent = z.infer<typeof WhatsAppInboundContentSchema>;
export type NormalizedWhatsAppInboundMessage = z.infer<
  typeof NormalizedWhatsAppInboundMessageSchema
>;

export function parseNormalizedWhatsAppInboundMessage(
  input: unknown,
): NormalizedWhatsAppInboundMessage {
  return NormalizedWhatsAppInboundMessageSchema.parse(input);
}

export function safeParseNormalizedWhatsAppInboundMessage(input: unknown) {
  return NormalizedWhatsAppInboundMessageSchema.safeParse(input);
}