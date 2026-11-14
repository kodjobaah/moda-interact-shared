import { z } from 'zod';
import { ModaSupportedLanguageTagSchema, type ModaSupportedLanguageTag } from '../../internationalization.js';
import { readPreparedWrapper, type PresentationDigest } from './wrapper-projection.js';
import type { PreparedWrapper } from './wrapper-contracts.js';

const Identifier = z.string().min(1).max(191).refine(value => !/[\x00-\x20\x7f]/.test(value));
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const Envelope = z.strictObject({
  schemaVersion: z.literal(1), definitionId: Identifier, sourceHash: Sha256,
  localeId: Identifier, languageTag: ModaSupportedLanguageTagSchema, contentHash: Sha256,
  prepared: z.unknown(),
});
export type CommonRecoveryLayoutReference = Readonly<{
  schemaVersion: 1; definitionId: string; sourceHash: string; localeId: string;
  languageTag: ModaSupportedLanguageTag; contentHash: string; prepared: PreparedWrapper;
}>;

/** Parses a snapshot, not authority. Hosts re-read the selected immutable SHARED definition/locale and verify status and both hashes. */
export function readCommonRecoveryLayoutReference(raw: unknown, sha256: PresentationDigest):
  {kind: 'ok'; reference: CommonRecoveryLayoutReference} | {kind: 'invalid'} {
  try {
    const envelope = Envelope.safeParse(raw);
    if (!envelope.success) return {kind: 'invalid'};
    const read = readPreparedWrapper({schemaVersion: 1, prepared: envelope.data.prepared}, envelope.data.contentHash, sha256);
    if (read.kind !== 'ok') return {kind: 'invalid'};
    const p = read.prepared;
    // Mechanical frame integrity only. Hosts own variable/section placement,
    // mandatory content and current selected-template authorization.
    if (Object.hasOwn(p, 'productImage') || p.body.length !== 1 ||
        p.body[0]?.kind !== 'responseSlot' || p.body[0].name !== 'response.body') return {kind: 'invalid'};
    return {kind: 'ok', reference: {...envelope.data, prepared: p}};
  } catch { return {kind: 'invalid'}; }
}
