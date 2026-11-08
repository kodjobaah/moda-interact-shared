import type { OfferDecision } from './contracts.js';
import type { VerifiedOfferPresentation } from './template-types.js';

type CheckoutMember = Extract<OfferDecision, { kind: 'CHECKOUT_DISCOUNT' }>['members'][number];
export type SendableOutreachOffer = Readonly<{
    presentation: VerifiedOfferPresentation;
    members: readonly CheckoutMember[];
}>;

/** Preserve Background's largest-method-group selection and stable first-method tie. */
export function selectSendableOutreachOffer(decision: OfferDecision): SendableOutreachOffer {
    if (decision.kind === 'NO_VERIFIED_OFFER') return { presentation: 'NO_OFFER', members: [] };
    const groups = new Map<CheckoutMember['method'], CheckoutMember[]>();
    for (const member of decision.members) {
        const group = groups.get(member.method) ?? [];
        group.push(member);
        groups.set(member.method, group);
    }
    let selected: readonly CheckoutMember[] = [];
    for (const group of groups.values()) {
        if (group.length > selected.length) selected = group;
    }
    return {
        presentation: selected[0]!.method === 'CODE' ? 'CODE_OFFER' : 'AUTOMATIC_OFFER',
        members: selected,
    };
}
