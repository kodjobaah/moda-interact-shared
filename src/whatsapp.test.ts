import assert from "node:assert/strict";
import test from "node:test";
import {
  WHATSAPP_INBOUND_MESSAGE_SCHEMA_VERSION,
  parseNormalizedWhatsAppInboundMessage,
  safeParseNormalizedWhatsAppInboundMessage,
  type WhatsAppInboundContent,
} from "./whatsapp.js";

const base = {
  schemaVersion: WHATSAPP_INBOUND_MESSAGE_SCHEMA_VERSION,
  provider: "whatsapp",
  providerAccountId: " account-1 ",
  providerPhoneNumberId: " phone-1 ",
  providerMessageId: " message-1 ",
  customerPhone: " +15551234567 ",
  contextMessageId: null,
  occurredAt: "2026-09-16T12:00:00.000+00:00",
};

test("parses contextual and contextless text messages", () => {
  const contextual = parseNormalizedWhatsAppInboundMessage({
    ...base,
    contextMessageId: " context-1 ",
    content: { type: "text", text: "  Hello there  " },
  });
  assert.equal(contextual.contextMessageId, "context-1");
  assert.equal(contextual.customerPhone, "+15551234567");
  assert.equal(contextual.content.type, "text");
  assert.equal(contextual.content.text, "Hello there");

  const contextless = parseNormalizedWhatsAppInboundMessage({
    ...base,
    content: { type: "text", text: "Hello without context" },
  });
  assert.equal(contextless.contextMessageId, null);
});

test("parses audio with required metadata and nullable optional metadata", () => {
  const audio = parseNormalizedWhatsAppInboundMessage({
    ...base,
    content: {
      type: "audio",
      mediaId: " media-1 ",
      mimeType: " audio/ogg ",
      sha256: " hash-1 ",
      voice: true,
    },
  });
  assert.equal(audio.content.type, "audio");
  if (audio.content.type === "audio") {
    assert.equal(audio.content.mediaId, "media-1");
    assert.equal(audio.content.mimeType, "audio/ogg");
    assert.equal(audio.content.sha256, "hash-1");
    assert.equal(audio.content.voice, true);
  }

  const minimalAudio = parseNormalizedWhatsAppInboundMessage({
    ...base,
    content: {
      type: "audio",
      mediaId: "media-2",
      mimeType: null,
      sha256: null,
      voice: null,
    },
  });
  assert.deepEqual(minimalAudio.content, {
    type: "audio",
    mediaId: "media-2",
    mimeType: null,
    sha256: null,
    voice: null,
  });
});

test("parses unsupported provider types explicitly", () => {
  const message = parseNormalizedWhatsAppInboundMessage({
    ...base,
    content: { type: "unsupported", providerType: " image " },
  });
  assert.deepEqual(message.content, { type: "unsupported", providerType: "image" });
});

test("rejects invalid identifiers, dates, text, and schema versions", () => {
  const invalidInputs = [
    { ...base, providerMessageId: "   ", content: { type: "text", text: "ok" } },
    { ...base, providerAccountId: "x".repeat(257), content: { type: "text", text: "ok" } },
    { ...base, customerPhone: "x".repeat(65), content: { type: "text", text: "ok" } },
    { ...base, occurredAt: "2026-09-16T12:00:00.000", content: { type: "text", text: "ok" } },
    { ...base, content: { type: "text", text: "   " } },
    { ...base, content: { type: "text", text: "x".repeat(4097) } },
    { ...base, schemaVersion: 2, content: { type: "text", text: "ok" } },
  ];
  for (const input of invalidInputs) {
    assert.equal(safeParseNormalizedWhatsAppInboundMessage(input).success, false);
  }
});

test("rejects tenant, business, raw payload, and nested unknown fields", () => {
  const valid = {
    ...base,
    content: { type: "text", text: "hello" },
  };
  for (const input of [
    { ...valid, shopId: "shop-1" },
    { ...valid, conversationId: "conversation-1" },
    { ...valid, checkoutRecoveryId: "recovery-1" },
    { ...valid, rawPayload: {} },
    { ...valid, content: { type: "text", text: "hello", unknown: true } },
  ]) {
    assert.equal(safeParseNormalizedWhatsAppInboundMessage(input).success, false);
  }
});

test("supports discriminated-union narrowing for every content type", () => {
  const labelForContent = (content: WhatsAppInboundContent): string => {
    if (content.type === "text") return content.text;
    if (content.type === "audio") return content.mediaId;
    return content.providerType;
  };

  const content: WhatsAppInboundContent = { type: "unsupported", providerType: "sticker" };
  assert.equal(labelForContent(content), "sticker");
});