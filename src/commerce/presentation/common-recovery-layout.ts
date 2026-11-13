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
    if (Object.hasOwn(p, 'productImage') || p.body.length !== 1 || p.body[0]?.kind !== 'responseSlot' ||
        p.body[0].name !== 'response.body' || p.footer.length !== 0 || p.conditionals.length !== 1) return {kind: 'invalid'};
    if (!p.header.every(token => token.kind === 'text' || (token.kind === 'variable' &&
        (token.name === 'shop.name' || token.name === 'shop.websiteUrl')))) return {kind: 'invalid'};
    for (const name of ['shop.name', 'shop.websiteUrl'])
      if (p.header.filter(token => token.kind === 'variable' && token.name === name).length !== 1) return {kind: 'invalid'};
    const conditional = p.conditionals[0]!;
    const final = conditional.tokens.at(-1);
    if (!conditional.tokens.every(token => token.kind === 'text' ||
        (token.kind === 'variable' && token.name === 'checkout.url'))) return {kind: 'invalid'};
    if (conditional.when !== 'checkout.available' ||
        conditional.tokens.filter(token => token.kind === 'variable' && token.name === 'checkout.url').length !== 1 ||
        final?.kind !== 'variable' || final.name !== 'checkout.url') return {kind: 'invalid'};
    // Preserve the multipart contract's exact final URL line without rendering or inferring variable content.
    const prefix = conditional.tokens.slice(0, -1);
    let textSuffix = '';
    for (let index = prefix.length - 1; index >= 0 && prefix[index]?.kind === 'text'; index--) {
      const token = prefix[index]!; if (token.kind === 'text') textSuffix = token.value + textSuffix;
    }
    if (prefix.length && !textSuffix.endsWith('\n') && !(prefix.every(token => token.kind === 'text') && textSuffix === '')) return {kind: 'invalid'};
    return {kind: 'ok', reference: {...envelope.data, prepared: p}};
  } catch { return {kind: 'invalid'}; }
}
