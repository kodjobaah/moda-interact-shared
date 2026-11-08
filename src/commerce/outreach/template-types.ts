import type { z } from "zod";
import type { RegistrationSchema, AssignedVariantSchema } from "./template-contracts.js";
export type RecoveryStage = "INITIAL" | "FOLLOW_UP";
export type VerifiedOfferPresentation = "NO_OFFER" | "CODE_OFFER" | "AUTOMATIC_OFFER";
export type SelectionSource = "exact" | "base" | "merchant-fallback" | "platform-fallback";
export type ShopSelectionRow = {
    id: string;
    status: string;
    defaultLanguageTag: string | null;
};
export type RegistrationRow = z.infer<typeof RegistrationSchema>;
export type AssignedVariantRow = z.infer<typeof AssignedVariantSchema>;
export type TemplateUnavailableReason = "INVALID_REQUEST" | "INVALID_LANGUAGE" | "SHOP_UNAVAILABLE" | "SENDER_UNAVAILABLE" | "SENDER_MISMATCH" | "NO_LANGUAGE" | "NO_APPROVED_ASSIGNMENT" | "LEGACY_ASSIGNMENT" | "AMBIGUOUS_ASSIGNMENT" | "REGISTRATION_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "PROVIDER_DRIFT" | "IDENTITY_MISMATCH" | "DEFINITION_UNAVAILABLE" | "LOCALE_UNAVAILABLE" | "BINDINGS_INVALID" | "BINDING_FINGERPRINT_MISMATCH" | "BINDING_VALUE_UNAVAILABLE" | "CHECKOUT_UNAVAILABLE" | "CHECKOUT_UNTRUSTED" | "MEDIA_NOT_READY" | "PROMOTION_PRODUCT_URL_UNAVAILABLE";
export type RecoveryTemplateHeaderMediaRole = "LOGO" | "SQUARE_LOGO" | "COVER_IMAGE" | "CHECKOUT_PRODUCT";
export type TextParameter = {
    type: "text";
    text: string;
};
export type PreparedMetaComponent = {
    type: "header";
    parameters: ({
        type: "text";
        text: string;
    } | {
        type: "image";
        image: {
            link: string;
        };
    })[];
} | {
    type: "body";
    parameters: TextParameter[];
} | {
    type: "button";
    sub_type: "url";
    index: string;
    parameters: readonly [
        TextParameter
    ];
};
