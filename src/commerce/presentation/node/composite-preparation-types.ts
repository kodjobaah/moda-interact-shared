import type {ConversationPreparedBrandImage} from '../brand-image.js';
import type {ConversationPreparedProductImage} from '../product-image.js';
import type {ShopBrandR2Credentials,SafeFetcher,PublicMediaProbe} from './contracts.js';
import type {BrandR2Transport} from './r2-writer.js';
export type RecoveryCompositePreparationStage = 'CONFIGURATION' | 'SOURCE' | 'TRANSFORM' | 'R2' | 'PUBLIC_PROBE' | 'READY';
export type RecoveryCompositeOmission = 'CONFIGURATION_UNAVAILABLE' | 'UNSAFE_IMAGE_SOURCE' | 'SOURCE_UNAVAILABLE' | 'SOURCE_IDENTITY_INVALID' | 'FONT_UNAVAILABLE' | 'UNSUPPORTED_HEADER' | 'HEADER_OVERFLOW' | 'IMAGE_TRANSFORM_FAILED' | 'R2_UNAVAILABLE' | 'PUBLIC_IMAGE_UNAVAILABLE' | 'MEDIA_DEADLINE';
export type RecoveryCompositePreparationInput = {
  logo: ConversationPreparedBrandImage;
  product: {image: ConversationPreparedProductImage; platform:'SHOPIFY'|'WOOCOMMERCE'} | null;
  publicOrigin:string; bucketName:string; r2:ShopBrandR2Credentials; signal?:AbortSignal; deadlineAt?:number;
};
export type RecoveryCompositePreparationDependencies = {
  fetcher?:SafeFetcher;
  transportFactory?:(credentials:ShopBrandR2Credentials)=>BrandR2Transport; probe?:PublicMediaProbe; now?:()=>number;
};
