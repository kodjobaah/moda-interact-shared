import type { ModaSupportedLanguageTag } from "../../internationalization.js";
const labels: Record<ModaSupportedLanguageTag, readonly [string,string,string]> = {
 "zh-Hans":["商品详情不可用。","商品信息不完整。","所选选项"],"zh-Hant":["商品詳情無法取得。","商品資訊不完整。","所選選項"],
 cs:["Podrobnosti produktu nejsou dostupné.","Informace o produktu jsou neúplné.","Vybrané možnosti"],da:["Produktoplysninger er ikke tilgængelige.","Produktoplysningerne er ufuldstændige.","Valgte muligheder"],nl:["Productdetails zijn niet beschikbaar.","De productinformatie is onvolledig.","Geselecteerde opties"],en:["Product details are unavailable.","Product information is incomplete.","Selected options"],fi:["Tuotetietoja ei ole saatavilla.","Tuotetiedot ovat puutteelliset.","Valitut vaihtoehdot"],fr:["Les détails du produit sont indisponibles.","Les informations du produit sont incomplètes.","Options sélectionnées"],de:["Produktdetails sind nicht verfügbar.","Die Produktinformationen sind unvollständig.","Ausgewählte Optionen"],it:["I dettagli del prodotto non sono disponibili.","Le informazioni sul prodotto sono incomplete.","Opzioni selezionate"],ja:["商品詳細を確認できません。","商品情報は完全ではありません。","選択したオプション"],ko:["제품 세부 정보를 확인할 수 없습니다.","제품 정보가 완전하지 않습니다.","선택한 옵션"],nb:["Produktdetaljer er ikke tilgjengelige.","Produktinformasjonen er ufullstendig.","Valgte alternativer"],pl:["Szczegóły produktu są niedostępne.","Informacje o produkcie są niepełne.","Wybrane opcje"],"pt-BR":["Os detalhes do produto estão indisponíveis.","As informações do produto estão incompletas.","Opções selecionadas"],"pt-PT":["Os detalhes do produto estão indisponíveis.","As informações do produto estão incompletas.","Opções selecionadas"],es:["Los detalles del producto no están disponibles.","La información del producto está incompleta.","Opciones seleccionadas"],sv:["Produktinformation är inte tillgänglig.","Produktinformationen är ofullständig.","Valda alternativ"],th:["ไม่มีรายละเอียดสินค้า","ข้อมูลสินค้าไม่ครบถ้วน","ตัวเลือกที่เลือก"],tr:["Ürün ayrıntıları mevcut değil.","Ürün bilgileri eksik.","Seçilen seçenekler"]};
export const productFactMessages = Object.freeze(labels);

/** Aggregate sellable counts for the exact selected identity, never a fulfillment promise. */
export const stockFactMessages:Readonly<Record<ModaSupportedLanguageTag,readonly [string,string,string,string]>>=Object.freeze({
 en:['Stock (product)','Stock (selected variant)','Stock is not tracked.','Stock is unavailable.'],
 'zh-Hans':['库存（商品）','库存（所选款式）','未跟踪库存。','库存信息不可用。'],
 'zh-Hant':['庫存（商品）','庫存（所選款式）','未追蹤庫存。','庫存資訊無法取得。'],
 cs:['Zásoby (produkt)','Zásoby (vybraná varianta)','Zásoby nejsou sledovány.','Zásoby nejsou dostupné.'],
 da:['Lager (produkt)','Lager (valgt variant)','Lager spores ikke.','Lageroplysninger er ikke tilgængelige.'],
 nl:['Voorraad (product)','Voorraad (geselecteerde variant)','Voorraad wordt niet bijgehouden.','Voorraad is niet beschikbaar.'],
 fi:['Varasto (tuote)','Varasto (valittu vaihtoehto)','Varastoa ei seurata.','Varastotietoja ei ole saatavilla.'],
 fr:['Stock (produit)','Stock (variante sélectionnée)','Le stock n’est pas suivi.','Le stock est indisponible.'],
 de:['Bestand (Produkt)','Bestand (ausgewählte Variante)','Der Bestand wird nicht verfolgt.','Der Bestand ist nicht verfügbar.'],
 it:['Scorte (prodotto)','Scorte (variante selezionata)','Le scorte non sono monitorate.','Le scorte non sono disponibili.'],
 ja:['在庫（商品）','在庫（選択したバリエーション）','在庫は追跡されていません。','在庫情報を確認できません。'],
 ko:['재고 (제품)','재고 (선택한 옵션)','재고를 추적하지 않습니다.','재고 정보를 확인할 수 없습니다.'],
 nb:['Lager (produkt)','Lager (valgt variant)','Lager spores ikke.','Lagerinformasjon er ikke tilgjengelig.'],
 pl:['Stan magazynowy (produkt)','Stan magazynowy (wybrany wariant)','Stan magazynowy nie jest śledzony.','Stan magazynowy jest niedostępny.'],
 'pt-BR':['Estoque (produto)','Estoque (variante selecionada)','O estoque não é acompanhado.','O estoque está indisponível.'],
 'pt-PT':['Stock (produto)','Stock (variante selecionada)','O stock não é acompanhado.','O stock está indisponível.'],
 es:['Existencias (producto)','Existencias (variante seleccionada)','No se realiza seguimiento de existencias.','Las existencias no están disponibles.'],
 sv:['Lager (produkt)','Lager (vald variant)','Lager spåras inte.','Lagerinformation är inte tillgänglig.'],
 th:['สต็อก (สินค้า)','สต็อก (ตัวเลือกที่เลือก)','ไม่มีการติดตามสต็อก','ไม่มีข้อมูลสต็อก'],
 tr:['Stok (ürün)','Stok (seçilen varyant)','Stok takip edilmiyor.','Stok bilgisi mevcut değil.']
});
