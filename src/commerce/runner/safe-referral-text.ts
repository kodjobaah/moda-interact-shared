import {
  resolveModaConfigurationLocale,
  type ModaSupportedLanguageTag,
} from "../../internationalization.js";

/** Host-owned referral copy: never turn unverified model text into a factual claim. */
const SAFE_REFERRAL_TEXT: Readonly<Record<ModaSupportedLanguageTag, string>> = {
  "zh-Hans": "我目前无法在这里核实或处理此请求。请直接联系商家寻求帮助。",
  "zh-Hant": "我目前無法在這裡核實或處理此請求。請直接聯絡商家尋求協助。",
  cs: "Tento požadavek nyní nemohu ověřit ani vyřídit. Obraťte se prosím přímo na obchod.",
  da: "Jeg kan ikke bekræfte eller behandle denne anmodning her lige nu. Kontakt venligst butikken direkte.",
  nl: "Ik kan dit verzoek hier momenteel niet verifiëren of afhandelen. Neem rechtstreeks contact op met de winkel.",
  en: "I can't verify or complete that request here right now. Please contact the store directly for help.",
  fi: "En voi tällä hetkellä vahvistaa tai käsitellä tätä pyyntöä täällä. Ota yhteyttä suoraan kauppaan.",
  fr: "Je ne peux pas vérifier ni traiter cette demande ici pour le moment. Veuillez contacter directement la boutique.",
  de: "Ich kann diese Anfrage hier derzeit nicht prüfen oder bearbeiten. Bitte wenden Sie sich direkt an den Shop.",
  it: "Al momento non posso verificare o gestire questa richiesta qui. Contatta direttamente il negozio.",
  ja: "現在、こちらではこのご依頼を確認または対応できません。店舗に直接お問い合わせください。",
  ko: "현재 여기서는 이 요청을 확인하거나 처리할 수 없습니다. 매장에 직접 문의해 주세요.",
  nb: "Jeg kan ikke bekrefte eller behandle denne forespørselen her nå. Kontakt butikken direkte.",
  pl: "Nie mogę teraz zweryfikować ani zrealizować tej prośby tutaj. Skontaktuj się bezpośrednio ze sklepem.",
  "pt-BR": "Não consigo verificar nem atender a esta solicitação por aqui no momento. Entre em contato diretamente com a loja.",
  "pt-PT": "Neste momento, não consigo verificar nem tratar este pedido aqui. Contacte diretamente a loja.",
  es: "No puedo verificar ni atender esta solicitud aquí en este momento. Ponte en contacto directamente con la tienda.",
  sv: "Jag kan inte verifiera eller hantera den här begäran här just nu. Kontakta butiken direkt.",
  th: "ขณะนี้ฉันไม่สามารถตรวจสอบหรือดำเนินการตามคำขอนี้ได้ กรุณาติดต่อร้านค้าโดยตรง",
  tr: "Şu anda bu talebi burada doğrulayamıyor veya işleme alamıyorum. Lütfen doğrudan mağazayla iletişime geçin.",
};

export function safeReferralText(languageTag: string | null): string {
  return SAFE_REFERRAL_TEXT[resolveModaConfigurationLocale(languageTag)];
}
