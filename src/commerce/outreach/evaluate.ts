import { z } from 'zod';
import { CommerceModelInvocationFailure } from '../runner/failure.js';
import { composeInitialOutreachInstructions } from './instructions.js';
import { CommerceToolInputs, CommerceToolOutputs, type CommerceProduct } from '../schemas.js';
import { InitialOutreachEvaluationInputSchema, InitialOutreachEvaluationResultSchema, CheckoutChoiceSchema, type InitialOutreachEvaluationInput, type InitialOutreachEvaluationResult, type InitialOutreachPorts, type InitialOutreachToolCall, type ToolActivity, type OfferDecision, type RefusalReason } from './contracts.js';
import { fingerprintInitialOutreachBasket, productKey, currentFacts, reconcileLines, OutreachRefusal } from './reconcile.js';
import { evaluatePurchaseDiscount, type ObservedDiscount } from './eligibility.js';
import { decimalToMinorUnits } from './money.js';
import { selectCompatibleOffers } from './combinations.js';
import type { CommerceOfferSchema, CommerceDiscountDetailsSchema } from '../schemas.js';
type Offer = z.infer<typeof CommerceOfferSchema>;
type Details = z.infer<typeof CommerceDiscountDetailsSchema>;
type Stage = 'INPUT' | 'PRODUCT_READ' | 'RECONCILE' | 'OFFER_SELECT' | 'REVALIDATE' | 'COMPLETE';
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const noOffer = (reasonCode: string, discoveryIncomplete = false): OfferDecision => ({ kind: 'NO_VERIFIED_OFFER', reasonCode, discoveryIncomplete });
const ModelStepSchema = z.strictObject({ calls: z.array(z.strictObject({ name: z.string().min(1).max(128), arguments: z.unknown() })).min(1).max(3), outputTokens: z.number().int().nonnegative().safe(), text: z.string().max(16000).optional(),providerSummary:z.strictObject({finishReason:z.enum(['stop','length','tool_calls','content_filter','other']).optional(),reasoningTokens:z.number().int().nonnegative().safe().optional(),hasVisibleText:z.boolean(),hasReasoningBlocks:z.boolean(),contentKind:z.enum(['missing','plain_text','typed_blocks','non_text_blocks'])}).optional() });
function offerFacts(d: Details): string { const { observedAt, ...facts } = d.facts; return JSON.stringify({ ...d, facts }); }
function errorReason(e: unknown): RefusalReason {
    if (e instanceof CommerceModelInvocationFailure && e.diagnostic.stage === 'model.invoke')
        return 'PROVIDER_UNAVAILABLE';
    if (e instanceof OutreachRefusal)
        return e.code;
    const code = e && typeof e === 'object' && 'code' in e ? e.code : null;
    if (code === 'DENIED' || code === 'CANCELLED' || code === 'DEADLINE' || code === 'BUDGET_EXHAUSTED')
        return code;
    if (code === 'UNAVAILABLE' || code === 'PROVIDER_UNAVAILABLE')
        return 'PROVIDER_UNAVAILABLE';
    if (e instanceof Error && e.name === 'AbortError')
        return 'CANCELLED';
    if (e instanceof Error && e.name === 'TimeoutError')
        return 'DEADLINE';
    return 'INVALID_RESULT';
}
/** One implementation for production and preview. Ports must authenticate every call. No retries. */
export async function evaluateInitialOutreach(raw: InitialOutreachEvaluationInput, ports: InitialOutreachPorts): Promise<InitialOutreachEvaluationResult> {
    let input: InitialOutreachEvaluationInput;
    const identity = (key: 'runId' | 'shopId') => { const v = raw && typeof raw === 'object' ? raw[key] : null; return typeof v === 'string' && v.trim() && v.length <= 191 ? v.trim() : 'invalid'; };
    const activity: ToolActivity[] = [];
    let stage: Stage = 'INPUT', lineKey: string | null = null, steps = 0, tokens = 0, calls = 0;
    const refuse = (reasonCode: RefusalReason): InitialOutreachEvaluationResult => ({ kind: 'refused', schemaVersion: 1, runId: identity('runId'), shopId: identity('shopId'), stage, reasonCode, lineKey, toolActivity: activity });
    try {
        if (bytes(raw) > 131072)
            return refuse('INPUT_INVALID');
        input = InitialOutreachEvaluationInputSchema.parse(raw);
    }
    catch {
        return refuse('INPUT_INVALID');
    }
    const start = ports.now().getTime(), expires = start + input.limits.deadlineMs;
    function check() {
        if (ports.signal.aborted)
            throw new OutreachRefusal('CANCELLED');
        if (!Number.isFinite(start) || !Number.isFinite(ports.now().getTime()))
            throw new OutreachRefusal('INVALID_RESULT');
        if (ports.now().getTime() >= expires)
            throw new OutreachRefusal('DEADLINE');
    }
    function log(reasonCode: string | null = null, toolName: string | null = null, durationMs = 0) {
        try {
            ports.log({ stage, runId: input.runId, shopId: input.shopId, reasonCode, lineKey, toolName, durationMs });
        }
        catch { /* Diagnostic sinks cannot grant or deny commerce facts. */ }
    }
    async function bounded<T>(run: () => Promise<T>): Promise<T> {
        check();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        try {
            return await Promise.race([Promise.resolve().then(run), new Promise<never>((_, reject) => { abort = () => reject(new OutreachRefusal('CANCELLED')); ports.signal.addEventListener('abort', abort, { once: true }); timer = setTimeout(() => reject(new OutreachRefusal('DEADLINE')), Math.min(2147483647, Math.max(0, expires - ports.now().getTime()))); })]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
            if (abort)
                ports.signal.removeEventListener('abort', abort);
        }
    }
    async function attempt<T>(toolName: string, run: () => Promise<T>): Promise<T> {
        check();
        if (bytes(activity) > 400000)
            throw new OutreachRefusal('RESULT_TOO_LARGE');
        if (calls >= input.limits.remoteCalls)
            throw new OutreachRefusal('BUDGET_EXHAUSTED');
        calls++;
        const began = ports.now().getTime();
        let errorCode: RefusalReason | null = null;
        try {
            const result = await bounded(run);
            check();
            return result;
        }
        catch (e) {
            errorCode = ports.signal.aborted ? 'CANCELLED' : ports.now().getTime() >= expires ? 'DEADLINE' : errorReason(e);
            throw new OutreachRefusal(errorCode);
        }
        finally {
            const durationMs = Math.max(0, ports.now().getTime() - began);
            activity.push({ toolName, modelStep: steps, attempt: 1, status: errorCode ? 'ERROR' : 'OK', durationMs, errorCode });
            log(errorCode, toolName, durationMs);
        }
    }
    async function tool<N extends InitialOutreachToolCall['name']>(name: N, args: z.infer<(typeof CommerceToolInputs)[N]>): Promise<z.infer<(typeof CommerceToolOutputs)[N]>> {
        const arguments_ = CommerceToolInputs[name].parse(args);
        return attempt(name, async () => {
            const value = await ports.callTool({ name, arguments: arguments_, runId: input.runId, shopId: input.shopId, platform: input.platform, signal: ports.signal } as InitialOutreachToolCall);
            if (bytes(value) > 32768)
                throw new OutreachRefusal('INVALID_RESULT');
            const parsed = CommerceToolOutputs[name].parse(value);
            if ('outcome' in parsed)
                throw new OutreachRefusal('PROVIDER_UNAVAILABLE');
            return parsed as z.infer<(typeof CommerceToolOutputs)[N]>;
        });
    }
    const distinct = input.checkout.lines.filter((l, index, all) => all.findIndex(other => productKey(l) === productKey(other)) === index);
    async function readProducts(revalidation = false): Promise<Map<string, CommerceProduct>> {
        const products = new Map<string, CommerceProduct>();
        for (const l of distinct) {
            lineKey = l.lineKey;
            const { product } = await tool('commerce_get_product', { productId: l.productId, variantId: l.variantId });
            if (!product)
                throw new OutreachRefusal(revalidation ? 'CURRENT_FACTS_CHANGED' : 'PRODUCT_NOT_FOUND');
            if (product.productId !== l.productId || product.variantId !== l.variantId)
                throw new OutreachRefusal('IDENTITY_MISMATCH');
            const at = Date.parse(product.observedAt);
            if (at < start || at > ports.now().getTime())
                throw new OutreachRefusal('INVALID_RESULT');
            if (product.available !== true && !revalidation)
                throw new OutreachRefusal('PRODUCT_UNAVAILABLE');
            products.set(productKey(l), product);
        }
        lineKey = null;
        return products;
    }
    try {
        check();
        log();
        stage = 'PRODUCT_READ';
        const products = await readProducts();
        stage = 'RECONCILE';
        log();
        const reconciled = reconcileLines(input, products);
        stage = 'OFFER_SELECT';
        log();
        const purchase = { provider: input.platform, mode: input.policy.mode, authorisedDiscountIds: input.policy.authorisedDiscountIds, currency: input.checkout.currency, currentMerchandiseSubtotal: reconciled.currentMerchandiseSubtotal, lines: reconciled.lines.map(l => ({ lineKey: l.lineKey, productId: l.productId, variantId: l.variantId, categoryIds: l.currentProduct.categoryIds ?? null, collectionIds: l.currentProduct.collectionIds ?? null, isSaleItem: l.currentProduct.saleEvidence?.regularPrice != null && l.currentProduct.saleEvidence.salePrice != null && Date.parse(l.currentProduct.saleEvidence.observedAt) >= start && Date.parse(l.currentProduct.saleEvidence.observedAt) <= ports.now().getTime() ? (() => { const sale = decimalToMinorUnits(l.currentProduct.saleEvidence!.salePrice!, input.checkout.currency), regular = decimalToMinorUnits(l.currentProduct.saleEvidence!.regularPrice!, input.checkout.currency); return sale !== null && regular !== null ? sale < regular : null; })() : null, quantity: l.quantity })) };
        const observed = new Map<string, ObservedDiscount>(), options = new Map<string, Offer>();
        let incomplete = false;
        async function readDetails(id: string, option: Offer | null): Promise<Details | null> {
            const output = await tool('commerce_get_discount_details', { offerId: id });
            if ('outcome' in output)
                throw new OutreachRefusal('PROVIDER_UNAVAILABLE');
            const details = output.details;
            if (details && (Date.parse(details.facts.observedAt) < start || Date.parse(details.facts.observedAt) > ports.now().getTime()))
                throw new OutreachRefusal('INVALID_RESULT');
            if (details && details.offer.offerId !== id)
                throw new OutreachRefusal('IDENTITY_MISMATCH');
            if (details && details.facts.provider !== input.platform)
                throw new OutreachRefusal('IDENTITY_MISMATCH');
            if (details) {
                const offer = option ?? details.offer;
                const eligibility = evaluatePurchaseDiscount({ purchase, offerFromOptions: offer, details, evaluatedAt: ports.now() });
                observed.set(id, { offer, details, eligibility });
            }
            return details;
        }
        let decision: OfferDecision = noOffer('POLICY_NONE');
        if (input.policy.mode === 'FIXED') {
            for (const id of input.policy.authorisedDiscountIds)
                await readDetails(id, null);
        }
        else if (input.policy.mode === 'AI_BEST_APPLICABLE') {
            const history: unknown[] = [];
            let nextCursor: string | null = null;
            let optionsRead = false;
            const seen = new Set<string>();
            let choice: z.infer<typeof CheckoutChoiceSchema> | null = null;
            while (!choice) {
                if (steps >= input.limits.modelSteps || tokens >= input.limits.outputTokens)
                    throw new OutreachRefusal('BUDGET_EXHAUSTED');
                steps++;
                const step = ModelStepSchema.parse(await attempt('model.invoke', () => ports.modelInvoker.invoke({
                    instructions: [...composeInitialOutreachInstructions({ platformInstructions: input.instructions.platformText, merchantInstructions: input.instructions.merchantText, publishedBehaviourPrompt: input.instructions.purposeText }), 'Only choose checkout discounts supported by current typed observations. Never search or select alternative products. First list discounts, then read details before selecting. No prose can establish eligibility.'],
                    context: { platform: input.platform, mode: input.policy.mode, lines: reconciled.lines, merchantPreferences: input.instructions.merchantText }, history: [], messages: history,
                    tools: [...(['commerce_get_discount_options', 'commerce_get_discount_details'] as const).map(name => ({ name, description: 'Read current checkout discount facts.', inputSchema: z.toJSONSchema(CommerceToolInputs[name]) })), { name: 'submitInitialOutreachOffer', description: 'Submit checkout-only identifiers for validation.', inputSchema: z.toJSONSchema(CheckoutChoiceSchema) }], maxOutputTokens: input.limits.outputTokens - tokens
                }, ports.signal)));
                tokens += step.outputTokens;
                if (tokens > input.limits.outputTokens)
                    throw new OutreachRefusal('BUDGET_EXHAUSTED');
                for (const call of step.calls) {
                    const rawChoice = call.arguments as {
                        kind?: unknown;
                    } | null;
                    if (rawChoice?.kind === 'ALTERNATIVE_PRODUCT_PROMOTION')
                        throw new OutreachRefusal('OUTSIDE_CHECKOUT');
                    if (call.name === 'submitInitialOutreachOffer') {
                        if (step.calls.length !== 1 || !optionsRead)
                            throw new OutreachRefusal('INVALID_RESULT');
                        choice = CheckoutChoiceSchema.parse(call.arguments);
                        break;
                    }
                    if (call.name !== 'commerce_get_discount_options' && call.name !== 'commerce_get_discount_details')
                        throw new OutreachRefusal('OUTSIDE_CHECKOUT');
                    const key = JSON.stringify([call.name, call.arguments]);
                    if (seen.has(key))
                        throw new OutreachRefusal('INVALID_RESULT');
                    seen.add(key);
                    if (call.name === 'commerce_get_discount_options') {
                        const args = CommerceToolInputs.commerce_get_discount_options.parse(call.arguments);
                        if (args.cursor !== (optionsRead ? nextCursor : null) || optionsRead && nextCursor === null)
                            throw new OutreachRefusal('INVALID_RESULT');
                        const output = await tool(call.name, args);
                        if ('outcome' in output)
                            throw new OutreachRefusal('PROVIDER_UNAVAILABLE');
                        if (output.mode !== input.policy.mode)
                            throw new OutreachRefusal('IDENTITY_MISMATCH');
                        for (const offer of output.offers) {
                            if (options.has(offer.offerId) && JSON.stringify(options.get(offer.offerId)) !== JSON.stringify(offer))
                                throw new OutreachRefusal('CURRENT_FACTS_CHANGED');
                            options.set(offer.offerId, offer);
                        }
                        optionsRead = true;
                        nextCursor = output.cursor ?? null;
                        incomplete = output.truncated || nextCursor !== null;
                        history.push({ tool: call.name, result: output });
                    }
                    else {
                        const args = CommerceToolInputs.commerce_get_discount_details.parse(call.arguments);
                        const option = options.get(args.offerId);
                        if (!optionsRead || !option)
                            throw new OutreachRefusal('INVALID_RESULT');
                        const details = await readDetails(args.offerId, option);
                        history.push({ tool: call.name, result: { details } });
                    }
                }
            }
            if (choice.kind === 'CHECKOUT_DISCOUNT' && choice.offerIds.some(id => !observed.has(id) || observed.get(id)!.eligibility.verdict !== 'SUPPORTED'))
                throw new OutreachRefusal('INVALID_RESULT');
            decision = choose(choice.kind === 'CHECKOUT_DISCOUNT' ? choice.offerIds : [...observed.values()].filter(o => o.eligibility.verdict === 'SUPPORTED').map(o => o.offer.offerId).sort(), incomplete);
        }
        function choose(ids: readonly string[], discoveryIncomplete: boolean): OfferDecision {
            if (!ids.length)
                return noOffer(input.policy.mode==='FIXED'&&input.policy.authorisedDiscountIds.length===0?'NO_AUTHORISED_DISCOUNTS':'NO_APPLICABLE_OFFER', discoveryIncomplete);
            const group = selectCompatibleOffers({ candidates: [...observed.values()], proposedOfferIds: ids });
            if (group.verdict !== 'SUPPORTED' || !group.offerIds.length)
                return noOffer(input.policy.mode==='FIXED'&&input.policy.authorisedDiscountIds.length===0?'NO_AUTHORISED_DISCOUNTS':'NO_APPLICABLE_OFFER', discoveryIncomplete);
            const members = group.offerIds.map(id => observed.get(id)!).map(o => ({ offerId: o.offer.offerId, providerDiscountId: o.details.providerDiscountId!, method: o.offer.method, code: o.offer.method === 'CODE' ? o.offer.code : null, description: o.offer.title, eligibility: { ...o.eligibility, eligibleLineKeys: [...o.eligibility.eligibleLineKeys], reasonCodes: [...o.eligibility.reasonCodes] } }));
            return { kind: 'CHECKOUT_DISCOUNT', offerSet: { schemaVersion: 'moda.outreach.checkout-offers.v1', offers: members.map(({ offerId, providerDiscountId, method, code }) => ({ offerId, providerDiscountId, method, code })) }, members, group: { ...group, offerIds: [...group.offerIds], reasonCodes: [...group.reasonCodes] }, discoveryIncomplete };
        }
        if (input.policy.mode === 'FIXED')
            decision = choose([...observed.values()].filter(o => o.eligibility.verdict === 'SUPPORTED').map(o => o.offer.offerId).sort(), false);
        stage = 'REVALIDATE';
        log();
        const rechecked = await readProducts(true);
        for (const [key, p] of products)
            if (currentFacts(p) !== currentFacts(rechecked.get(key)!))
                throw new OutreachRefusal('CURRENT_FACTS_CHANGED');
        if (decision.kind === 'CHECKOUT_DISCOUNT')
            for (const m of decision.members) {
                const old = observed.get(m.offerId)!;
                const details = await readDetails(m.offerId, old.offer);
                if (!details || offerFacts(details) !== offerFacts(old.details) || observed.get(m.offerId)!.eligibility.verdict !== 'SUPPORTED')
                    throw new OutreachRefusal('CURRENT_FACTS_CHANGED');
            }
        check();
        stage = 'COMPLETE';
        const result = { kind: 'ready' as const, schemaVersion: 1 as const, runId: input.runId, shopId: input.shopId, basketFingerprint: fingerprintInitialOutreachBasket(input), evaluatedAt: ports.now().toISOString(), ...reconciled, offerDecision: decision, toolActivity: activity };
        if (bytes(result) > 524288)
            throw new OutreachRefusal('RESULT_TOO_LARGE');
        const parsed = InitialOutreachEvaluationResultSchema.parse(result);
        log();
        return parsed;
    }
    catch (e) {
        const code = ports.signal.aborted ? 'CANCELLED' : ports.now().getTime() >= expires ? 'DEADLINE' : errorReason(e);
        log(code);
        return refuse(code);
    }
}
export const evaluateInitialOutreachPreview = evaluateInitialOutreach;
