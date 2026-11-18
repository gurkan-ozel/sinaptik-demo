/* Tamamen kurgusal, tarihli ve çevrimdışı demo verileri. Tutarlar kuruştur. */
window.ARTI = window.ARTI || {};
(function (A) {
  "use strict";
  A.APP_NAME = "Sinaptik";
  A.CONFIG = Object.assign({ date: "2026-10-12T09:00:00+03:00", horizon: "2026-10-31", toolDelayMs: 180, transferUndoMs: 5000, quoteTtlMs: 120000, startingCash: 9200000, useLegacyStartingCash: false }, A.CONFIG || {});
  A.USER = { name: "Deniz", today: "12 Ekim 2026" };
  A.N = 20;
  A.RESEARCH = {
    source: "Kullanıcı görüşmeleri · n=20 (ilk 12 XLSX, son 8 DOCX · katılımcı bazında kodlandı)", sourceType: "Nitel görüşme tema sayımı",
    totalProfiles: 20, actualParticipants: 20, firstRoundCoded: 12, newlyCoded: 8, recodedParticipants: 16,
    verification: "source-level-recoding-v3", codingVersion: "v3", clarifiedAt: "2026-11-13", coding: "ARASTIRMA_KODLAMA_N20.md",
    codingData: "ARASTIRMA_KODLAMA_N20_VERI.json", codingMatrix: "ARASTIRMA_KODLAMA_N20_MATRIS.csv",
    note: "Yüzdeler 20 görüşme içindeki tema sayımlarıdır. Tüm müşterilere genellenmez. Aynı kişi birden çok temada sayılabilir. Kontrol, karar verme, izleme veya müdahale ihtiyacını kapsar."
  };
  function evidence(label, n, realN) { return { label: label, n: n, denominator: A.N, percentage: n * 100 / A.N, codingVersion: A.RESEARCH.codingVersion, source: A.RESEARCH.source, sourceType: A.RESEARCH.sourceType,
    // Tarihsel alt küme: 12 Ekim'de belgelenmiş ilk 6 görüşme (Kanvas A). Güncel 20 görüşmenin kodlaması ARASTIRMA_KODLAMA_N20.md içinde (P01–P16 v2 ile aynı).
    documentedSubsetEvidence: { n: realN, denominator: 6, source: "ANLAMLANDIRMA_KANVASI_DOLDURMA.md · Kanvas A", historical: true },
    verification: A.RESEARCH.verification }; }
  A.EVIDENCE = {
    sizeOzel: evidence("Kişiselleştirilmiş öneriye inanmama", 10, 4),
    artanPara: evidence("Birikimin giderlerden sonra kalan tutara bağlı olması", 15, 4),
    niyet: evidence("Bankanın ticari çıkarını sorgulama", 7, 3),
    kati: evidence("Nakit ihtiyacına göre esnek plan / kural ihtiyacı", 8, 3),
    popup: evidence("İstenmeyen öneriyi kapatma veya rahatsızlık", 17, 3),
    otoOdeme: evidence("Rutin otomatik ödeme kullanımı", 17, 6),
    anaPara: evidence("Düşük risk / anapara koruma önceliği", 10, 5),
    kontrol: evidence("Karar veya işlem üzerinde kontrol ihtiyacı", 20, 4),
    dogrulama: evidence("Otomatik ödemeyi bildirim / ekstreyle doğrulama", 6, 3),
    manuel: evidence("Birikim / yatırımı manuel yürütme", 14, 3),
    esnekCikis: evidence("Likit erişim, iptal veya geri alma ihtiyacı", 6, 2)
  };
  A.TASKS = [
    { id: "savings", title: "Esnek birikim", eyebrow: "Nakit akışına göre", evidence: ["artanPara", "kati", "kontrol"], rationale: "Gelecek ödemeler ve nakit tamponu ayrıldıktan sonra kendi birikim hesabına aktarım planlanır." },
    { id: "subscription", title: "Otomatik ödemelerim", eyebrow: "Ücret artışını fark et", evidence: ["otoOdeme", "dogrulama"], rationale: "Otomatik ödemeler tek listede görünür. Kullanıcı isterse ücret artışlarında haber alır. Ödeme talimatı değiştirilmez." },
    { id: "bes", title: "BES katkı planı", eyebrow: "Gelecek katkını düzenle", evidence: ["kontrol", "anaPara"], rationale: "Katkı talimatı ve gelecek ödeme takvimi birlikte güncellenir. Fon dağılımı değişmez." },
    { id: "gold", title: "Altın koşul takibi", eyebrow: "Koşulu sen belirlersin", evidence: ["sizeOzel", "kontrol"], rationale: "Banka altın kotasyonu kullanıcı bütçesi ve makas koşuluyla karşılaştırılır. Alım ayrıca onaylanır." }
  ];
  A.ASSISTANT_CARDS = A.TASKS;
  // All relative dates use the controlled demo clock in Europe/Istanbul.
  A.simulationDay = function (value) {
    var stamp = typeof value === "number" ? value : Date.parse(value === undefined ? A.CONFIG.date : value);
    return Number.isFinite(stamp) ? new Date(stamp + 10800000).toISOString().slice(0, 10) : "";
  };
  A.previousSimulationDay = function (value) {
    var today = A.simulationDay(value);
    return today ? new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10) : "";
  };
  A.RULES = {
    bes: {
      id: "bes-try-2026", rateBps: 2000, annualEligibleCap: 39636000,
      effectiveFrom: "2026-01-01", validThrough: "2026-12-31", verifiedAt: "2026-10-10",
      source: "https://www.egm.org.tr/bireysel-emeklilik/devlet-katkisi/",
      conditions: "Tahmin, ödenen uygun katkı ve kalan yıllık limit içindir. Devlet katkısı takip eden ayda hesaba geçer. Hak kazanma sözleşme ve mevzuat koşullarına bağlıdır. 3/6/10 yıl için %15/%35/%60. Emeklilik, vefat veya maluliyette %100 hak kazanma."
    },
    // Sahip kararı (17 Ekim): güvenlik payı herkese aynı sabit tutar değil; kişinin kendi harcamasından gelir.
    // Varsayılan = son 12 ayın fiyatla düzeltilmiş ortalama günlük harcaması × gün sayısı, 100 TL'ye yuvarlanır.
    // ALE 7/24 satılır ve para anında vadesize geçer → 3 günlük harcama yeter. AIS iş günleri 13:00'e kadar →
    // en uzun olağan kapalı süre (Cuma 13:00 → Pazartesi 13:00) + 1–2 tatil günü = 5 gün. Kullanıcı ayarlardan değiştirirse bu kural ona dokunmaz.
    // Klasik (7.150 TL) senaryo eski sabit 1.000 TL'de kalır.
    bufferDays: { ALE: 3, AIS: 5 },
    // 26 Ekim (sahip görevi, portföy sepeti): aynı anda tutulan fon ve hisselerin nakde dönüş süresi güvenlik payına yansır.
    // Taban = 3 günlük harcama; her zaman vadesizde kalır. Pay bir gün harcanırsa onu yeniden dolduracak para yatırımlardan gelir:
    // araçlar en geç erişim süresine göre hızlıdan yavaşa sıralanır; her parça için bekleme payı = min(o parça, bekleme günlerindeki harcama).
    // Vadesizde ödemelerden sonra kalan boşta para, birikim fonuyla tek havuz sayılır (önerilen birikim o fona geçer); kendi hesapların arası aktarım payı değiştirmez.
    // Hiçbir yatırımın dolduramadığı kısım da vadesizde kalır (kullanıcı bir aracı hariç tutunca pay hiç küçülmez).
    // En geç erişim = kesim saatli araçta hafta sonu ve kesim sonrası için 2 gün + valör (iş günü). Tek fonda bufferDays ile aynı sonuç: ALE 0 gün → 3, AIS 2 gün → 5.
    // Hisse ve hisse ağırlıklı fonların fiyatı satışa kadar düşebilir: güvenlik hesabında değerin %80'i sayılır. Artı hiçbir yatırımı satmaz; yalnız hesaba katar.
    portfolio: { baseDays: 3, cutoffWaitDays: 2, haircutBps: { "düşük": 0, "yüksek": 2000 }, holidays: ["2026-10-29"],
      needPayment: { id: "renovation-oct", label: "Ev tadilatı", amount: 10000000 } },
    // Aday 13: kurgusal, açıklanabilir sinyal ağırlıkları. Gerçek dolandırıcılık modeli değildir.
    // Tutar ağırlığı en yüksek: 100.000 TL altı en fazla 65 puan alır, kalkan (≥70) açılmaz.
    scamShield: {
      weights: { redemption: 20, newPayee: 15, repeatNewPayee: 15, highAmount: 35 }, callMultiplier: 2,
      highThreshold: 70, mediumThreshold: 40, redemptionWindowMs: 3600000, coolingMs: 900000,
      // Tutar sinyali kişiye özel ve kademelidir (0–35): son 90 gündeki en büyük ödemeye oranı veya hesaplardaki toplam paraya payı; hangisi yüksekse.
      amountProfile: { windowDays: 90, ratioStart: 1.5, ratioFull: 4, shareStart: 0.4, shareFull: 0.9, baselineFloor: 100000 },
      note: ""
    },
    // Aday 2: deneme bitmeden kaç gün önce uyarılır.
    trialGuard: { noticeDays: 3 },
    // Aday 3: kontrollü dönem içinde günlük bakiye projeksiyonu. Dönem sonrası için gider uydurulmaz.
    // cashflow-24 ekstresi: klasik bakiyede 1.617,50 TL; 92.000 TL bütçede 14.400 TL (29 Ekim ×2). 24 Ekim'i güvenlik payının 400 TL altına indirir.
    cashflow: { windowDays: 30, statementAmount: { legacy: 161750, current: 1440000 } },
    // Kart ekstresi kararı (sahip planı, 20 Ekim; 22 Ekim uygulandı): asgari mi, tamamı mı. Kurgusal ekstre; banka kararı değil.
    // Asgari: BDDK 01.10.2026 / 11581 — limiti 100.000 TL'ye kadar kartlarda dönem borcunun %20'si, üstünde %40.
    // Faiz: aylık %3,25 akdi faiz (TCMB azami oranı; müşteri oranı farklı olabilir) + %15 KKDF + %15 BSMV, kalan borcun 30 gün değişmediği basit varsayımla.
    // 36.000 TL'de asgari 7.200 TL; kalan 28.800 TL için 936 TL faiz + 280,80 TL vergi = 1.216,80 TL. Kesin tutar ekstrede yazar.
    // "Önce borç": ekstrenin ödenmemiş kısmı son ödeme gününe kadar ödenecek sayılır; birikim önerisi bu paradan yapılmaz.
    cardStatement: { total: 3600000, cardLimit: 8000000, minimumBps: { upTo100k: 2000, above: 4000 }, monthlyRateBps: 325, taxBps: 3000,
      issued: "2026-10-12", due: "2026-10-22", nextCut: "2026-11-12", nextDue: "2026-11-22", source: "https://www.bddk.org.tr/Mevzuat/Liste/56",
      // 22 Ekim (sahip: "çok basic kalmış"): Kredi kartım ekranı. Kurgusal kart; dönem harcamaları 36.000 TL'yi oluşturur.
      last4: "4821", holder: "DENİZ", previous: { period: "Eylül", total: 1884000, paidOn: "2026-09-22" },
      items: [
        { date: "2026-09-14", merchant: "Migros", category: "Market", amount: 486000 },
        { date: "2026-09-18", merchant: "Shell", category: "Akaryakıt", amount: 420000 },
        { date: "2026-09-21", merchant: "Trendyol", category: "Alışveriş", amount: 696000 },
        { date: "2026-09-26", merchant: "Yemeksepeti", category: "Yemek", amount: 248000 },
        { date: "2026-09-30", merchant: "Zara", category: "Giyim", amount: 578000 },
        { date: "2026-10-03", merchant: "Turkcell", category: "Fatura", amount: 136000 },
        { date: "2026-10-06", merchant: "Migros", category: "Market", amount: 600000 },
        { date: "2026-10-09", merchant: "Pegasus", category: "Seyahat", amount: 436000 }
      ],
      // Kesimden sonraki (yeni dönem) bekleyen provizyonlar.
      provisions: [
        { date: "2026-10-12", merchant: "Migros", category: "Market", amount: 84550 },
        { date: "2026-10-12", merchant: "Starbucks", category: "Kafe", amount: 16500 }
      ] },
    // Hesap hareketleri için kişisel harcama profili: Temmuz–Eylül 2026 (son 90 gün) kategori ortancaları. Ekim hareketleri burada yoktur.
    spendProfile: { windowDays: 90, period: "Temmuz–Eylül 2026", categories: {
      coffee: { label: "kahve ve kafe", median: 14000, count: 18 }, grocery: { label: "market", median: 780000, count: 7 },
      dining: { label: "restoran", median: 70000, count: 9 }, transport: { label: "akaryakıt ve ulaşım", median: 550000, count: 3 },
      clothing: { label: "giyim", median: 90000, count: 4 }, books: { label: "kitap", median: 25000, count: 3 },
      bakery: { label: "fırın", median: 9000, count: 12 } } },
    // Aday 14: kurgusal açık bankacılık bağlantısı. Gerçek bankaya veya TCMB altyapısına bağlanılmaz.
    openBanking: { note: "" },
    // Bölüm 5: iştirak/iş ortağı etiketleri. Yalnız resmi sayfalarda doğrulanan bilgiler; demo bakiyeleri fon getirisi içermez.
    ecosystem: {
      verifiedAt: "2026-10-15", liquidTarget: 250000,
      moneyMarket: { name: "Ak Portföy Para Piyasası (TL) Fonu", code: "ALE", facts: "7/24 satış · para anında vadesizine geçer",
        // Kaynak (17 Ekim 2026, akportfoy.com.tr/tr/fon/ALE): "Satım: 24 saat satım yapılabilir", "Akbank müşterisiyseniz 7/24 işlem yapabilirsiniz",
        // "Paranız anında hesabınıza geçer". Hafta sonu ve tatilde satış, ilk iş gününün fiyatıyla yapılır.
        redeem: "Paran senin: 7/24 anında geri alabilirsin.", relation: "Akbank iştiraki Ak Portföy", url: "https://www.akportfoy.com.tr/tr/fon/ALE" },
      // Faiz hassasiyeti: yalnız kullanıcının kendi seçimiyle. Resmi sayfa (16 Ekim 2026): alım/satım resmi tatil dışında 13:00'a kadar, T+0.
      // Kesimden sonra verilen talimatın ertesi iş gününe aktarılıp aktarılmadığı sayfada yazmıyor; demo bu yüzden işlemi o an yapmaz.
      // Tatil listesi yalnız demo dönemini kapsar; 28 Ekim yarım gün uygulaması doğrulanmadı.
      participationMoneyMarket: { name: "Ak Portföy Para Piyasası Katılım Fonu", code: "AIS", facts: "alım ve satım iş günlerinde saat 13:00'e kadar · para aynı gün vadesizine geçer",
        redeem: "Paran senin: iş günleri 13:00'e kadar geri alabilirsin.", relation: "Akbank iştiraki Ak Portföy", url: "https://www.akportfoy.com.tr/tr/fon/AIS",
        cutoffMinutes: 780, cutoffLabel: "13:00", holidays: ["2026-10-29"] },
      pension: { name: "AgeSA BES", relation: "Sabancı–Ageas ortaklığı · Akbank bankasürans iş ortağı", url: "https://www.agesa.com.tr/i/Assets/pdf/2024-faaliyet-raporu.pdf" },
      goldFund: { name: "Ak Portföy Altın Fonu", code: "AFO", facts: "Günlük tek fiyat · alış-satış makası yok · fon değerinin en az %80'i altın ve altına dayalı araçlar", relation: "Ak Portföy · Akbank ve Ak Yatırım kanalları", url: "https://www.akbank.com/mevduat-yatirim/yatirim/yatirim-fonlari/degerli-emtia-fonlari/afo-ak-portfoy-altin-fonu" },
      crypto: { name: "Stablex", facts: "7/24 işlem yapılabilen kripto varlık platformu", relation: "Ak Yatırım iştiraki (2023)", url: "https://www.akbank.com/istiraklerimiz/stablex" }
    },
    // Aday 15: değişken gider tahmininin kurgusal kategori payları (toplam 10000 baz puan). Kişisel harcama verisi değildir.
    expenseCategories: [
      { id: "market", label: "Market ve mutfak", weightBps: 4200 },
      { id: "bills", label: "Faturalar (elektrik, su, doğalgaz, internet)", weightBps: 1600 },
      { id: "personal", label: "Kişisel harcamalar", weightBps: 1500 },
      { id: "transport", label: "Ulaşım", weightBps: 1000 },
      { id: "social", label: "Sosyal harcamalar", weightBps: 1700 }
    ],
    knownPaymentLabels: { bes: "BES katkı payı", subscription: "DigitalFilm aboneliği", "card-statement": "Kredi kartı ekstresi", trial: "Deneme yenilemesi" },
    // AKBANK_MEVCUT_OZELLIKLER.md: Akbank Mobil'de görülen özellik ile demonun eklediği fark. Yalnız jüri/geliştirme görünümünde gösterilir.
    existingContrast: {
      savings: { ref: "M1/M2", akbank: "Akbank Asistan ve öneri kartları", here: "ekstre, gider ve güvenlik payı aynı paradan birlikte hesaplanır" },
      cashflow: { ref: "M4", akbank: "Banking IQ nakit akışı ve harcama içgörüleri", here: "ay sonuna kadar gün gün, güvenlik payıyla birlikte" },
      openBanking: { ref: "M6", akbank: "Paranı Akbank’a Getir ile onaylı transfer", here: "öngörülen açık kadar, zamanında tamamlama önerisi" },
      shield: { ref: "M7", akbank: "Güvenlik Merkezi ve “Beni arayan Akbank mı?”", here: "görüşme + fon bozumu + yeni alıcı birlikte görülünce işlem anında durdurma" },
      trial: { ref: "M5", akbank: "düzenli ödeme toplamı", here: "deneme bitişini ilk çekimden yakalayıp yenilemeden önce sorma" },
      bes: { ref: "M10", akbank: "devlet katkısı hesaplama", here: "yalnız güvenli fazla varsa önerilir" },
      crypto: { ref: "M12", akbank: "Stablex ekranı (ayrı uygulama)", here: "yalnız bilgi, isteyince · tavsiye değil" },
      pension: { ref: "M10", akbank: "devlet katkısı hesaplama", here: "kendi BES ödemende, isteyince" },
      scan: { ref: "M18/M19", akbank: "kamerayla IBAN okuma, QR ve Kolay Adres", here: "mesaj veya belgeden alıcı, IBAN, tutar ve açıklamayı birlikte hazırlama" }
    },
    authority: {
      mode: "simulation-only", productionEnabled: false,
      note: "Asistandaki onayın banka kimlik doğrulamasının yerine geçmez. Veri işleme dayanağı, kullanıcı talimatı ve işlem türüne uygun bankacılık yetkilendirmesi ayrı kontrollerdir.",
      sources: [
        { title: "BDDK — 2023/1", url: "https://www.bddk.gov.tr/Mevzuat/DokumanGetir/1171" },
        { title: "KVKK — İşleme şartları", url: "https://www.kvkk.gov.tr/Icerik/2050/Kisisel-Veriler" },
        { title: "KVKK — İlgili kişinin hakları", url: "https://www.kvkk.gov.tr/Icerik/2036/Ilgili-Kisinin-Haklari" },
        { title: "SEDDK — BES", url: "https://seddk.gov.tr/tr/mevzuat/bireysel-emeklilik/yonetmelikler" },
        { title: "SPK — Uygunluk ve yerindelik", url: "https://spk.gov.tr/kurumlar/yatirim-kuruluslari/araci-kurumlar/uygunluk-ve-yerindelik-testleri" }
      ]
    }
  };
  A.PRESETS = [
    { id: "main", label: "Ana hikâye (92.000 TL)", note: "Maaş 87.430 TL · 92.000 TL vadesiz bakiye · 42.000 TL kalan gider (market, faturalar vb.) · 6.000 TL güvenlik payı (3 günlük harcama, ALE · AIS 5 gün = 10.000 TL) · 44.000 TL ayrılabilir güvenli bütçe · fon 7/24 anında vadesize döner." },
    { id: "legacy", label: "Klasik bakiye (7.150 TL)", note: "1.200 TL ayrılabilir → 800 TL aktar → 1.800 TL yeni gider → 1.400 TL dönüş taslağı." },
    { id: "bounded", label: "Otomatik para ayırma", note: "800 TL ayrılabilir. Otomatik para ayırma kapalı başlar. Birikim ayarlarından açılabilir." },
    { id: "subscription", label: "Otomatik ödemeler", note: "Ücret artışlarında haber almayı aç; 200 → 280 TL olayını dene ve ödemelerini tek listede gör." },
    { id: "bes", label: "BES", note: "1.800 → 2.500 TL katkı taslağı oluştur. Onay yalnızca gelecek takvimi değiştirir." },
    { id: "security", label: "Güvenlik (fonda 250.000 TL)", note: "Likit fonda 250.000 TL. Yeni alıcıya IBAN gir. Fon bozdurma ve bilinmeyen arama sinyalleriyle risk puanının yükselişini izle." },
    { id: "gold", label: "Altın", note: "Bütçe ve makas koşulu belirle. Dar kotasyon olayını tetikle, güncel teklifi onayla." },
    { id: "portfolio", label: "Portföy sepeti (5 yatırım)", note: "x1 likit fon (birikim fonu) 4.000 TL · x2 borçlanma fonu T+1 12.000 TL · x3 hisse fonu T+2 24.000 TL · x4 hisse T+2 18.000 TL · x5 yabancı hisse fonu T+3 30.000 TL (uzun vadeli, acil durumda kullanılmaz). Boşta para varken pay 6.000 TL. Yarınki 100.000 TL ödemeyle boşta para kalmaz, pay x2 beklendiği için 12.000 TL olur." }
  ];
  A.EVENTS = [
    { id: "expense", label: "Yeni gider · 3.600 TL" },
    { id: "subscription-price", label: "Abonelik · 200 → 280 TL" },
    { id: "gold-narrow", label: "Altın fiyat farkı · %0,80" },
    { id: "gold-wide", label: "Altın fiyat farkı · %2,10" },
    { id: "quote-expire", label: "Teklif süresini doldur" },
    { id: "refund-full", label: "İade · Cafe Nero (2.100 TL tam)" },
    { id: "refund-partial", label: "İade · Cafe Nero (1.000 TL kısmi)" },
    { id: "scam-call", label: "Güvenlik · Hazır senaryo: arama + fon bozumu + 230.000 TL yeni IBAN", guard: true },
    // 29 Ekim · kısa sürüm Kalkan sahnesi: aynı başlangıç, transferi kullanıcı kendisi gönderir. Yan panelde düğmesi yok.
    { id: "scam-setup", label: "Güvenlik · arama + fon bozumu (transferi kullanıcı gönderir)", guard: true, internal: true },
    // Arama olayları yalnız telefondaki "112 arıyor" bandından ve "Bitir" düğmesinden gelir; yan panelde düğmeleri yoktur.
    { id: "call-start", label: "Güvenlik · 112 araması (transfer sayfasından)", guard: true, internal: true },
    { id: "call-end", label: "Güvenlik · Aramayı bitir", guard: true, internal: true },
    { id: "shield-time", label: "Güvenlik beklemesi · 15 dk ileri al", guard: true },
    // 20 Ekim: kullanıcı korumayı görüşme sürerken kaldıramaz; temsilcinin kaldırması moderatör panelinden canlandırılır.
    { id: "rep-release", label: "Güvenlik · Temsilci korumayı kaldırır", guard: true },
    { id: "fund-cutoff", label: "Fon saati · Saati 13:30'a al (AIS işlem saati dışı)", guard: true },
    { id: "cashflow-24", label: "Nakit akışı · 24 Ekim kart ekstresi + 25 Ekim masraf iadesi", guard: true },
    { id: "card-statement", label: "Kart ekstresi · 36.000 TL, son ödeme 22 Ekim (asgari mi, tamamı mı)", guard: true },
    { id: "portfolio-need", label: "Portföy · yarın 100.000 TL tadilat ödemesi (yalnız portföy senaryosunda)", guard: true }
  ];
  A.createFixture = function (preset) {
    var isLegacy = (preset === "legacy" || (A.CONFIG && A.CONFIG.useLegacyStartingCash));
    var rawTx = [
      // 1 Ekim 2026 (3 işlem: Maaş [giriş], Restoran [çıkış], Bilet iadesi [giriş])
      { id: "fixture-0", ref: "REF-TX-0", at: "2026-10-01T09:00:00+03:00", amount: 4250000, label: "Maaş", category: "salary", merchant: "Akbank Genel Müdürlük" },
      { id: "fixture-16", ref: "REF-TX-16", at: "2026-10-01T13:00:00+03:00", amount: -85000, label: "Restoran · Akşam Yemeği", category: "dining", merchant: "Midpoint Zorlu Center" },
      { id: "fixture-17", ref: "REF-TX-17", at: "2026-10-01T18:00:00+03:00", amount: 85000, label: "Geri Ödeme · Konser Bileti İadesi", category: "refund", merchant: "Biletix / Passo İade" },

      // 3 Ekim 2026 (3 işlem: Kira [çıkış], Konut ortak masrafı [çıkış], Danışmanlık [giriş])
      { id: "fixture-1", ref: "REF-TX-1", at: "2026-10-03T09:00:00+03:00", amount: -1500000, label: "Kira", category: "rent", merchant: "Ev Sahibi Kira" },
      { id: "fixture-14", ref: "REF-TX-14", at: "2026-10-03T11:00:00+03:00", amount: -120000, label: "Konut Ortak Masrafı · Yönetim", category: "housing", merchant: "Site Yönetimi Hesabı" },
      { id: "fixture-15", ref: "REF-TX-15", at: "2026-10-03T16:00:00+03:00", amount: 120000, label: "Gelen Havale · Danışmanlık Geliri", category: "income", merchant: "Danışmanlık Hizmetleri" },

      // 5 Ekim 2026 (3 işlem: Faturalar [çıkış], Fırın [çıkış], ATM nakit yatırma [giriş])
      { id: "fixture-2", ref: "REF-TX-2", at: "2026-10-05T09:00:00+03:00", amount: -285000, label: "Faturalar", category: "bills", merchant: "Elektrik & Su Otomatik Ödeme" },
      { id: "fixture-12", ref: "REF-TX-12", at: "2026-10-05T08:30:00+03:00", amount: -12000, label: "Fırın · Tarihi Taş Fırın", category: "bakery", merchant: "Tarihi Taş Fırın" },
      { id: "fixture-13", ref: "REF-TX-13", at: "2026-10-05T14:10:00+03:00", amount: 12000, label: "Nakit Yatırma · Akbank ATM", category: "deposit", merchant: "Akbank ATM Levent" },

      // 8 Ekim 2026 (3 işlem: Akaryakıt/Ulaşım [çıkış], Kitapçı [çıkış], Arkadaş transferi [giriş])
      { id: "fixture-3", ref: "REF-TX-3", at: "2026-10-08T09:00:00+03:00", amount: -600000, label: "Kredi kartı · Akaryakıt ve Ulaşım", category: "transport", merchant: "Opet Petrol Ataşehir" },
      { id: "fixture-10", ref: "REF-TX-10", at: "2026-10-08T12:00:00+03:00", amount: -18000, label: "Kitapçı · D&R Kültür", category: "books", merchant: "D&R Mağazası" },
      { id: "fixture-11", ref: "REF-TX-11", at: "2026-10-08T17:45:00+03:00", amount: 18000, label: "Gelen Havale · Burak Yılmaz", category: "p2p", merchant: "Burak Yılmaz" },

      // 9 Ekim 2026 (3 işlem: BES ek katkı [çıkış], arkadaş transferi [giriş], yurt dışı kripto platformuna FAST [çıkış]).
      // BES/transfer çifti birbirini nötrler; kripto transferi için açılış bakiyesi 1.500 TL yüksektir. Bugünkü bakiye değişmez.
      // Ek katkı `bank.bes.annualPaid` içine eklenmedi (BES tahmini testleri sabit kalsın diye; jüride BES görevi kapalı).
      { id: "fixture-19", ref: "REF-TX-19", at: "2026-10-09T08:00:00+03:00", amount: -60000, label: "BES ek katkı · AgeSA", category: "pension", merchant: "AgeSA Hayat ve Emeklilik" },
      { id: "fixture-20", ref: "REF-TX-20", at: "2026-10-09T12:30:00+03:00", amount: 60000, label: "Gelen Havale · Deniz Aksoy", category: "p2p", merchant: "Deniz Aksoy" },
      { id: "fixture-18", ref: "REF-TX-18", at: "2026-10-09T20:15:00+03:00", amount: -150000, label: "FAST · Yurt dışı kripto platformu", category: "crypto-platform", merchant: "Yurt dışı kripto platformu", channel: "FAST" },

      // 10 Ekim 2026 (3 işlem: Market [çıkış], Giyim [çıkış], Mağaza iadesi [giriş])
      { id: "fixture-4", ref: "REF-TX-4", at: "2026-10-10T09:00:00+03:00", amount: -940000, label: "Market ve gündelik", category: "grocery", merchant: "Migros Ticaret A.Ş." },
      { id: "fixture-8", ref: "REF-TX-8", at: "2026-10-10T11:20:00+03:00", amount: -45000, label: "Giyim · Boyner Kanyon", category: "clothing", merchant: "Boyner Büyük Mağazacılık" },
      { id: "fixture-9", ref: "REF-TX-9", at: "2026-10-10T15:30:00+03:00", amount: 45000, label: "İade · Online Sipariş İptali", category: "refund", merchant: "Online Alışveriş İade" },

      // 11 Ekim 2026 (Bugün - 3 işlem: Cafe Nero [çıkış], Eczane [çıkış], Arkadaş transferi [giriş])
      { id: "fixture-5", ref: "REF-TX-5", at: "2026-10-11T09:00:00+03:00", amount: -210000, label: "Cafe Nero Levent", category: "coffee", merchant: "Caffè Nero" },
      { id: "fixture-6", ref: "REF-TX-6", at: "2026-10-11T13:15:00+03:00", amount: -35000, label: "Eczane · Levent Eczanesi", category: "health", merchant: "Levent Eczanesi" },
      { id: "fixture-7", ref: "REF-TX-7", at: "2026-10-11T16:40:00+03:00", amount: 35000, label: "Gelen Havale · Selin Kaya", category: "p2p", merchant: "Selin Kaya" }
    ];
    // 29 Ekim (sahip): canlı hikâyede maaş 42.500 TL "kimse için gerçekçi değil" → 87.430 TL; diğer tutarlar yaklaşık ×2 (oranlar aynı).
    // Klasik geliştirme bakiyesi (7.150 TL) değişmez. Maaş dışındaki Ekim hareketleri ×2; açılış bakiyesi bugünü 92.000 TL'ye getirir.
    if (!isLegacy) rawTx = rawTx.map(function (tx) { return Object.assign({}, tx, { amount: tx.category === "salary" ? 8743000 : tx.amount * 2 }); });
    var spendBasis = isLegacy ?
      [537750, 582750, 642750, 687750, 597750, 717750, 552750, 672750, 627750, 567750, 702750, 642750] :
      [5271000, 5727000, 6327000, 6765000, 5874000, 7068000, 5430000, 6612000, 6198000, 5592000, 6906000, 6630000];
    var besMonthly = isLegacy ? 70000 : 180000, k = isLegacy ? 1 : 2;
    return {
      // Kişisel harcama profilinin (RULES.spendProfile, Temmuz–Eylül ortancaları) bu başlangıçtaki ölçeği: canlı hikâyede ×2, klasikte ×1.
      spendScale: k,
      accounts: [
        { id: "cash", label: "Vadesiz", owner: "elif", currency: "TRY", opening: isLegacy ? 150000 : 7827000 },
        { id: "savings", label: "Likit birikim", owner: "elif", currency: "TRY", opening: preset === "security" ? 25000000 : preset === "portfolio" ? 400000 : isLegacy ? 280000 : 11200000 }
      ],
      // 26 Ekim: aynı anda tutulan diğer fon ve hisseler (kurgusal x2–x5; gerçek fon değildir). Değerler sabittir, fiyat hareketi simüle edilmez.
      // Birikim fonu ayrı hesapta (savings) tutulur; portföy senaryosunda adı x1'dir. useForSafety: kullanıcının "acil durumda kullanılabilir" tercihi.
      savingsAlias: preset === "portfolio" ? "x1" : null,
      holdings: preset !== "portfolio" ? [] : [
        { id: "x2", name: "Kısa vadeli borçlanma fonu", kind: "fon", amount: 1200000, settlementDays: 1, cutoffMinutes: 810, cutoffLabel: "13:30", risk: "düşük", useForSafety: true },
        { id: "x3", name: "Hisse senedi fonu", kind: "fon", amount: 2400000, settlementDays: 2, cutoffMinutes: 810, cutoffLabel: "13:30", risk: "yüksek", useForSafety: true },
        { id: "x4", name: "Hisse senedi", kind: "hisse", amount: 1800000, settlementDays: 2, cutoffMinutes: 1080, cutoffLabel: "18:00", risk: "yüksek", useForSafety: true },
        { id: "x5", name: "Yabancı hisse fonu", kind: "fon", amount: 3000000, settlementDays: 3, cutoffMinutes: 810, cutoffLabel: "13:30", risk: "yüksek", useForSafety: false, longTerm: true }
      ],
      transactions: rawTx.map(function (tx) {
        return {
          id: tx.id,
          ref: tx.ref,
          at: tx.at,
          kind: "settled-expense",
          label: tx.label,
          category: tx.category,
          merchant: tx.merchant,
          postings: [{ account: "cash", amount: tx.amount }],
          status: "settled"
        };
      }),
      // Twelve completed months of fictional variable spending, separate from the ledger.
      // Known payment obligations are excluded here and added from the dated schedule.
      // Legacy: average 6,277.50 TL -> 4.050 TL remaining + 900 TL known = 4.950 TL expected.
      // Live: average 62,000 TL (market, faturalar, ulaşım vb.) -> 40.000 TL remaining + 2.000 TL known (BES 1.800 + DigitalFilm 200) = 42.000 TL expected.
      history: spendBasis.map(function (currentPriceSpend, i) {
        var priceIndex = 10000 + i * 160;
        return { period: new Date(Date.UTC(2025, 9 + i, 1)).toISOString().slice(0, 7),
          variableSpend: currentPriceSpend * priceIndex / 12000, priceIndex: priceIndex };
      }),
      expensePriceBasis: { period: "2026-10", index: 12000, source: "fictional" },
      variableAdjustment: preset === "bounded" ? 40000 : 0,
      // Aday 15: kullanıcının kategori bazında verdiği kalan dönem tahmini (kuruş). Boşken tahmin değişmez.
      expenseOverrides: {},
      // Abonelik ve deneme fiyatları gelirle ölçeklenmez; BES katkısı canlı hikâyede maaşa göre 1.800 TL.
      payments: [
        { id: "bes-oct", orderId: "bes-elif", due: "2026-10-15", kind: "bes", amount: besMonthly, status: "pending" },
        { id: "subscription-oct", orderId: "digital-film", due: "2026-10-20", kind: "subscription", amount: 20000, status: "pending", obligation: true },
        { id: "bes-nov", orderId: "bes-elif", due: "2026-11-15", kind: "bes", amount: besMonthly, status: "pending" },
        { id: "bes-dec", orderId: "bes-elif", due: "2026-12-15", kind: "bes", amount: besMonthly, status: "pending" }
      ],
      subscription: { id: "digital-film", type: "bank-payment-mandate", mandateStatus: "active", previousAmount: 20000, amount: 20000, priceChanged: false, obligationConfirmed: true },
      // Kurgusal talimat kataloğu. Fatura kırılımı geçmişteki 2.850 TL toplu kaydıdır;
      // yeni fatura gelmeden bu tutarlar gelecek gider tahminine eklenmez.
      automaticPaymentOrders: [
        { id: "digital-film", label: "DigitalFilm", kind: "subscription", status: "active" },
        { id: "bes-elif", label: "BES katkısı", kind: "bes", status: "active" },
        { id: "electricity", label: "Elektrik", kind: "bill", status: "active", lastAmount: 125000 * k, lastPaid: "2026-10-05", nextDue: "2026-11-05" },
        { id: "water", label: "Su", kind: "bill", status: "active", lastAmount: 40000 * k, lastPaid: "2026-10-05", nextDue: "2026-11-05" },
        { id: "internet", label: "İnternet", kind: "bill", status: "active", lastAmount: 120000 * k, lastPaid: "2026-10-05", nextDue: "2026-11-05" }
      ],
      // Kurgusal "Kayıtlı işlemler". Gerçek kişi/IBAN değildir; tutar kayıtlı şablondan gelir.
      savedTransfers: [
        { id: "saved-mom", label: "Annem", note: "Aylık destek", payee: "Fatma Özdemir", ibanMask: "TR** **** 4821", amount: 50000 * k },
        { id: "saved-flatmate", label: "Ev arkadaşım", note: "Ortak market payı", payee: "Ayşe Demir", ibanMask: "TR** **** 7310", amount: 35000 * k },
        { id: "saved-rent", label: "Ev sahibi", note: "Kira", payee: "Mehmet Kaya", ibanMask: "TR** **** 1096", amount: 1500000 * k }
      ],
      priceAlerts: { enabled: false, version: 0, reference: null },
      notifications: [],
      bes: { id: "bes-elif", monthly: besMonthly, annualPaid: besMonthly * 9 },
      gold: { quantityMg: 0 },
      quote: { id: "quote-1", bid: 391600, ask: 400000, at: Date.parse(A.CONFIG.date), expiresAt: Date.parse(A.CONFIG.date) + A.CONFIG.quoteTtlMs },
      refundTrackers: {},
      // Kart doğrulama provizyonu kesinleşmiş harcama değildir; serbest bırakıldığı için bakiyeyi değiştirmez.
      cardAuthorizations: [
        { id: "auth-streambox", merchant: "Netflix", amount: 100, at: "2026-10-01T20:00:00+03:00", kind: "verification", status: "released" }
      ],
      // Aday 2: provizyondan türetilen kurgusal deneme. Yenileme ancak kullanıcı devam ederse gider tahminine girer.
      trials: [
        { id: "trial-streambox", merchant: "Netflix", authorizationId: "auth-streambox", trialDays: 14, startedOn: "2026-10-01",
          endsOn: "2026-10-15", renewalDue: "2026-10-15", renewalAmount: 48000, period: "monthly", status: "detected", decisionRef: null }
      ],
      cardControls: [],
      // Aday 13: kurgusal sosyal mühendislik senaryosu. Gerçek kişi/IBAN değildir.
      scamScenario: { payee: "Güvenli Hesap Hizmetleri", ibanMask: "TR** **** 9047", amount: 23000000, note: "Hesap güvenliği" },
      // Aday 3: yalnız onaylı, tarihli girişler projeksiyona alınır. Varsayılan boştur.
      incoming: [],
      liquidityReserve: null,
      // Aday 14: kullanıcının açık bankacılık rızasıyla bağlı kurgusal diğer banka hesabı. Akbank bakiyesine dahil değildir.
      linkedAccounts: [
        { id: "ext-other", label: "Diğer Banka · Vadesiz", institution: "Diğer Banka", ibanMask: "TR** **** 6630", currency: "TRY", balance: 185000 * k,
          consent: { status: "active", scopes: ["balance", "payment-initiation"], grantedOn: "2026-09-01", expiresOn: "2027-03-01" } }
      ],
      // Bölüm 5/Stablex: Temmuz–Eylül özet kaydı; Ekim hesap hareketlerine ve bakiyeye dahil değildir (Ekim transferi fixture-18).
      externalOutflows: [
        { id: "out-1", date: "2026-07-18", channel: "FAST", category: "crypto-platform", counterparty: "Yurt dışı kripto platformu", amount: 150000 },
        { id: "out-2", date: "2026-08-14", channel: "EFT", category: "crypto-platform", counterparty: "Yurt dışı kripto platformu", amount: 200000 },
        { id: "out-3", date: "2026-09-10", channel: "FAST", category: "crypto-platform", counterparty: "Yurt dışı kripto platformu", amount: 100000 }
      ]
    };
  };
  A.getRefundTrackerStatus = function (tracker, transactions) {
    if (!tracker || !tracker.enabled) return null;
    var origRef = tracker.originalRef;
    var matchedRefunds = (transactions || []).filter(function (tx) {
      if (tx.status !== "settled") return false;
      var cashPosting = (tx.postings || []).find(function (p) { return p.account === "cash"; });
      if (!cashPosting || cashPosting.amount <= 0) return false;
      var isRefundKind = tx.kind === "refund" || tx.category === "refund" || tx.type === "refund";
      var refMatches = (tx.relatedRef === origRef) || (tx.originalRef === origRef);
      return isRefundKind && refMatches;
    });

    var received = matchedRefunds.reduce(function (sum, tx) {
      var p = tx.postings.find(function (x) { return x.account === "cash"; });
      return sum + (p ? p.amount : 0);
    }, 0);

    var status = "pending";
    if (received >= tracker.expectedAmount) {
      status = "completed";
    } else if (received > 0) {
      status = "partial";
    }

    var statusText = status === "completed" ? "Tamamlandı" : status === "partial" ? "Kısmen geldi" : "Bekleniyor";

    return {
      originalRef: origRef,
      expectedAmount: tracker.expectedAmount,
      receivedAmount: received,
      remainingAmount: Math.max(0, tracker.expectedAmount - received),
      status: status,
      statusText: statusText,
      matchedRefunds: matchedRefunds
    };
  };
  A.money = function (kurus) {
    return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: kurus % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(kurus / 100) + " TL";
  };
  A.fmt = function (lira) { return A.money(Math.round(lira * 100)); };
  A.pct = function (n) { return Math.round(n / A.N * 100); };
  // Aday 5: belgeden ödeme. Sunum için panoda hazır bir mesaj ve iki örnek dosya (PDF, fotoğraf) vardır.
  // Alanlar A.extractPayment ile metinden gerçekten ayrıştırılır; dış OCR/LLM çağrısı yapılmaz, dosya metni burada tanımlıdır.
  // IBAN'lar kontrol hanesi (mod 97) geçerli örneklerdir.
  A.SCAN = Object.freeze({
    clipboard: "Mehmet Demirci TR92 0006 2001 1900 0006 2976 30 açıklama kısmına taksi ücreti yazarsanız sevinirim",
    files: Object.freeze([
      { id: "dues-pdf", kind: "pdf", name: "Ekim_2026_aidat_bildirimi.pdf", size: "148 KB", title: "Site aidatı bildirimi",
        text: "MAVİ KENT SİTESİ YÖNETİMİ\nEkim 2026 aidat bildirimi · Daire 12\nÖdenecek tutar: 2.450,00 TL\nSon ödeme: 25.10.2026\nAlıcı: Mavi Kent Sitesi Yönetimi\nIBAN: TR44 0001 0002 0100 0012 3456 78\nAçıklama: Daire 12 Ekim aidatı" },
      { id: "service-photo", kind: "photo", name: "IMG_2041.jpg", size: "2,1 MB", title: "Kombi servisi faturası",
        text: "USTA ISI TEKNİK\nKombi bakım + conta değişimi\nİşçilik 1.200,00 TL · Parça 2.000,00 TL\nTOPLAM 3.200,00 TL\nAlıcı: Usta Isı Teknik Ltd.\nIBAN: TR55 0001 5001 5800 7312 3456 01" }
    ])
  });
  // Hesap hareketleri: varsayılan renk nötr; kırmızı yalnız kişiye göre olağan dışı çıkışta ("Senin için olağan mı?" mantığı).
  // Kategori harcaması → aynı kategoride son 90 günün ortancasının `ratio` katı ve üstü; kategorisiz transfer → kalkanın profili gibi
  // son 90 günün en büyük ödemesinin `largestRatio` katı ve üstü; her durumda işlem sonrası güvenlik payının altına inmek.
  // Yükümlülükler (kira, fatura, konut, BES, abonelik, ekstre), kayıtlı alıcılar ve kendi hesaplar arası aktarım kıyaslanmaz.
  A.LEDGER_ATTENTION = Object.freeze({ ratio: 2, largestRatio: 1.5, obligationCategories: ["rent", "bills", "housing", "pension"], sensitiveCategories: ["health"], obligationKinds: ["bes", "subscription", "card-statement", "card-pay", "card-subscription", "saved-transfer"], ownKinds: ["save", "recover", "redeem", "gold-buy", "fund-switch", "card-topup"] });
  A.ledgerAttention = function (transactions, opts) {
    var rules = A.LEDGER_ATTENTION, o = opts || {}, profile = o.categoryProfile || {}, out = {}, balance = o.openingCash || 0;
    var cashOf = function (tx) { return (tx.postings || []).filter(function (x) { return x.account === "cash"; }).reduce(function (n, x) { return n + x.amount; }, 0); };
    var times = function (r) { return (r >= 10 ? Math.round(r) : Math.round(r * 10) / 10).toLocaleString("tr-TR"); };
    (transactions || []).filter(function (tx) { return tx.status === "settled" || tx.status === undefined; }).slice().sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); }).forEach(function (tx) {
      var amount = cashOf(tx); balance += amount;
      if (amount >= 0 || rules.ownKinds.includes(tx.kind)) return;
      if (Number.isFinite(o.buffer) && balance < o.buffer) { out[tx.id] = { reason: "Hesabın güvenlik payının altına indi", kind: "buffer" }; return; }
      // Sağlık gibi hassas kategoriler kişisel profil kıyasına hiç girmez (SA-03); yalnız güvenlik payı kuralı yukarıda geçerlidir.
      if (rules.obligationCategories.includes(tx.category) || rules.sensitiveCategories.includes(tx.category) || rules.obligationKinds.includes(tx.kind)) return;
      var cat = tx.category && profile[tx.category], spent = -amount;
      if (cat && cat.median > 0) {
        var r = spent / cat.median;
        if (r >= rules.ratio) out[tx.id] = { reason: "Senin için olağan dışı · " + cat.label + " için genelde " + A.money(cat.median) + " harcıyorsun, bu " + times(r) + " katı", kind: "category", ratio: r };
      } else if (!cat && o.largestPayment > 0 && spent / o.largestPayment >= rules.largestRatio) {
        out[tx.id] = { reason: "Senin için olağan dışı · bugüne kadarki en büyük ödemenin " + times(spent / o.largestPayment) + " katı", kind: "largest", ratio: spent / o.largestPayment };
      }
    });
    return out;
  };
  A.ibanChecksumValid = function (raw) {
    var iban = String(raw || "").replace(/\s+/g, "").toUpperCase();
    if (!/^TR\d{24}$/.test(iban)) return false;
    var digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); }), rest = 0;
    for (var i = 0; i < digits.length; i++) rest = (rest * 10 + Number(digits[i])) % 97;
    return rest === 1;
  };
  // Metinden alıcı, IBAN, tutar, açıklama ve son ödeme tarihini çıkarır. Bulunamayan alan null kalır; kullanıcı doldurur.
  A.extractPayment = function (text) {
    var t = String(text || ""), lines = t.split(/\n/), out = { payee: null, iban: null, ibanValid: false, amount: null, note: null, due: null };
    var ibanMatch = t.match(/TR\s?\d{2}(?:\s?\d{4}){5}\s?\d{2}/i);
    if (ibanMatch) { var raw = ibanMatch[0].replace(/\s+/g, "").toUpperCase(); out.iban = raw.replace(/(.{4})/g, "$1 ").trim(); out.ibanValid = A.ibanChecksumValid(raw); }
    var label = function (re) { for (var i = 0; i < lines.length; i++) { var m = lines[i].match(re); if (m) return m[1].trim(); } return null; };
    var name = label(/^\s*(?:alıcı|alici|ad soyad|hesap sahibi)\s*:\s*(.+)$/i);
    if (!name && ibanMatch) {
      var before = t.slice(0, ibanMatch.index).replace(/(iban|hesap)\s*:?\s*$/i, "").trim().split(/\s+/).filter(function (w) { return /^[A-ZÇĞİÖŞÜ][a-zçğıöşü]+$/.test(w); });
      if (before.length) name = before.slice(-3).join(" ");
    }
    if (name) out.payee = name.toLocaleUpperCase("tr-TR");
    var amounts = [], re = /(toplam|tutar|ödenecek)?[^\d\n]{0,12}?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s?(?:TL|₺|lira)/gi, m;
    while ((m = re.exec(t))) amounts.push({ keyed: !!m[1], kurus: Math.round(Number(m[2].replace(/\./g, "").replace(",", ".")) * 100) });
    var pick = amounts.filter(function (a) { return a.keyed; }).pop() || (amounts.length === 1 ? amounts[0] : null);
    if (pick && Number.isSafeInteger(pick.kurus) && pick.kurus > 0) out.amount = pick.kurus;
    var note = (t.match(/açıklama\s*:\s*([^\n.?!]+)/i) || [])[1] || null;
    if (!note) { var n = t.match(/açıklama(?:\s+kısmına|\s+kismina|ya|sına)?\s+(.+?)\s+yaz/i); if (n) note = n[1]; }
    if (note) out.note = note.charAt(0).toLocaleUpperCase("tr-TR") + note.slice(1);
    var d = t.match(/son ödeme\s*:?\s*(\d{2})\.(\d{2})\.(\d{4})/i);
    if (d) out.due = d[3] + "-" + d[2] + "-" + d[1];
    return out;
  };
  // 16 Ekim görüşmesi: katılımcı "1.500,50" gibi Türkçe yazımla tutar giremedi. Binlik nokta + ondalık virgül kabul edilir;
  // "100.150" binlik ayraçlı sayılır (100.150 TL), "101.65" eskisi gibi ondalıktır.
  A.parseMoney = function (value) {
    var s = String(value).replace(/[\s\u00a0]+/g, "").replace(/TL$/i, "");
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "");
    if (!/^\d{1,8}([.,]\d{1,2})?$/.test(s)) return null;
    var n = Math.round(Number(s.replace(",", ".")) * 100);
    return Number.isSafeInteger(n) ? n : null;
  };
  A.escape = function (text) { return String(text).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  A.trNormalize = function (s) {
    if (!s) return "";
    return String(s)
      .replace(/İ/g, "i")
      .replace(/I/g, "ı")
      .replace(/Ğ/g, "ğ")
      .replace(/Ü/g, "ü")
      .replace(/Ş/g, "ş")
      .replace(/Ö/g, "ö")
      .replace(/Ç/g, "ç")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/ğ/g, "g")
      .replace(/ü/g, "u")
      .replace(/ş/g, "s")
      .replace(/ö/g, "o")
      .replace(/ç/g, "c")
      .trim();
  };
  A.SEMANTIC_INTENTS = [
    {
      id: "coffee",
      terms: ["kahve", "kahveci", "coffee", "cafe", "caffe", "kafe", "espresso", "latte", "cappuccino", "starbucks", "nero", "tchibo", "çay", "icecek", "içecek"],
      matches: function (tx) {
        var text = (tx.label || "") + " " + (tx.merchant || "") + " " + (tx.category || "");
        return /cafe|kafe|nero|starbucks|kahve|coffee|tchibo/i.test(text) || tx.category === "coffee";
      }
    },
    {
      id: "grocery",
      terms: ["market", "bakkal", "supermarket", "süpermarket", "gida", "gıda", "mutfak", "alisveris", "alışveriş", "migros", "carrefour", "sok", "şok", "bim", "a101", "manav", "kasap", "gundelik", "gündelik"],
      matches: function (tx) {
        var text = (tx.label || "") + " " + (tx.merchant || "") + " " + (tx.category || "");
        return /market|migros|carrefour|bakkal|gundelik|gündelik|gida|gıda/i.test(text) || tx.category === "grocery";
      }
    },
    {
      id: "bills",
      terms: ["fatura", "faturalar", "faturam", "abonelik", "abone", "elektrik", "su", "dogalgaz", "doğalgaz", "gaz", "internet", "aidat", "iski", "enerjisa", "bedas"],
      matches: function (tx) {
        var text = (tx.label || "") + " " + (tx.merchant || "") + " " + (tx.category || "");
        return /fatura|elektrik|su|dogalgaz|doğalgaz|internet|aidat|abone/i.test(text) || tx.category === "bills";
      }
    },
    {
      id: "transport",
      terms: ["yakit", "yakıt", "benzin", "mazot", "dizel", "akaryakit", "akaryakıt", "petrol", "opet", "shell", "bp", "ulasim", "ulaşım", "otopark", "hgs", "ogs", "yol", "araba", "arac", "araç", "taksi"],
      matches: function (tx) {
        var text = (tx.label || "") + " " + (tx.merchant || "") + " " + (tx.category || "");
        return /yakit|yakıt|benzin|akaryakit|akaryakıt|petrol|opet|shell|ulasim|ulaşım/i.test(text) || tx.category === "transport";
      }
    },
    {
      id: "rent",
      terms: ["kira", "kiram", "ev", "konut", "ev sahibi"],
      matches: function (tx) {
        var text = (tx.label || "") + " " + (tx.merchant || "") + " " + (tx.category || "");
        return /kira/i.test(text) || tx.category === "rent";
      }
    },
    {
      id: "salary",
      terms: ["maas", "maaş", "gelir", "aylik", "aylık", "bordro", "ucret", "ücret", "avans"],
      matches: function (tx) {
        var text = (tx.label || "") + " " + (tx.merchant || "") + " " + (tx.category || "");
        return /maas|maaş|gelir/i.test(text) || tx.category === "salary";
      }
    },
    {
      id: "card",
      terms: ["kart", "kredi karti", "kredi kartı", "ekstre", "borc", "borç"],
      matches: function (tx) {
        var text = (tx.label || "") + " " + (tx.merchant || "") + " " + (tx.category || "");
        return /kredi kart|ekstre/i.test(text) || tx.category === "card";
      }
    },
    {
      id: "savings",
      terms: ["birikim", "tasarruf", "aktarim", "aktarım", "virman", "ayir", "ayır"],
      matches: function (tx) {
        return tx.kind === "save" || /birikim/i.test(tx.label || "");
      }
    },
    {
      id: "recovery",
      terms: ["donus", "dönüş", "hesabima al", "hesabıma al", "geri al"],
      matches: function (tx) {
        return tx.kind === "recover" || /alindi|alındı|donus|dönüş/i.test(tx.label || "");
      }
    },
    {
      id: "refund",
      terms: ["iade", "iadem", "geri odeme", "geri ödeme"],
      matches: function (tx) {
        return tx.kind === "refund" || tx.category === "refund" || /iade/i.test(tx.label || "");
      }
    },
    {
      id: "unexpected",
      terms: ["beklenmedik", "surpriz", "sürpriz", "acil"],
      matches: function (tx) {
        return tx.kind === "new-expense" || /beklenmedik/i.test(tx.label || "");
      }
    },
    {
      id: "gold",
      terms: ["altin", "altın", "gold", "ziynet", "gram", "sarraf"],
      matches: function (tx) {
        return tx.kind === "gold-buy" || /altın|altin/i.test(tx.label || "");
      }
    }
  ];
  var TR_MONTHS_DATA = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  var STOPWORDS = {
    "ve": true, "ile": true, "de": true, "da": true, "veya": true,
    "icin": true, "bir": true, "bu": true, "son": true, "tum": true,
    "her": true, "ayki": true, "gunku": true, "olan": true,
    "ay": true, "ayi": true, "gun": true, "gunu": true
  };
  var GENERIC_TX_TERMS = {
    "harcama": true, "harcamasi": true, "harcamalar": true, "harcamalari": true,
    "gider": true, "gideri": true, "giderler": true, "giderleri": true,
    "odeme": true, "odemesi": true, "odemeler": true, "odemeleri": true,
    "masraf": true, "masrafi": true, "masraflar": true, "masraflari": true,
    "para": true, "parasi": true, "islem": true, "islemi": true, "islemler": true,
    "tutar": true, "tutari": true,
    "bedel": true, "bedeli": true, "bedelleri": true
  };

  function termMatches(token, term) {
    if (token === term) return true;
    if (/^[a-z0-9.]+$/.test(token) && /^[a-z0-9.]+$/.test(term)) {
      if (term.length >= 4 && token.indexOf(term) === 0) return true;
      if (token.length >= 4 && term.indexOf(token) === 0) return true;
    }
    return false;
  }

  function matchTokenAgainstTx(token, tx, keywords) {
    for (var i = 0; i < keywords.length; i++) {
      if (termMatches(token, keywords[i])) return true;
    }
    for (var j = 0; j < A.SEMANTIC_INTENTS.length; j++) {
      var intent = A.SEMANTIC_INTENTS[j];
      if (!intent.matches(tx)) continue;
      for (var k = 0; k < intent.terms.length; k++) {
        var termNorm = A.trNormalize(intent.terms[k]);
        if (termMatches(token, termNorm)) return true;
      }
    }
    return false;
  }

  A.matchTransactionSemantic = function (tx, rawQuery, referenceNow) {
    if (!rawQuery) return true;
    var normQuery = A.trNormalize(rawQuery);
    if (!normQuery) return true;

    var hasPlus = /(?:^|\s)\+\s*\d/.test(rawQuery);
    var hasMinus = /(?:^|\s)[-−]\s*\d/.test(rawQuery);
    var cashPosting = (tx.postings || []).find(function (p) { return p.account === "cash"; });
    if (cashPosting) {
      if (hasPlus && cashPosting.amount < 0) return false;
      if (hasMinus && cashPosting.amount > 0) return false;
    }

    var cleanQuery = normQuery
      .replace(/(\d+)\/(\d+)(?:\/(\d+))?/g, function (m, d, mo, y) { return y ? (d + "." + mo + "." + y) : (d + "." + mo); })
      .replace(/,00(?![0-9])/g, "")
      .replace(/,0(?![0-9])/g, "");

    var keywords = [];
    var phrases = [];

    function addPhrase(str) {
      if (!str) return;
      var norm = A.trNormalize(str);
      if (!norm) return;
      phrases.push(norm);
      var words = norm.split(/[\s,;&/\\!?:()+−-]+/).filter(Boolean);
      for (var w = 0; w < words.length; w++) {
        if (keywords.indexOf(words[w]) === -1) keywords.push(words[w]);
      }
    }

    addPhrase(tx.label);
    addPhrase(tx.merchant);
    addPhrase(tx.category);
    if (tx.kind === "save") {
      addPhrase("Birikimine ayrıldı");
      addPhrase("birikim");
      addPhrase("tasarruf");
    } else if (tx.kind === "recover") {
      addPhrase("Birikiminden hesabına alındı");
      addPhrase("birikim");
      addPhrase("iade");
      addPhrase("hesabıma al");
    } else if (tx.kind === "new-expense") {
      addPhrase("Beklenmedik gider");
      addPhrase("gider");
    } else if (tx.kind === "gold-buy") {
      addPhrase("Altın hesabına alım");
      addPhrase("altın");
      addPhrase("altin");
    } else if (tx.kind === "saved-transfer") {
      addPhrase("transfer");
      addPhrase("havale");
      addPhrase("kayıtlı işlem");
    }

    if (cashPosting) {
      var amountLira = cashPosting.amount / 100;
      var absLira = Math.abs(amountLira);
      var sAmount = String(amountLira);
      var sAbs = String(absLira);
      if (keywords.indexOf(sAmount) === -1) keywords.push(sAmount);
      if (keywords.indexOf(sAbs) === -1) keywords.push(sAbs);
      addPhrase(A.money(cashPosting.amount));
      addPhrase(A.money(Math.abs(cashPosting.amount)));
      if (cashPosting.amount < 0) {
        addPhrase("- " + A.money(Math.abs(cashPosting.amount)));
      } else if (cashPosting.amount > 0) {
        addPhrase("+ " + A.money(Math.abs(cashPosting.amount)));
      }
      var formattedNum = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: cashPosting.amount % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(absLira);
      if (keywords.indexOf(formattedNum) === -1) keywords.push(formattedNum);
    }

    if (tx.at) {
      var ymd = A.simulationDay(tx.at);
      var parts = ymd.split("-");
      if (parts.length === 3) {
        var day = parseInt(parts[2], 10);
        var mIdx = parseInt(parts[1], 10) - 1;
        var month = TR_MONTHS_DATA[mIdx] || "";
        var year = parts[0];
        if (keywords.indexOf(ymd) === -1) keywords.push(ymd);
        var dotDate = parts[2] + "." + parts[1] + "." + year;
        var dotShort = parts[2] + "." + parts[1];
        if (keywords.indexOf(dotDate) === -1) keywords.push(dotDate);
        if (keywords.indexOf(dotShort) === -1) keywords.push(dotShort);
        var slashDate = parts[2] + "/" + parts[1] + "/" + year;
        var slashShort = parts[2] + "/" + parts[1];
        if (keywords.indexOf(slashDate) === -1) keywords.push(slashDate);
        if (keywords.indexOf(slashShort) === -1) keywords.push(slashShort);
        addPhrase(day + " " + month);
        addPhrase(day + " " + month + " " + year);
        addPhrase(month + " " + year);
        addPhrase(month);
        addPhrase(slashDate);
        addPhrase(slashShort);
        var sDay = String(day);
        if (keywords.indexOf(sDay) === -1) keywords.push(sDay);
        if (parts[2] !== sDay && keywords.indexOf(parts[2]) === -1) keywords.push(parts[2]);
      }
      if (ymd === A.simulationDay(referenceNow)) {
        addPhrase("bugun");
        addPhrase("bugün");
      }
      if (ymd === A.previousSimulationDay(referenceNow)) {
        addPhrase("dun");
        addPhrase("dün");
      }
    }

    for (var p = 0; p < phrases.length; p++) {
      var ph = phrases[p];
      if (ph === normQuery || ph === cleanQuery) return true;
      if (normQuery.length >= 3) {
        var escaped = normQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        var rx = new RegExp("(^|\\s)" + escaped + "($|\\s)");
        if (rx.test(ph)) return true;
      }
      if (cleanQuery !== normQuery && cleanQuery.length >= 3) {
        var escapedClean = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        var rxClean = new RegExp("(^|\\s)" + escapedClean + "($|\\s)");
        if (rxClean.test(ph)) return true;
      }
    }

    var rawTokens = cleanQuery.split(/[\s,;&/\\!?:()+−-]+/).filter(Boolean);
    if (rawTokens.length === 0) return false;

    var specificTokens = rawTokens.filter(function (t) { return !STOPWORDS[t] && !GENERIC_TX_TERMS[t]; });
    var tokens;
    if (specificTokens.length > 0) {
      tokens = specificTokens;
    } else {
      var hasGeneric = rawTokens.some(function (t) { return GENERIC_TX_TERMS[t]; });
      if (hasGeneric) return true;
      tokens = rawTokens.filter(function (t) { return !STOPWORDS[t]; });
      if (tokens.length === 0) tokens = rawTokens;
    }

    for (var t = 0; t < tokens.length; t++) {
      if (!matchTokenAgainstTx(tokens[t], tx, keywords)) return false;
    }
    return true;
  };

  /* ===== Varlık Getirisi ve Referans Karşılaştırma Modeli ===== */
  A.COMPARISON = {
    baseAmount: 1000000, // 10.000 TL (kuruş cinsinden)
    period: "Son 6 Ay (Nisan 2026 – Ekim 2026)",
    months: ["Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki"],
    monthDates: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
    monthNames: ["Nisan 2026", "Mayıs 2026", "Haziran 2026", "Temmuz 2026", "Ağustos 2026", "Eylül 2026", "Ekim 2026"],
    references: [
      { id: "deposit", label: "Vadeli Mevduat", description: "Net getiri · Stopaj düşülmüş" },
      { id: "participation", label: "Katılım Hesabı", description: "Kâr payı net getiri · Faizsiz alternatif" },
      { id: "inflation", label: "Enflasyon", description: "Fiyat artışı · Başlangıçtaki alım gücünü koruma eşiği" },
      { id: "fund", label: "Hisse / BIST Fonu", description: "Hisse senedi fonu getirisi" },
      { id: "none", label: "Referansı Kapat", description: "Yalnızca altın getirisi" }
    ],
    series: {
      gold: {
        id: "gold",
        label: "Gram Altın",
        values: [1000000, 1025000, 1070000, 1092000, 1135000, 1182000, 1215000],
        assumptions: "Alış-satış makas farkı ve maliyetler seriye dahildir."
      },
      deposit: {
        id: "deposit",
        label: "Vadeli Mevduat",
        values: [1000000, 1032000, 1065000, 1099000, 1134000, 1170000, 1208000],
        assumptions: "Vergi ve maliyet etkisi dahil net seri. Güncel mevduat oranı veya banka teklifi değildir."
      },
      participation: {
        id: "participation",
        label: "Katılım Hesabı",
        values: [1000000, 1028000, 1057000, 1087000, 1117000, 1148000, 1180000],
        assumptions: "Net kâr payı serisi. Gelecekteki dağıtım oranına ilişkin vaat değildir."
      },
      inflation: {
        id: "inflation",
        label: "Enflasyon",
        values: [1000000, 1030000, 1048000, 1074000, 1101000, 1134000, 1168000],
        assumptions: "Fiyat artışı serisi. Çizgi, başlangıçtaki 10.000 TL'nin alım gücünü korumak için gereken tutarı gösterir. TÜİK verisi veya nakit getirisi değildir."
      },
      fund: {
        id: "fund",
        label: "Hisse / BIST Fonu",
        values: [1000000, 1040000, 1085000, 1120000, 1160000, 1205000, 1240000],
        assumptions: "Fon maliyetleri dahil seri. BIST 100 endeksinin performansı değildir."
      }
    }
  };

  A.getAssetComparison = function (assetId, refId) {
    assetId = assetId || "gold";
    refId = refId || "deposit";
    var asset = A.COMPARISON.series[assetId] || A.COMPARISON.series.gold;
    assetId = asset.id;
    var isNone = refId === "none";
    var ref = isNone ? null : (A.COMPARISON.series[refId] || A.COMPARISON.series.deposit);
    refId = ref ? ref.id : "none";
    var base = A.COMPARISON.baseAmount;
    var months = A.COMPARISON.months;
    var monthNames = A.COMPARISON.monthNames;
    var referenceIsInflation = !!ref && ref.id === "inflation";
    var comparisonPurpose = !ref ? "standalone" : referenceIsInflation ? "purchasing-power" : "alternative-return";
    var purposeLabel = !ref ? "Değer değişimi" : referenceIsInflation ? "Alım gücü açısından" : "Alternatif getiri açısından";
    var comparisonExplanation = !ref ? "Referans kapalı. Yalnızca seçilen varlığın değer değişimi gösteriliyor."
      : referenceIsInflation ? "Enflasyon çizgisi, başlangıçtaki alım gücünü korumak için gereken tutarı gösterir. Bir yatırımın getirisi değildir."
      : "Aynı başlangıç tutarı ve dönemde iki net değer karşılaştırılır. Referans bir getiri garantisi veya alım önerisi değildir.";
    if (!Number.isSafeInteger(base) || base <= 0 || months.length < 2 || monthNames.length !== months.length) {
      throw new RangeError("Karşılaştırma için geçerli ortak başlangıç tutarı ve dönem gerekir.");
    }
    [asset, ref].filter(Boolean).forEach(function (series) {
      if (series.values.length !== months.length || series.values[0] !== base || series.values.some(function (value) {
        return !Number.isSafeInteger(value) || value < 0 || (series.id === "inflation" && value === 0);
      })) throw new RangeError("Karşılaştırma serileri aynı başlangıç tutarı, dönem ve sonlu değerleri kullanmalıdır.");
    });

    var points = [];
    for (var i = 0; i < months.length; i++) {
      var aVal = asset.values[i];
      var rVal = ref ? ref.values[i] : null;
      var diff = ref ? (aVal - rVal) : null;
      var diffPct = (ref && base > 0) ? ((diff / base) * 100) : null;
      // Divide nominal value by the cumulative price factor, rather than subtracting inflation.
      var realReturn = referenceIsInflation ? ((aVal / base) / (rVal / base) - 1) : null;
      var status = "standalone";
      if (ref) {
        if (diff > 0) status = "above";
        else if (diff < 0) status = "below";
        else status = "equal";
      }
      points.push({
        index: i,
        month: months[i],
        monthLong: monthNames[i],
        assetValue: aVal,
        refValue: rVal,
        diff: diff,
        diffPercent: diffPct,
        diffPercentagePoints: diffPct,
        realReturn: realReturn,
        realReturnPct: realReturn === null ? null : realReturn * 100,
        status: status
      });
    }

    var lastIdx = months.length - 1;
    var finalAsset = asset.values[lastIdx];
    var finalRef = ref ? ref.values[lastIdx] : null;
    var finalDiff = ref ? (finalAsset - finalRef) : null;
    var finalGainAsset = finalAsset - base;
    var finalGainAssetPct = (finalGainAsset / base) * 100;
    var finalGainRef = ref ? (finalRef - base) : null;
    var finalGainRefPct = ref ? ((finalGainRef / base) * 100) : null;
    var finalDiffPct = ref ? ((finalDiff / base) * 100) : null;
    var finalRealReturn = referenceIsInflation ? ((1 + finalGainAssetPct / 100) / (1 + finalGainRefPct / 100) - 1) : null;
    var finalPurchasingPowerValue = referenceIsInflation ? Math.round(finalAsset / (finalRef / base)) : null;

    var status = "standalone";
    var statusText = "";
    var narrative = "";

    if (!ref) {
      status = "standalone";
      statusText = "Referans kapalı · " + asset.label + " net getirisi: " + A.money(finalGainAsset) + " (%" + finalGainAssetPct.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ")";
      narrative = A.money(base) + " başlangıç tutarı ile son 6 ayda " + asset.label + " net " + A.money(finalAsset) + " değerine ulaştı (toplam net getiri " + A.money(finalGainAsset) + "). Karşılaştırma referansı kapalı.";
    } else if (referenceIsInflation) {
      status = finalDiff > 0 ? "above" : finalDiff < 0 ? "below" : "equal";
      var realPctText = Math.abs(finalRealReturn * 100).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      statusText = "Alım gücü " + (finalDiff > 0 ? "%" + realPctText + " arttı" : finalDiff < 0 ? "%" + realPctText + " azaldı" : "korundu") + " · Son 6 ay";
      narrative = A.money(base) + " başlangıç tutarı " + A.money(finalAsset) + " oldu. Başlangıçtaki alım gücünü korumak için dönem sonunda " + A.money(finalRef) + " gerekiyor. Enflasyondan arındırılmış değer, başlangıç dönemi fiyatlarıyla " + A.money(finalPurchasingPowerValue) + ". Nominal değişimden fiyat artışını çıkarmak yerine değer, fiyat artış katsayısına bölünür.";
    } else if (finalDiff > 0) {
      status = "above";
      var diffStr = "+" + A.money(finalDiff);
      var pctStr = "+" + finalDiffPct.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " yüzde puan";
      statusText = "Altın referansın üzerinde: " + diffStr + " (" + pctStr + ")";
      narrative = A.money(base) + " başlangıç tutarı için 6 ay sonunda: Altın " + A.money(finalAsset) + ", " + ref.label + " ise " + A.money(finalRef) + " seviyesine ulaştı. Altın, seçilen referansın " + A.money(finalDiff) + " (" + pctStr + ") üzerinde gerçekleşti. Bu karşılaştırma geçmiş değerleri gösterir. Gelecekteki sonucu veya alım kararını belirlemez.";
    } else if (finalDiff < 0) {
      status = "below";
      var absDiff = Math.abs(finalDiff);
      var pctStr = "−" + Math.abs(finalDiffPct).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " yüzde puan";
      statusText = "Altın referansın altında: −" + A.money(absDiff) + " (" + pctStr + ")";
      narrative = A.money(base) + " başlangıç tutarı için 6 ay sonunda: Altın " + A.money(finalAsset) + ", " + ref.label + " ise " + A.money(finalRef) + " seviyesine ulaştı. Altın, seçilen referansın " + A.money(absDiff) + " (" + pctStr + ") altında kaldı. Bu karşılaştırma geçmiş değerleri gösterir. Gelecekteki sonucu veya alım kararını belirlemez.";
    } else {
      status = "equal";
      statusText = "Altın referans ile eşit: 0 TL (%0,0)";
      narrative = A.money(base) + " başlangıç tutarı için her iki seri de 6 ay sonunda aynı değere (" + A.money(finalAsset) + ") ulaştı.";
    }

    return {
      assetId: assetId,
      refId: refId,
      assetLabel: asset.label,
      refLabel: ref ? ref.label : "Referans Yok",
      referenceIsInflation: referenceIsInflation,
      comparisonPurpose: comparisonPurpose,
      purposeLabel: purposeLabel,
      comparisonExplanation: comparisonExplanation,
      period: A.COMPARISON.period,
      baseAmount: base,
      months: months,
      points: points,
      finalAsset: finalAsset,
      finalRef: finalRef,
      finalDiff: finalDiff,
      finalDiffPercent: finalDiffPct,
      finalDifferencePercentagePoints: finalDiffPct,
      finalRealReturn: finalRealReturn,
      finalRealReturnPct: finalRealReturn === null ? null : finalRealReturn * 100,
      finalInflationPct: referenceIsInflation ? finalGainRefPct : null,
      finalPurchasingPowerValue: finalPurchasingPowerValue,
      finalPurchasingPowerChange: finalPurchasingPowerValue === null ? null : finalPurchasingPowerValue - base,
      finalGainAsset: finalGainAsset,
      finalGainAssetPct: finalGainAssetPct,
      finalGainRef: finalGainRef,
      finalGainRefPct: finalGainRefPct,
      status: status,
      statusText: statusText,
      narrative: narrative,
      disclaimer: {
        fictionalLabel: "",
        period: A.COMPARISON.period,
        assetAssumptions: asset.assumptions,
        refAssumptions: ref ? ref.assumptions : "Referans karşılaştırması kapalıdır.",
        normalizationNote: "Ham gram fiyatı bakiye ile doğrudan kıyaslanmamış. Tüm seriler 10.000 TL ortak başlangıç tutarı üzerinden hesaplanmıştır.",
        comparisonPurpose: comparisonExplanation,
        metricNote: referenceIsInflation ? "Reel değişim = (1 + nominal getiri) / (1 + fiyat artışı) − 1. Getiri ile fiyat artışı arasındaki yüzde puan farkı reel getiri değildir."
          : "Getiri farkı yüzde puanla ifade edilir. Bir serinin diğerine göre yüzdesel artışı veya enflasyondan arındırılmış getirisi değildir.",
        ethicsNote: "Geçmiş getiri geleceğin göstergesi değildir. Yatırım tavsiyesi içermez."
      }
    };
  };
})(window.ARTI);
