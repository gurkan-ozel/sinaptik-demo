/* Tek kaynak, farklı görünürlükler. Finansal yetki veya motor durumunu değiştirmez. */
(function (A) {
  "use strict";
  var params = new URLSearchParams(location.search);
  var requested = params.get("view");
  // 16 Ekim 2026, sahip kararı: araştırma/saha görünümü kapatıldı; jüri tek ürün görünümü. Geliştirme yalnız iç test aracıdır.
  // Eski ?view=research ve study=1 adresleri jüriye düşer.
  var profile = requested === "development" ? "development" : "jury";
  var development = profile === "development";
  // 27 Ekim (sahip): "jüri canlı kısa" sürümü (?kisa=1, juri-canli-kisa.html). Jüri sunumu kendi telefonundan sahne sahne izler; sunumda olmayan özellikler çizilmez.
  var kisa = profile === "jury" && params.get("kisa") === "1";
  A.presentation = Object.freeze({
    profile: profile,
    build: "20261119-juri-3",
    // 22 Ekim (PLAN_GELECEK_EVRELERI.md): gizli sunum evresi. Varsayılan "today" = jüri görünümünün kendisi; diğerleri yalnız ?era=, Alt+1/2/3 veya E avatarına üç dokunuşla.
    initialEra: ["near", "future"].includes(params.get("era")) ? params.get("era") : "today",
    kisa: kisa,
    study: false,
    // phone=1: oturumda telefondan açılınca yalnız telefon görünür; görünüm profili ve özellikler değişmez.
    phoneOnly: params.get("phone") === "1",
    defaultReference: "inflation",
    development: development,
    // expenseChat: Aday 15 gider kırılımı sohbeti; research'teki "Neden bu tutar?" metni değişmez.
    // contrast: Akbank Mobil'de mevcut olanla demonun eklediğini ayıran kart etiketi (AKBANK_MEVCUT_OZELLIKLER.md).
    // Aday 2/13 nöbetçi kartları jüri adayında da görünür; araştırma görevlerini değiştirmez.
    // Kısa sürümde fon kartı, kartın ek bölümleri ve deneme uyarısı hiç çizilmez; onlara giden düğmeler de (gizli hedefe giden ölü düğme kalmaz).
    features: Object.freeze({ fundCard: !kisa, cardMore: !kisa, trialGuard: !kisa, chat: development, transfers: development, refunds: development, supportSummary: development, activity: development, guards: development || profile === "jury", ecosystem: development || profile === "jury", contrast: development || profile === "jury", expenseChat: development || profile === "jury" }),
    allowsTask: function (id) { return development || ["savings", "subscription"].includes(id); },
    allowsPage: function (page) { return ["home", "savings", "detail", "accounts", "comparison", "card"].includes(page) || page === "transfer" && (development || profile === "jury") || development && page === "activity"; }
  });
  document.documentElement.dataset.presentation = profile;
  document.documentElement.dataset.build = A.presentation.build;
  document.documentElement.dataset.study = String(A.presentation.study);
  document.documentElement.dataset.phoneOnly = String(A.presentation.phoneOnly || A.presentation.study);
  document.documentElement.dataset.kisa = String(A.presentation.kisa);
  if (A.presentation.study || A.presentation.phoneOnly) {
    // Test ettiğimiz ürünün açıklamalarını koru; sunumun dışarıdan öğrettiği adımları gösterme.
    // Telefon görünümü (16 Ekim, sahip): yalnız telefon; sunum paneli (#trace) ve diğer bölümler hiç çizilmez.
    document.querySelectorAll('body > .nav, main > .hero, .landing-only, #problem, #akbank, #olcum, body > .footer, #demo > .wrap > .eyebrow, #demo > .wrap > h2, #demo > .wrap > .intro, #trace').forEach(function (node) { node.hidden = true; node.setAttribute("aria-hidden", "true"); });
    document.getElementById("reset-demo").hidden = true;
  }
})(window.ARTI);
