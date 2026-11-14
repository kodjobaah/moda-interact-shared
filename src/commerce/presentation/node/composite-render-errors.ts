export type RecoveryCompositeRenderFailure='FONT_UNAVAILABLE'|'UNSUPPORTED_HEADER'|'HEADER_OVERFLOW'|'SOURCE_IDENTITY_INVALID'|'IMAGE_TRANSFORM_FAILED'|'MEDIA_DEADLINE';
export class RecoveryCompositeRenderError extends Error {
 constructor(readonly code:RecoveryCompositeRenderFailure){super(code);this.name='RecoveryCompositeRenderError';}
}
