/* Görünüm katmanı. Finansal kayıtları yalnızca agent.dispatch değiştirebilir. */
(function (A) {
  "use strict";
  var presentation = A.presentation;
  var view = { page: "home", active: 0, message: "", transferNoticeId: null, expandedDays: {}, ledgerSearch: "", selectedGoldRef: presentation.defaultReference, selectedGoldPoint: 6, shareOpen: false, shareCustomNote: undefined, refundFormOpen: null, dismissedRefundNoticeId: null, humanReviewOpen: false, transferReviewOpen: false, chatOpen: false, chatMessages: [], chatReviewTaskId: null, shieldReviewOpen: false, shieldDismissed: false, dismissedTrials: {}, liquidityDismissed: null, cryptoDismissed: false, transferLabOpen: false, stmt: { choice: "full", custom: "", pending: null, sent: null, dismissed: false } }, lastStatus = "", reviewedPlan = null, commandSerial = 0;
  // 22 Ekim (evre-1): gizli sunum evresi view dışında tutulur; reset() view'i yeniden kurar ama evreyi korur. Motor durumuna dokunmaz.
  function newNear() { return { ruleBuffer: true, ruleCardSweep: true, ruleAutoSave: true, cycleStep: 0, cycleSent: false, undone: false, amount: 0, plan: null, busy: false, error: "", sweep: { busy: false, sent: 0, skipped: false } }; }
  // İki ajan isteği ayrı durum tutar; aralarında geçmek ilerlemeyi silmez (ana sayfadaki istek listesi ikisini birlikte gösterir).
  function newBudget() { return { step: 1, choice: "", sent: false, priceOpen: false, priceAt: 0 }; }
  function newKya() { return { stopped: false, summaryOpen: false }; }
  function newSpoof() { return { working: false, stopped: false, summaryOpen: false }; }
  function newFuture(mode) { return { mode: mode || "budget", budget: newBudget(), kya: newKya(), spoof: newSpoof(), agents: { travel: true, shop: true, askFirst: true, antiProfiling: true, saveFirst: false }, agentsOpen: false, picked: false }; }
  var era = { era: presentation.initialEra || "today", barOpen: false, taps: [], near: newNear(), future: newFuture(), status: "" };
  // Jüri canlı kısa: sunumun sahneleri. Her sahne temiz başlangıçla tek ekranda açılır (iki ayrı başlangıç karşılaştırılır, SUNUM_AKISI §4).
  // 5 Kasım (sahip): Ekstre ayrı sahne değil. Kart borcu gelince hesabın yeniden yapılması sıradışı bir özellik değil, Birikim turunun içinde gösterilir.
  var KISA_SCENES = [
    // 5 Kasım (sahip): kart ekstresi Birikim'de baştan hesapta (son 12 ayın harcamasından tahmin edilebilir, şok değil).
    // Tutarlar (sahip, 5 Kasım): ekstre 18.000 → öneri 26.000, beklenmedik masraf 12.000 → 14.000. Varsayılan jüri görünümünde ekstre 36.000 kalır.
    { id: "birikim", label: "Birikim", aria: "Bugün · birikim önerisi ve kart ekstresi", era: "today", scenario: "card-statement", amount: 1800000 },
    // 5 Kasım (fraud uzmanı): arama başka telefondan gelir; banka uygulaması aramayı görmez (device: "other").
    { id: "kalkan", label: "Kalkan", aria: "Bugün · dolandırıcılık kalkanı", era: "today", scenario: "scam-call", before: "scam-setup", device: "other" },
    { id: "kurallar", label: "Kurallar", aria: "Yakın gelecek · demo · kuralların", era: "near" },
    { id: "ajanlar", label: "Ajanlar", aria: "Ajanlar çağı · vizyon demosu · ajan istekleri", era: "future" }
  ], kisaScene = null, sceneSerial = 0, kisaStarted = true, kisaStartError = "";
  // 29 Ekim (sahip): vakalar hazır gelmez. Sahne sakin açılır, seçicinin altındaki kartta "Senaryoyu başlat"a basınca gelir.
  // Kart telefon ekranının değil sunum seçicisinin parçası. Ajanlarda her istek ayrı başlatılır.
  var KISA_START = {
    birikim: { page: "home", title: "Birikim önerisi", copy: "Maaşın yattı. Sinaptik bu ay ne kadar ayırabileceğini hesapladı.", cases: [["birikim", "Senaryoyu başlat"]] },
    kalkan: { page: "home", title: "Dolandırıcılık", copy: "Başka telefonun çalıyor. Arayan kendini 112 olarak tanıtıyor.", cases: [["scam", "Senaryoyu başlat"]] },
    kurallar: { page: "savings", badge: "Yakın gelecek · Demo", title: "Kuralı ajan önerir, sen açarsın", copy: "Sinaptik seni tanıyıp sana özel kurallar önerir; açtıklarının içinde ayı yürütür. Ay ortasında beklenmedik bir gider de gelecek.", cases: [["near", "Senaryoyu başlat"]] },
    ajanlar: { page: "home", badge: "Ajanlar çağı · Vizyon demosu", title: "Ajanlar senin adına ödeme ister", copy: "Bir senaryo seç. Biri bitince sıradakini dene.", cases: [["budget"], ["kya"], ["spoof"]] }
  };
  // 29 Ekim (sahip): ajan senaryolarının adı ne olduğunu söylesin ("Seyahat ajanı" fiyat kalkanı olduğunu anlatmıyordu).
  var AGENT_CASES = {
    budget: { title: "Fiyat kalkanı ve hedef çatışması", sub: "Seyahat ajanı 28.000 TL'lik bilet almak istiyor" },
    kya: { title: "Yetki aşımı", sub: "Alışveriş ajanı 130.000 TL'yi yeni bir IBAN'a göndermek istiyor" },
    spoof: { title: "Sahte satıcı ajanı", sub: "Kulaklık siparişinde karşı satıcı doğrulanamıyor · 8.400 TL" }
  };
  // Biten sahne ve ajan senaryoları sahne değişince de hatırlanır: seçicide ✓, başlatma kartında ✓ ve sıradaki öne çıkar.
  var kisaDone = {};
  var KISA_NEXT = { birikim: "kalkan", kalkan: "kurallar", kurallar: "ajanlar" };
  var statusNames = { monitoring: "Takipte", awaiting: "Karar sende", pending: "Transfer hazırlanıyor", cancelled: "Transfer iptal edildi", running: "İşlemin yapılıyor", unknown: "Sonuç kontrol edilmeli", succeeded: "Tamamlandı", blocked: "Şu an uygun değil", failed: "İşlem tamamlanamadı", paused: "Takip kapalı" };
  var kindNames = { save: "Birikimine ayır", recover: "Birikiminden hesabına al", "bes-change": "Aylık BES katkını değiştir", "gold-buy": "Altın al", "saved-transfer": "Kayıtlı transfer", "payee-transfer": "Yeni alıcıya transfer", "trial-block": "Deneme yenilemesini engelle", "trial-continue": "Denemeye devam et", "ob-pull": "Diğer bankadan aktar", redeem: "Birikimini boz" };
  var TRIAL_KINDS = ["trial-block", "trial-continue"], TRANSFER_KINDS = ["saved-transfer", "payee-transfer"], OB_KINDS = ["ob-pull"], guardHtml = {};
  var cardTitles = { savings: "Bu ay kendine bir pay ayır", subscription: "Ücret artışları gözden kaçmasın", bes: "BES katkında küçük bir adım", gold: "Altın alırken fiyat farkını takip et" };
  var phases = { session: "Oturum", perception: "Algılama", tool: "Araç", reasoning: "Planlama", guardrail: "Sınır", approval: "Onay", authorization: "Ön yetki", pending: "Gönderim bekliyor", cancel: "İptal", action: "İşlem", "tool-result": "Yanıt", verified: "Doğrulama", event: "Olay", replan: "Yeni plan", error: "Hata", uncertainty: "Belirsizlik", monitor: "İzleme", goal: "Hedef", permission: "İzin", control: "Kontrol", review: "İnceleme", notification: "Bildirim", shield: "Güvenlik" };
  function el(id) { return document.getElementById(id); }
  function text(id, value) { el(id).textContent = value; }
  function activeId() { return A.TASKS[view.active].id; }
  function visible(id, show) { el(id).hidden = !show; }
  function rows(items) { return '<dl class="rows">' + items.map(function (r) { return '<div><dt>' + A.escape(r[0]) + '</dt><dd>' + A.escape(r[1]) + '</dd></div>'; }).join("") + '</dl>'; }
  function badge(s) { return '<span class="agent-status ' + A.escape(s) + '">' + A.escape(statusNames[s] || s) + '</span>'; }
  function goldQuantity(mg) { return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(mg / 1000) + " gram"; }
  function sourceLink(url, label) { return '<a class="source-link" href="' + A.escape(url) + '" target="_blank" rel="noopener noreferrer">' + A.escape(label) + '</a>'; }
  function journalDetail(e) {
    var d = e.detail;
    if (e.phase === "reasoning") {
      var calculation = kindNames[d.kind] + " · " + A.money(d.amount) + ". Kalan gider " + A.money(d.facts.forecast.expected) + ", tampon " + A.money(d.facts.forecast.buffer) + ".";
      if (d.facts.besEstimate) calculation += " " + d.facts.besEstimate.payments + " gelecek ödemede ilave " + A.money(d.facts.besEstimate.extra) + "; yıllık limit içindeki uygun ilave " + A.money(d.facts.besEstimate.eligible) + ", %20 devlet katkısı tahmini " + A.money(d.facts.besEstimate.estimatedStateContribution) + ".";
      if (d.facts.quote) calculation += " Teklif " + d.facts.quote.id + ", satış " + A.money(d.facts.quote.ask) + "/g, makas %" + (d.facts.spreadBps / 100).toLocaleString("tr-TR") + ".";
      return calculation + " Seçenekler: " + d.alternatives.join(" · ") + ".";
    }
    if (e.phase === "guardrail") return d.reason;
    if (e.phase === "verified") return (d.reference || "") + " · " + d.reason;
    if (e.phase === "action") return d.kind === "price-alert" ? "Ücret artışlarında haber alma: " + (d.enabled ? "açık" : "kapalı") + ". Ödeme talimatı değişmedi." : "Tekil anahtar: " + d.key + ". Ayrılan kaynak: " + A.money(d.reserved) + ".";
    if (d.result) {
      if (e.title === "readAccounts") return "Vadesiz " + A.money(d.result.cash) + ", birikim " + A.money(d.result.savings) + ".";
      if (e.title === "readPaymentSchedule") return d.result.length + " tarihli ödeme kaydı okundu.";
      if (e.title === "readVariableHistory") return "Son bir yılın " + d.result.length + " aylık örnek harcama kaydı ve alım gücü endeksleri okundu.";
      if (e.title === "readExpensePriceBasis") return "Alım gücü hesabının fiyat endeksi: " + d.result.index + " · " + d.result.period + ".";
      if (e.title === "getGoldQuote") return "Teklif " + d.result.id + " · alış " + A.money(d.result.bid) + ", satış " + A.money(d.result.ask) + "/gram.";
      if (e.title === "readAutomaticPayments") return d.result.length + " otomatik ödeme kaydı okundu.";
      if (e.title === "readPriceAlertPreferences") return "Ücret artışlarında haber alma: " + (d.result.enabled ? "açık" : "kapalı") + ".";
      if (e.title === "readBesContract") return "Gelecek aylık katkı " + A.money(d.result.monthly) + ".";
    }
    if (d.amount) return A.money(d.amount) + (d.forecastCountedAgain === false ? " kesinleşti. Tahmine ikinci kez eklenmedi." : "");
    return d.reason || d.reference || (d.planId ? "Plan: " + d.planId : d.operationId ? "İşlem: " + d.operationId : "");
  }
  function journal(events) {
    return events.length ? '<ol class="agent-timeline">' + events.slice().reverse().map(function (e) {
      return '<li><div class="agent-log-meta">' + A.escape(phases[e.phase] || e.phase) + ' · ' + new Date(e.at).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }) +
        '</div><b>' + A.escape(e.title) + '</b><p>' + A.escape(journalDetail(e)) + '</p></li>';
    }).join("") + '</ol>' : '<p class="agent-muted">Bu görev için henüz çalışma yok.</p>';
  }
  function shell() {
    el("screen").innerHTML =
      '<div class="top-nav"><button class="agent-icon" type="button" id="detail-back" aria-label="Ana sayfaya dön" hidden>←</button><h2 id="screen-title" tabindex="-1">Akbank Mobil</h2><button class="top-chat-btn" type="button" id="open-assistant-chat" aria-label="Asistan ile sohbet"><svg class="assistant-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></svg> Asistan</button><span class="agent-avatar" aria-hidden="true">D</span></div>' +
      // 18 Ekim: sonuç mesajı sayfanın altında kalıyordu; başlığın altında, kaydırınca da görünür.
      '<p id="agent-message" class="agent-message" role="status" aria-live="polite"></p>' +
      // Başlık + sonuç mesajı sırası korunur (18 Ekim testi); gizli evre çubuğu mesajın altında.
      '<div id="era-dev-bar" class="era-dev-bar" role="region" aria-label="Sunum evresi seçimi" hidden><span class="era-dev-label">Evre</span><div class="era-dev-pills" role="group" aria-label="Zaman evresi">' +
      [["today", "1 · Bugün"], ["near", "2 · Yakın Gelecek"], ["future", "3 · Ajanlar Çağı"]].map(function (x) { return '<button type="button" class="era-pill" data-era-select="' + x[0] + '" aria-pressed="false">' + x[1] + '</button>'; }).join("") +
      '</div><button type="button" class="era-dev-text" id="era-dev-portfolio" aria-label="Portföy sepeti senaryosunu aç" hidden>Portföy</button><button type="button" class="era-dev-text" id="era-dev-portfolio-need" aria-label="Yarınki 50.000 TL ödemeyi ekle" hidden>+ Ödeme</button><button type="button" class="era-dev-close" id="era-dev-expense" aria-label="Ay içi beklenmedik gider" hidden>₺↓</button><button type="button" class="era-dev-close" id="era-dev-cooldown" aria-label="Güvenlik beklemesini 15 dk ileri al" hidden>⏱</button><button type="button" class="era-dev-close" id="era-dev-reset" aria-label="Sahneyi baştan başlat">↺</button><button type="button" class="era-dev-close" id="era-dev-close" aria-label="Evre seçiciyi kapat">×</button></div><p id="era-live" class="sr-only" role="status" aria-live="polite"></p>' +
      '<div id="call-banner" class="call-banner" role="status" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1Z"/></svg><span>Görüşme sürüyor</span><button type="button" class="call-end-btn" id="call-banner-end">Bitir</button></div>' +
      '<div id="incoming-call" class="call-banner incoming-call" role="alertdialog" aria-labelledby="incoming-call-title" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1Z"/></svg><span><b id="incoming-call-title">112 arıyor…</b><small>Gelen arama</small></span><span class="incoming-actions"><button type="button" class="call-end-btn" id="incoming-decline">Reddet</button><button type="button" class="call-accept-btn" id="incoming-accept">Aç</button></span></div>' +
      '<div id="transfer-notice" class="transfer-notice" tabindex="-1" hidden><div class="transfer-notice-main"><div class="transfer-notice-header"><p id="transfer-notice-copy" role="status" aria-live="polite" aria-atomic="true"></p><span id="transfer-notice-sep" class="transfer-notice-sep" aria-hidden="true" hidden> · </span><button type="button" class="transfer-undo" id="undo-transfer" hidden>Geri al</button><button type="button" class="transfer-notice-close-btn" id="transfer-notice-close" aria-label="Bildirimi kapat" hidden>×</button></div><div class="transfer-notice-actions" id="transfer-notice-actions" hidden><button type="button" class="btn line-dark small pill transfer-reconcile-btn" id="transfer-notice-reconcile" hidden>Sonucu kontrol et</button><button type="button" class="btn ghost small pill transfer-review-btn" id="transfer-notice-review" hidden>Temsilciye özet hazırla</button><button type="button" class="btn line-dark small pill transfer-share-btn" id="transfer-notice-share" hidden>Alıcıyı bilgilendir · Dekont paylaş</button></div></div>' +
      '<div id="transfer-share-preview" class="transfer-share-preview" hidden><div class="transfer-share-header"><p class="eyebrow">Alıcıyı bilgilendir</p><button type="button" class="transfer-share-close-btn" id="transfer-share-close" aria-label="Paylaşımı kapat">×</button></div>' +
      '<div class="share-message-box"><span class="share-label">Paylaşılacak mesaj</span><p class="share-bubble-msg" id="share-bubble-msg"></p></div>' +
      '<div class="agent-form share-note-form"><label for="transfer-share-note">Açıklama (düzenlenebilir)</label><input type="text" id="transfer-share-note" class="transfer-share-note" autocomplete="off"></div>' +
      '<div class="share-receipt-card"><p class="share-receipt-title">Dekont Özeti</p><div id="share-receipt-facts" class="share-receipt-facts"></div></div>' +
      '<div class="share-actions"><button type="button" class="btn primary pill small" id="transfer-share-confirm">Paylaşım taslağı hazırla</button><button type="button" class="btn line-dark pill small" id="transfer-share-cancel">Kapat</button></div>' +
      '<div id="transfer-share-status" class="transfer-share-status" role="status" aria-live="polite" hidden></div></div>' +
      '<div id="transfer-review-preview" class="human-review-panel" hidden><div class="human-review-header"><p class="eyebrow">Temsilci Özeti · İnsan Desteği</p><button type="button" class="human-review-close-btn" id="transfer-review-close" aria-label="Özeti kapat">×</button></div><p class="human-review-disclaimer">Asistan bu özeti transfer verilerinden hazırladı. İstemediğin bilgileri silebilir veya düzenleyebilirsin.</p><div class="review-fields"><div class="review-field-group"><label for="transfer-review-question">1. Sorun ve istediğin yardım</label><textarea id="transfer-review-question" class="review-textarea" rows="2"></textarea></div><div class="review-field-group"><label for="transfer-review-operation">2. İlgili işlem ve tutar</label><input type="text" id="transfer-review-operation" class="review-input"></div><div class="review-field-group"><label for="transfer-review-verified">3. Kesin olarak doğrulanmış durum</label><textarea id="transfer-review-verified" class="review-textarea" rows="2"></textarea></div><div class="review-field-group"><label for="transfer-review-uncertainty">4. Yapılan kontroller ve belirsiz kalan konu</label><textarea id="transfer-review-uncertainty" class="review-textarea" rows="2"></textarea></div><div class="review-field-group"><label for="transfer-review-summary">Temsilciye gösterilecek hazır özet (düzenlenebilir)</label><textarea id="transfer-review-summary" class="review-summary-box" rows="3"></textarea></div></div><div class="human-review-actions"><button type="button" class="btn primary pill small" id="transfer-review-save">Özet taslağını kaydet</button><button type="button" class="btn line-dark pill small" id="transfer-review-cancel">Kapat</button></div><div id="transfer-review-status" class="human-review-status" role="status" aria-live="polite" hidden></div></div></div>' +
      '<div id="refund-notice" class="refund-notice" tabindex="-1" hidden><div class="refund-notice-main"><p id="refund-notice-copy" role="status" aria-live="polite" aria-atomic="true"></p><button type="button" class="btn line-dark small pill" id="refund-notice-close">Kapat</button></div></div>' +
      '<div id="home-view" class="screen-in">' + '<div class="hello"><p class="sub">Merhaba Deniz</p><p class="date" id="home-date">12 Ekim 2026</p></div>' +
      '<section id="near-era-card" class="guard-card near-era-card" aria-labelledby="near-era-title" hidden></section><section id="future-era-card" class="guard-card future-era-card" aria-labelledby="future-era-title" hidden></section>' +
      '<div class="balance-card"><p class="eyebrow">Hesabındaki para</p><p class="amount" id="home-balance"></p><p class="agent-muted" id="home-forecast"></p><div class="home-alloc" id="home-alloc" hidden></div><button type="button" class="nudge-link home-cashflow-link" id="home-cashflow">Ay sonuna kadar <span aria-hidden="true">→</span></button></div>' +
      '<nav class="quick-actions" id="home-quick-actions" aria-label="Hızlı işlemler"><button type="button" class="quick-action" id="home-new-transfer" hidden>Para gönder</button><button type="button" class="quick-action" id="home-scan-payment" hidden>Mesaj veya belgeden öde</button><button type="button" class="quick-action home-saved-transfer" id="home-saved-transfer">Kayıtlı transfer</button><button type="button" class="quick-action" id="home-payments">Ödemelerim</button></nav>' +
      '<section id="home-shield-link" class="guard-card home-shield-link" hidden><p class="eyebrow guard-eyebrow">Güvenlik kalkanı</p><p id="home-shield-copy"></p><button type="button" class="btn primary pill small" id="home-shield-open">Para gönder sayfasında gör</button></section>' +
      // 16 Ekim görüşmeleri: iki katılımcı deneme kartını bulamadı (öneri kartının altında, ekranın dışında kalıyordu). En acil uyarı önerinin üstünde.
      '<section id="guard-cards" class="guard-cards" aria-label="Asistan nakit akışı ve abonelik uyarıları" hidden><div id="card-due-guard"></div><div id="liquidity-guard"></div><div id="trial-guard"></div><div id="ecosystem-crypto"></div></section>' +
      '<section id="home-nudge" class="home-nudge" aria-labelledby="home-nudge-title"><p class="eyebrow" id="home-nudge-eyebrow">Sana bir önerim var</p><h3 id="home-nudge-title"></h3><p class="nudge-was" id="home-nudge-was" hidden></p><p class="amount" id="home-nudge-amount"></p><button type="button" class="btn line-dark pill" id="home-nudge-open">Birikime git&nbsp;<span aria-hidden="true">→</span></button></section>' +
      '<details id="other-alerts" class="other-alerts" hidden><summary id="other-alerts-summary">Diğer uyarılar</summary><div id="other-alerts-body"></div></details>' +
      '<div class="home-chat-banner" id="home-chat-banner"><button type="button" class="home-chat-trigger" id="home-chat-trigger"><span class="chat-trigger-icon" aria-hidden="true"><svg class="assistant-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></svg></span><span class="chat-trigger-text">Asistana sor</span></button></div>' +
      '</div>' +
      '<div id="savings-view" class="screen-in" hidden>' +
      '<section class="card offer"><div class="asistan-header"><h3>Akbank Asistan</h3><p id="asistan-context">Karar sende.</p>' +
      '<div class="agent-indicators" role="group" aria-label="Öneri seçimi">' + A.TASKS.map(function (d, i) { return '<button type="button" class="agent-indicator" data-card="' + i + '" aria-label="' + A.escape(d.title) + '"><span></span></button>'; }).join("") +
      '</div></div><div class="asistan-body"><div id="carousel" class="carousel-viewport" role="region" aria-roledescription="karusel" aria-label="Asistan önerileri"><div class="carousel-track" id="agent-track">' +
      A.TASKS.map(function (d, i) { return '<article class="carousel-slide" id="slide-' + d.id + '" aria-label="' + (i + 1) + ' / 4"><div class="sg-box agent-task-card"><p class="eyebrow">' + A.escape(d.id === "savings" ? "Sana bir önerim var" : d.title) +
        '</p><h3 id="card-title-' + d.id + '">' + A.escape(cardTitles[d.id]) + '</h3>' + (d.id === "savings" ? '<p class="nudge-was" id="card-was-savings" hidden></p>' : '') + '<p class="amount" id="card-amount-' + d.id + '"></p><div class="agent-card-note" id="card-note-' + d.id + '"></div>' + (d.id === "savings" ? '<p class="card-redeem" id="card-redeem-savings" hidden></p>' : '') + '<p class="eco-tag" id="eco-' + d.id + '" hidden></p><div class="contrast-slot" id="contrast-' + d.id + '"></div>' +
        '<div id="card-status-' + d.id + '" hidden></div><button class="btn primary pill" type="button" data-open="' + i + '"></button>' +
        '<div class="nudge-links"><button type="button" class="nudge-link" data-edit="' + i + '" id="edit-' + d.id + '">' + (d.id === "subscription" ? "Ödemelerimi gör" : d.id === "gold" ? "Takip ayarları" : "Tutarı değiştir") + '</button><button type="button" class="nudge-link muted" data-skip="' + i + '">Şimdi değil</button></div>' +
        (d.id === "savings" ? '<form id="card-savings-form" class="nudge-editor agent-form" hidden><label for="card-savings-amount">Ne kadar ayırmak istersin? (TL)</label><div class="nudge-input-row"><input id="card-savings-amount" type="text" inputmode="decimal" autocomplete="off" aria-describedby="card-savings-impact" required></div><p id="card-savings-impact" class="budget-impact" role="status" aria-live="polite" aria-atomic="true" hidden></p><label for="card-buffer-amount">Güvenlik payın (TL)</label><div class="nudge-input-row"><input id="card-buffer-amount" type="text" inputmode="decimal" autocomplete="off"><button type="submit" class="btn line-dark small">Seç</button></div></form>' : '') +
        '<details class="nudge-why" id="why-' + d.id + '" data-step="why-' + d.id + '"><summary>' + (d.id === "savings" ? "Neden bu tutar?" : "Neden bu öneri?") + '</summary><div id="why-content-' + d.id + '"></div></details>' +
        (d.id === "savings" ? '<details class="nudge-why nudge-effects" id="effects-savings" hidden><summary>Diğer etkiler</summary><div id="effects-content-savings"></div></details>' : '') +
        (d.id === "gold" ? '<details class="nudge-disclosure comparison-disclosure" id="gold-comparison-disclosure"><summary>Getiri karşılaştırması</summary><div id="gold-comparison-view" class="asset-comparison-box"></div></details>' : '') +
        '</div></article>'; }).join("") +
      '</div></div><div class="agent-carousel-nav"><button type="button" class="agent-icon" id="card-prev" aria-label="Önceki öneri">←</button><span id="card-index"></span><button type="button" class="agent-icon" id="card-next" aria-label="Sonraki öneri">→</button></div></div></section>' +
      '<section class="home-comparison-card savings-comparison-card" aria-labelledby="home-comparison-title"><div class="comparison-entry-icon" aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M4 21h20M4 21V6M7 17l5-5 4 3 7-8M7 12l6 3 10-3"/></svg></div><div><h3 id="home-comparison-title">Getiriyi karşılaştır</h3><p>Altın getirisi enflasyonun üzerinde mi?</p></div><button type="button" class="nudge-link" id="home-comparison">Grafiğe bak <span aria-hidden="true">→</span></button></section>' +
      '<section id="fund-card" class="guard-card fund-card" aria-labelledby="fund-title" hidden>' +
      '<div class="fund-card-header"><div><p class="eyebrow guard-eyebrow" id="fund-eyebrow"></p><h3 id="fund-title">Birikim fonun</h3></div><button type="button" class="human-review-close-btn" id="fund-card-close" aria-label="Fon kartını kapat">×</button></div>' +
      '<div class="fund-metrics-row"><div class="fund-stat-box"><span class="fund-stat-label">Fon bakiyen</span><span class="fund-stat-val" id="fund-balance"></span></div><div class="fund-stat-box"><span class="fund-stat-label">Tahmini günlük getiri</span><span class="fund-stat-val fund-return-val" id="fund-daily-return"></span></div></div>' +
      '<ul class="fund-facts" id="fund-pills"></ul>' +
      // Fon seçimi: iki seçenek eşit görünür, değiştirmek ayrı onay ister (tek merak dokunuşu seçim sayılmaz).
      // Fon tercihi yalnız fon işlemi ve likidite/güvenlik payı için kullanılır; seçimden kişi hakkında çıkarım yapılmaz ve arayüzde etiketlenmez.
      '<div class="fund-choice" role="group" aria-label="Fon seçimi"><span class="fund-choice-label">Fon</span><button type="button" class="fund-choice-opt" data-fund-choice="ALE" aria-pressed="true">Para piyasası · ALE<span class="fund-choice-sub">7/24 geri al</span></button><button type="button" class="fund-choice-opt" data-fund-choice="AIS" aria-pressed="false">Katılım · AIS<span class="fund-choice-sub">İş günü 13:00’e kadar</span></button></div>' +
      // 17 Ekim (16 Ekim görüşmeleri): katılımcı fon değiştirmek için önce satması gerektiğini sandı.
      '<p class="agent-muted fund-choice-help" id="fund-choice-help"></p>' +
      '<div class="fund-choice-confirm" id="fund-choice-confirm" role="group" aria-labelledby="fund-choice-confirm-title" hidden><p class="fund-choice-q" id="fund-choice-confirm-title"></p><p id="fund-choice-confirm-body"></p><div class="guard-actions"><button type="button" class="btn primary pill small" id="fund-choice-yes"></button><button type="button" class="btn line-dark pill small" id="fund-choice-no"></button></div></div>' +
      '<details class="nudge-why fund-diff" id="fund-diff" data-step="fund-diff"><summary>İki fon arasındaki fark</summary>' + rows([["Para piyasası · ALE", "7/24 geri al · anında"], ["Katılım · AIS", "İş günü 13:00'e kadar"]]) + '<dl class="fund-diff-list"><dt>Para piyasası · ALE</dt><dd>Faizli para piyasası araçlarına yatırım yapar. Gece ve hafta sonu da 7/24 satabilirsin. Para anında vadesizine geçer. Hafta sonu ve tatilde satış, ilk iş gününün fiyatıyla yapılır.</dd><dt>Katılım · AIS</dt><dd>Faizsiz (katılım) para piyasası araçlarına yatırım yapar. Alım ve satım yalnız iş günlerinde saat 13:00’e kadar yapılır. Para aynı gün vadesizine geçer. Akşam, hafta sonu ve tatilde geri alınamaz.</dd></dl></details>' +
      '<p class="agent-muted fund-pref-note" id="fund-pref-note"></p>' +
      '<p class="fund-switched" id="fund-switched" role="status" hidden></p>' +
      '<form id="fund-form" class="agent-form fund-form" novalidate><label for="fund-amount" id="fund-amount-label">Tutar</label><div class="fund-amount-box"><input id="fund-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0"><span aria-hidden="true">TL</span></div><p class="fund-balances" id="fund-balances"></p><div class="fund-quick-chips" id="fund-chips"></div>' +
      '<div class="approve-steps" id="fund-steps" aria-hidden="true"><i class="now"></i><i class="next"></i></div><div class="fund-actions" id="fund-actions"><button type="button" class="btn line-dark pill" id="fund-deposit-btn" data-fund-dir="deposit">Fona para ekle</button><button type="button" class="btn line-dark pill" id="fund-redeem-btn" data-fund-dir="redeem">Vadesizine geri al</button></div>' +
      '<div class="fund-confirm" id="fund-confirm" hidden><div id="fund-confirm-facts"></div><div class="guard-actions"><button type="button" class="btn primary pill" id="fund-confirm-btn"></button><button type="button" class="btn line-dark pill small" id="fund-confirm-cancel">Vazgeç</button></div></div>' +
      '<div class="approve-sent" id="fund-sent" aria-hidden="true" hidden></div><p class="agent-muted" id="fund-hint" hidden></p></form></section>' +
      '<div class="home-quiet-links"><button type="button" class="nudge-link home-settings" id="home-settings">Birikim ayarları</button></div></div>' +
      '<div id="transfer-view" class="screen-in" hidden><nav class="quick-actions transfer-actions" aria-label="Para gönderme seçenekleri"><button type="button" class="quick-action" id="transfer-new">Yeni alıcıya para gönder</button><button type="button" class="quick-action" id="transfer-scan">Mesaj veya belgeden öde</button><button type="button" class="quick-action" id="transfer-payments">Otomatik ödemelerim</button></nav>' +
      '<section id="transfer-cards" class="guard-cards" aria-label="Para gönderme ve güvenlik">' +
      '<div id="scam-shield"></div><div id="payee-review"></div>' +
      '<div id="shield-review-panel" class="human-review-panel shield-review" hidden><div class="human-review-header"><p class="eyebrow" id="shield-review-title" tabindex="-1">Temsilcinin göreceği özet</p><button type="button" class="human-review-close-btn" id="shield-review-close" aria-label="Özeti kapat">×</button></div><p class="human-review-disclaimer" id="shield-review-disclaimer">Temsilciyi aradığında bunu görür.</p><dl class="review-readable" id="shield-review-readable"></dl><p class="agent-muted review-locked-note" id="shield-review-locked">Banka kaydı, değiştirilemez. Altına kendi notunu ekleyebilirsin.</p><details class="review-edit" id="shield-review-edit"><summary>Kendi notunu ekle</summary><div class="review-fields"><div class="review-field-group"><label for="shield-review-question">Kendi anlatımın (temsilci bunu senin notun olarak görür)</label><textarea id="shield-review-question" class="review-textarea" rows="3" maxlength="600"></textarea></div><div hidden><textarea id="shield-review-operation" readonly></textarea><textarea id="shield-review-verified" readonly></textarea><textarea id="shield-review-uncertainty" readonly></textarea><textarea id="shield-review-summary" readonly></textarea></div></div></details><div class="human-review-actions"><button type="button" class="btn primary pill small" id="shield-review-save">Özet taslağını kaydet</button><button type="button" class="nudge-link" id="shield-review-cancel">Kapat</button></div><div id="shield-review-status" class="human-review-status" role="status" aria-live="polite" hidden></div></div>' +
      '<section id="scan-panel" class="guard-card scan-panel" aria-labelledby="scan-title" hidden><div id="scan-body"></div></section>' +
      '<section id="new-transfer-panel" class="guard-card transfer-lab" aria-labelledby="new-transfer-title" hidden><div class="lab-head"><p class="eyebrow guard-eyebrow">Para gönder · IBAN</p><button type="button" class="human-review-close-btn" id="new-transfer-close" aria-label="Transfer formunu kapat">×</button></div>' +
      '<h3 id="new-transfer-title" tabindex="-1">Yeni alıcıya para gönder</h3>' +
      '<form id="new-transfer-form" class="agent-form" novalidate><label for="nt-payee">Alıcı adı soyadı</label><input id="nt-payee" type="text" autocomplete="off" required>' +
      '<label for="nt-iban">IBAN</label><input id="nt-iban" type="text" autocomplete="off" spellcheck="false" placeholder="TR 101" aria-describedby="nt-iban-status" required><p id="nt-iban-status" class="nt-iban-status" aria-live="polite"></p>' +
      '<label for="nt-amount">Tutar (TL)</label><input id="nt-amount" type="text" inputmode="decimal" autocomplete="off" required><p class="agent-muted" id="nt-balance"></p><button type="button" class="nudge-link" id="nt-switch" hidden>Fondaki 250.000 TL ile yüksek tutarlı örneğe geç</button>' +
      '<div class="lab-actions"><div class="approve-steps" aria-hidden="true"><i class="now"></i><i class="next"></i></div><button type="submit" class="btn primary pill">Devam et</button><button type="button" class="nudge-link" id="nt-example">Örnek bilgileri doldur</button></div></form>' +
      '<div id="nt-risk" class="risk-panel" aria-live="polite"></div>' +
      '</section>' +
      '</section>' +
      '<section class="saved-transfers-box" id="saved-transfers-section" aria-labelledby="saved-transfers-title"><div class="saved-transfers-header"><h3 id="saved-transfers-title">Kayıtlı işlemlerim</h3><span class="saved-transfers-sub">Hızlı transfer</span></div><ul id="saved-transfers-list" class="saved-transfers-list" role="list"></ul><div id="saved-transfer-review" class="saved-transfer-review-card agent-box" hidden><p class="eyebrow">Transfer onayı</p><h4 id="saved-review-title"></h4><p class="amount" id="saved-review-amount"></p><div id="saved-review-facts"></div><p class="agent-muted" id="saved-review-note"></p><div class="approve-steps" id="saved-steps" aria-hidden="true"><i></i><i class="now"></i></div><div class="approve-sent" id="saved-sent" aria-hidden="true" hidden></div><div class="saved-review-actions" id="saved-review-actions"><button type="button" class="btn primary pill" id="approve-saved-transfer">Transferi onayla</button><button type="button" class="nudge-link muted" id="cancel-saved-review">Vazgeç</button></div></div></section>' +
      '</div>' +
      '<div id="detail-view" class="screen-in" hidden><p class="agent-muted" id="detail-reason"></p><div id="detail-status" hidden></div>' +
      '<section id="subscription-view" class="nudge-review" hidden><div class="agent-box price-alert-box"><h3>Ücret artarsa haber al</h3><p class="agent-muted" id="price-alert-status"></p><button type="button" class="btn line-dark pill" id="price-alert-toggle" aria-pressed="false">Ücret artarsa haber alayım</button><p class="agent-muted">Bu tercih ödemelerini değiştirmez.</p></div><div id="subscription-notice" class="price-increase-notice" role="status" hidden></div><div id="trial-payments-notice" class="price-increase-notice" hidden></div><h3 id="automatic-payments-title">Otomatik ödemelerim</h3><ul id="automatic-payments-list" class="automatic-payments-list" aria-labelledby="automatic-payments-title"></ul></section>' +
      '<section id="panel-plan" class="nudge-review"><div id="current-plan" class="agent-box review-card" hidden><p class="eyebrow">Son karar sende</p><h3 id="plan-kind"></h3><p class="agent-plan-amount" id="plan-amount"></p><div id="plan-facts"></div><p class="agent-muted" id="plan-decision"></p></div>' +
      '<div class="approve-steps" id="approve-steps" aria-hidden="true" hidden><i></i><i class="now"></i></div><button type="button" class="btn primary pill" id="approve-plan" hidden></button><div class="approve-sent" id="approve-sent" aria-hidden="true" hidden></div><button type="button" class="btn outline pill" id="refresh-review" hidden>Yeni öneriyi göster</button>' +
      '<button type="button" class="btn outline pill" id="reconcile-operation" hidden>İşlemin sonucunu kontrol et</button><div id="task-receipt" class="agent-receipt" hidden></div>' +
      '<div id="gold-setup" class="agent-box" hidden><p class="agent-muted">Alış ve satış fiyatı arasındaki fark istediğin seviyeye gelince alımı sana sorarım.</p><form id="gold-form" class="agent-form"><label for="gold-budget">En fazla ne kadar almak istersin? (TL)</label><input id="gold-budget" type="text" inputmode="decimal" required autocomplete="off"><label for="gold-threshold">En yüksek alış-satış farkı (%)</label><input id="gold-threshold" type="text" inputmode="decimal" required autocomplete="off"><button type="submit" class="btn primary pill">Benim için takip et</button></form>' +
      '<details class="nudge-disclosure comparison-disclosure" id="detail-gold-comparison-disclosure"><summary>Getiri karşılaştırması</summary><div id="detail-gold-comparison-view" class="asset-comparison-box"></div></details></div>' +
      '<details class="nudge-disclosure" id="amount-editor"><summary>Tutarı değiştir</summary><form id="savings-form" class="agent-form" hidden><label for="savings-amount">Ayırmak istediğin tutar (TL)</label><input id="savings-amount" type="text" inputmode="decimal" required autocomplete="off" aria-describedby="savings-impact"><p id="savings-impact" class="budget-impact" role="status" aria-live="polite" aria-atomic="true" hidden></p><button class="btn outline pill" type="submit">Tutarı güncelle</button></form>' +
      '<form id="bes-form" class="agent-form" hidden><label for="bes-amount">Yeni aylık katkın (TL)</label><input id="bes-amount" type="text" inputmode="decimal" required autocomplete="off"><button type="submit" class="btn outline pill">Tutarı güncelle</button></form></details>' +
      '<button type="button" class="nudge-link" id="return-home">Ana sayfaya dön</button></section>' +
      '<details class="nudge-disclosure" id="calculation-details" data-step="calculation"><summary>Neye göre hesapladın?</summary><div id="plan-description"></div></details>' +
      '<details class="nudge-disclosure" id="settings-details"><summary>Takip ve işlem ayarları</summary><section id="panel-permissions"><p id="task-authority" class="agent-muted"></p>' +
      '<form id="permissions-form" class="agent-form"><label class="agent-checkbox"><input id="permission-auto" type="checkbox"> Belirlediğim sınırlar içinde birikim hesabıma otomatik para ayır</label>' +
      '<label for="permission-action">Bir seferde en fazla (TL)</label><input id="permission-action" type="text" inputmode="decimal" required autocomplete="off">' +
      '<label for="permission-month">Ay boyunca en fazla (TL)</label><input id="permission-month" type="text" inputmode="decimal" required autocomplete="off">' +
      '<label for="permission-buffer">Güvenlik payı: giderlerime ek olarak vadesizde kalsın (TL)</label><input id="permission-buffer" type="text" inputmode="decimal" required autocomplete="off"><button type="submit" class="btn outline pill">Ayarları kaydet</button>' +
      '<p class="agent-muted">Yalnızca kendi vadesiz hesabından birikim hesabına. 31 Ekim 2026’ya kadar geçerli. Hesabına geri para almak her zaman onayını gerektirir.</p></form>' +
      '<div class="agent-form"><button type="button" id="revoke-permission" class="btn outline pill">Otomatik para ayırmayı kapat</button><button type="button" id="pause-task" class="btn line-dark pill"></button>' +
      '<details class="nudge-disclosure" id="help-disclosure"><summary>Bir sorun mu var?</summary><button type="button" id="human-review" class="btn ghost pill">İnceleme isteği hazırla</button><p class="agent-muted" id="human-review-note"></p><div id="human-review-panel" class="human-review-panel" hidden><div class="human-review-header"><p class="eyebrow">Temsilci Özeti · İnsan Desteği</p><button type="button" class="human-review-close-btn" id="human-review-close" aria-label="Özeti kapat">×</button></div><p class="human-review-disclaimer">Asistan bu özeti mevcut verilerden hazırladı. İstemediğin bilgileri silebilir veya düzenleyebilirsin.</p><div class="review-fields"><div class="review-field-group"><label for="review-input-question">1. Sorun ve istediğin yardım</label><textarea id="review-input-question" class="review-textarea" rows="2"></textarea></div><div class="review-field-group"><label for="review-input-operation">2. İlgili işlem, tutar ve mevcut referans</label><input type="text" id="review-input-operation" class="review-input"></div><div class="review-field-group"><label for="review-input-verified">3. Kesin olarak doğrulanmış durum</label><textarea id="review-input-verified" class="review-textarea" rows="2"></textarea></div><div class="review-field-group"><label for="review-input-uncertainty">4. Yapılan kontroller ve belirsiz kalan konu</label><textarea id="review-input-uncertainty" class="review-textarea" rows="2"></textarea></div><div class="review-field-group"><label for="review-input-summary">Temsilciye gösterilecek hazır özet (düzenlenebilir)</label><textarea id="review-input-summary" class="review-summary-box" rows="3"></textarea></div></div><div class="human-review-actions"><button type="button" class="btn primary pill small" id="human-review-save">Özet taslağını kaydet</button><button type="button" class="btn line-dark pill small" id="human-review-cancel">Kapat</button></div><div id="human-review-status" class="human-review-status" role="status" aria-live="polite" hidden></div></div></details></div>' +
      '<p class="agent-muted" id="mandate-note">Takibi kapatmak bankadaki ödeme talimatını durdurmaz.</p><details class="nudge-disclosure"><summary>Yetki hakkında</summary><div class="agent-legal">' + A.escape(A.RULES.authority.note) + '</div></details></section></details>' +
      '<details class="nudge-disclosure" id="journey-details"><summary>Asistan benim için ne yaptı?</summary><div id="task-log"></div></details></div>' +
      '<div id="accounts-view" class="screen-in" hidden><div id="accounts-summary"></div><section id="cashflow-30" class="cashflow-card" aria-labelledby="cashflow-30-title" hidden></section>' +
      '<details class="nudge-disclosure comparison-disclosure" id="accounts-gold-comparison-disclosure"><summary>Altın getiri karşılaştırması (Son 6 ay)</summary><div id="accounts-gold-comparison-view" class="asset-comparison-box"></div></details>' +
      '<button type="button" class="btn line-dark pill" id="accounts-payments">Otomatik ödemelerim</button><h3>Hesap hareketleri</h3>' +
      '<div class="ledger-search-box"><label for="ledger-search" class="sr-only">Hesap hareketlerinde ara</label><div class="ledger-search-bar"><span class="ledger-search-icon" aria-hidden="true">⌕</span><input type="search" id="ledger-search" class="ledger-search-input" placeholder="İşlem veya kategori ara (örn: kahve, market, fatura)..." autocomplete="off" spellcheck="false"><button type="button" id="ledger-search-clear" class="ledger-search-clear" aria-label="Aramayı temizle" hidden>×</button></div><div id="ledger-search-status" class="sr-only" role="status" aria-live="polite"></div></div>' +
      '<button type="button" class="ledger-info-chip" id="ledger-info-chip" hidden></button><div id="accounts-ledger"></div><details class="nudge-disclosure"><summary>Yaklaşan ödemeler</summary><div id="payment-schedule"></div></details></div>' +
      '<div id="card-view" class="screen-in" hidden><div id="cc-top"></div><div id="card-statement-guard"></div><div id="cc-more"></div></div>' +
      '<div id="comparison-view" class="screen-in" hidden><p class="comparison-page-intro">Aynı başlangıç tutarı, aynı dönem. Karşılaştırma hesaplarındaki paradan bağımsızdır.</p><section id="primary-comparison-view" class="asset-comparison-box" aria-label="Altın ve seçilen referansın karşılaştırması"></section></div>' +
      '<div id="activity-view" class="screen-in" hidden><p class="agent-muted">Asistanın bu oturumdaki adımları</p><div id="all-log"></div></div>' +
      '<button type="button" class="floating-chat-trigger" id="floating-chat-trigger" aria-label="Asistan ile sohbet"><span class="f-icon"><svg class="assistant-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></svg></span><span class="f-text">Asistan</span></button>' +
      '<div id="assistant-chat-view" class="assistant-chat-overlay" role="dialog" aria-modal="true" aria-labelledby="assistant-chat-title" hidden><div class="chat-header"><div class="chat-header-title"><span class="chat-avatar" aria-hidden="true">A</span><div><strong id="assistant-chat-title">Akbank Asistan</strong><small>İşlem ve destek</small></div></div><button type="button" class="chat-close-btn" id="chat-close" aria-label="Sohbeti kapat">×</button></div><div class="chat-messages" id="chat-messages" role="log" aria-live="polite"></div><div id="chat-quick-chips" hidden></div><form class="chat-input-bar" id="chat-form"><label for="chat-input" class="sr-only">Mesajın</label><input type="text" id="chat-input" placeholder="Mesajını yaz..." autocomplete="off"><button type="submit" id="chat-send" class="btn primary small pill">Gönder</button></form></div>' +
      '<div id="agent-live" class="sr-only" aria-live="polite" aria-atomic="true"></div>';
    // Ana sayfa yalnız özet ve tek öneri; birikim, para gönderme ve hesaplar ayrı sekmelerde.
    var tabs = ["home", "savings"].concat(presentation.allowsPage("transfer") ? ["transfer"] : [], ["accounts"], presentation.development ? ["activity"] : []);
    var tabIcons = { home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>', savings: '<path d="M4 3v17h17M7 15l5-5 4 3 5-7"/>', transfer: '<path d="M4 12h14M13 6l6 6-6 6"/>', accounts: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18M15 14h3"/>', activity: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' };
    el("tabbar").innerHTML = '<nav class="tabbar" aria-label="Telefon bölümleri">' + tabs.map(function (key) {
      return '<button type="button" class="tab" data-page="' + key + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + tabIcons[key] + '</svg>' + { home: "Ana sayfa", savings: "Birikim", transfer: "Para gönder", accounts: "Hesaplarım", activity: "Son adımlar" }[key] + '</button>';
    }).join("") + '</nav>';
    // 27 Ekim (sahip): jüri sunumu kendi telefonundan izler. Kısa sürümde telefonun üstünde sabit sahne seçici, sunumdaki sırayla; alt sekmeler yok.
    // 5 Kasım (Akbank çalışanının önerisi, sahibin yetkisiyle): seçici uygulamanın başlık alanına gömülür. Başlık → demo navigasyonu → içerik.
    // Başlık ve seçici aynı yüzeyde, ekranın dışında: kaydırma, tur karartması ve evre tanıtımı onları örtmez. 5 Kasım (sahip): "Etkileşimli demo" etiketi ve bağlam rozeti kaldırıldı, yalnız grup adları ve sahneler.
    // Tek navigasyon: Bugün (Birikim, Kalkan) · Yakın gelecek (Kurallar) · Ajanlar çağı (Ajanlar). Evre numarası müşteri terimi değil.
    if (presentation.kisa) {
      var head = document.createElement("header"); head.id = "kisa-head"; head.className = "kisa-head";
      el("screen").parentNode.insertBefore(head, el("screen")); head.appendChild(el("screen").querySelector(".top-nav"));
      head.insertAdjacentHTML("beforeend", '<nav id="kisa-scenes" class="kisa-scenes" aria-label="Demo sahneleri"><div class="kisa-track">' +
        [["Bugün", 2, "today"], ["Yakın gelecek", 1, "near"], ["Ajanlar çağı", 1, "future"]].map(function (g) { return '<span class="kisa-group" data-kisa-group="' + g[2] + '" style="grid-column:span ' + g[1] + '" aria-hidden="true">' + g[0] + '</span>'; }).join("") +
        KISA_SCENES.map(function (x) { return '<button type="button" class="kisa-scene" data-kisa-scene="' + x.id + '" aria-pressed="false" aria-label="' + A.escape(x.aria) + '">' + x.label + '</button>'; }).join("") + '</div><div class="kisa-start" id="kisa-start" hidden></div></nav>');
    }
    if (presentation.kisa) document.body.insertAdjacentHTML("beforeend", '<div id="era-splash" class="era-splash" role="status" hidden></div>');
    if (presentation.kisa) document.body.insertAdjacentHTML("beforeend", '<div id="tour" class="tour" hidden><div class="tour-spot" id="tour-spot"></div>' +
      ["top", "bottom", "left", "right"].map(function (x) { return '<div class="tour-block" data-tour-block="' + x + '"></div>'; }).join("") +
      '<div class="tour-tip" id="tour-tip" role="dialog" aria-labelledby="tour-head tour-text"><p class="tour-count" id="tour-count"></p><p class="tour-head" id="tour-head" hidden></p><p class="tour-text" id="tour-text" aria-live="polite"></p>' +
      '<section id="tour-contact" class="tour-contact" aria-labelledby="tour-contact-title" hidden><h3 id="tour-contact-title">İletişimde kalalım</h3><p>Sinaptik’i ilk deneyenlerden olmak ve gelişmelerden haberdar olmak için e-posta adresini bırak.</p><a id="tour-contact-link" class="btn pill" href="index.html#erken-erisim" target="_top">E-posta bırak <span aria-hidden="true">↗</span></a></section>' +
      '<div class="tour-actions"><button type="button" class="tour-skip" id="tour-skip">Hepsini geç</button><button type="button" class="btn pill small tour-next" id="tour-next">İleri</button></div></div></div>');
    el("trace").innerHTML = '<section class="demo-story"><p class="eyebrow">Bir öneri. Kontrol sende.</p><h3 id="story-title"></h3><p id="story-copy"></p><ol class="demo-story-steps" id="story-steps"><li>Tutarı gör.</li><li>İstersen nedenini öğren, tutarı değiştir.</li><li>İşlemi son ekranda onayla.</li></ol><p class="agent-muted">Asistan ödemelerini ve ayırdığın güvenlik payını hesaba katar. Durumun değişince önerisi de değişir.</p></section><section class="demo-story era-story" id="era-story" hidden></section>' +
      '<details class="demo-disclosure" id="demo-examples"><summary>Demoda yeni bir durum dene</summary><section class="agent-demo-controls"><p class="agent-muted">Bunlar kurgusal örnek olaylar. Telefonun dışında kalır.</p><div class="agent-event-buttons">' +
      // internal: motorun tanıdığı ama yan panelde düğmesi olmayan olay (ör. 112 araması yalnız transfer sayfasından gelir).
      A.EVENTS.filter(function (e) { return !e.internal; }).map(function (e) { return '<button type="button" class="btn line-dark small" data-event="' + e.id + '">' + A.escape(e.label) + '</button>'; }).join("") +
      '</div><label for="demo-preset">Başlangıç örneği</label><div class="agent-preset-row"><select id="demo-preset">' + A.PRESETS.map(function (p) { return '<option value="' + p.id + '">' + A.escape(p.label) + '</option>'; }).join("") +
      '</select><button type="button" class="btn line-dark small" id="preset-reset">Baştan dene</button></div><p id="preset-note" class="agent-muted"></p>' +
      '<details class="demo-disclosure" id="technical-controls"><summary>Teknik kontroller</summary><div class="agent-demo-controls"><button type="button" class="btn outline" id="check-all">Tüm koşulları yeniden kontrol et</button><label for="tool-mode">Sonraki test işleminin sonucu</label><select id="tool-mode"><option value="success">Tamamlandı</option><option value="fail">Reddedildi</option><option value="timeout-before">Yanıt gelmedi · kayıt oluşmadı</option><option value="timeout-after">Yanıt gelmedi · kayıt oluştu</option></select><div id="demo-state"></div><div id="technical-log"></div></div></details></section></details>' +
      '<details class="demo-disclosure" id="research-details"><summary>Bu tasarım neye dayanıyor? · n=16</summary><section id="research-trace" class="agent-research" aria-label="Araştırma kanıtı"></section></details>' +
      '<details class="demo-disclosure presentation-options"><summary>Çalışma sürümü</summary><p class="agent-muted">Jüri sürümü ürünün kendisidir. Geliştirme sürümü iç testler için bütün akışları açar. Sürüm değiştirmek demoyu baştan açar.</p><nav class="presentation-links" aria-label="Demo sürümleri"><a href="?view=jury#demo" data-profile-link="jury">Jüri</a><a href="?view=jury&amp;kisa=1#demo" data-profile-link="jury-kisa">Jüri canlı kısa</a><a href="?view=development#demo" data-profile-link="development">Geliştirme</a></nav><p class="agent-muted" id="build-note"></p></details>';
    text("build-note", presentation.build + " · " + (presentation.kisa ? "Jüri canlı kısa sürümü" : { development: "Geliştirme sürümü", jury: "Jüri sürümü" }[presentation.profile]));
    document.querySelector('[data-profile-link="' + (presentation.kisa ? "jury-kisa" : presentation.profile) + '"]').setAttribute("aria-current", "page");
    // Kısa sürümde durumlar yalnız sahne seçiciden değişir; yan paneldeki olay ve başlangıç düğmeleri seçiciyi ekrandan ayırırdı.
    if (presentation.kisa) el("demo-examples").hidden = true;
    if (presentation.study) {
      document.querySelector(".demo-story").hidden = true;
      el("research-details").hidden = true;
      document.querySelector(".presentation-options").hidden = true;
      el("demo-examples").querySelector("summary").textContent = "Moderatör kontrolleri";
      var sessionLink = document.createElement("p"); sessionLink.className = "study-session-links";
      var newSession = document.createElement("a"); newSession.id = "study-new-session";
      newSession.href = "?view=research&study=1" + (A.telemetry.enabled ? "&test=1" : "") + "#demo";
      newSession.target = "_blank"; newSession.rel = "noopener";
      newSession.textContent = "Yeni katılımcı için temiz pencere";
      sessionLink.appendChild(newSession);
      var caution = document.createElement("span"); caution.textContent = " Önce varsa kaydı durdur ve indir. Yeni pencere ana hesap örneği ve enflasyonla başlar.";
      sessionLink.appendChild(caution); el("demo-examples").appendChild(sessionLink);
    }
    bind();
  }
  function syncForms(s) {
    var taskId = activeId(), p = s.plans[taskId];
    el("savings-amount").value = ((p && p.kind === "save" ? p.amount : s.forecast.available) / 100).toString();
    el("bes-amount").value = (s.goals.bes.target / 100).toString();
    el("gold-budget").value = (s.goals.gold.budget / 100).toString();
    el("gold-threshold").value = (s.goals.gold.thresholdBps / 100).toString();
    syncPermissionForms(s);
  }
  function syncPermissionForms(s) {
    el("permission-auto").checked = s.permissions.autoSave;
    el("permission-action").value = (s.permissions.perAction / 100).toString();
    el("permission-month").value = (s.permissions.monthlyLimit / 100).toString();
    el("permission-buffer").value = (s.permissions.buffer / 100).toString();
  }
  function plainReason(reason) {
    if (/Veri veya izin sürümü/.test(reason)) return "Bütçen veya ayarların değişti. İşlem tamamlanmadı. Güncel öneriye yeniden bakalım.";
    if (/Aylık birikim aktarım limiti/.test(reason)) return "Bu tutar, bu ay için belirlediğin birikim sınırını aşıyor. Tutarı azaltabilir veya ayarını değiştirebilirsin.";
    if (/yeterli kaynak|tamponu korunamıyor|nakit yetersiz/.test(reason)) return "Bu tutarı ayırınca ödemelerin ve güvenlik payın için yeterli para kalmıyor. Daha küçük bir tutar seçebilirsin.";
    if (/süresi doldu|kotasyon değişti/.test(reason)) return "Bu fiyat artık geçerli değil. Yeni fiyat gelince tekrar değerlendirelim.";
    if (/duraklatıldı/.test(reason)) return "Bu önerinin takibi kapalı. Ayarlardan yeniden açabilirsin.";
    if (/Yanıt gelmedi|belirsiz/.test(reason)) return "İşlemin sonucu henüz belli değil. Tekrar göndermeden sonucunu kontrol edelim.";
    if (/önce|Önce/.test(reason) && /işlem|sonuc/.test(reason)) return "Önce devam eden işlemin sonucunu kontrol edelim.";
    return (reason || "").replace(/Görev/g, "Takip").replace(/görev/g, "takip").replace(/kotasyon/g, "fiyat").replace(/nakit tamponu/g, "güvenlik payı").replace(/Plan/g, "Öneri").replace(/plan/g, "öneri").replace(/mock/g, "demo");
  }
  function receiptCopy(r) {
    if (!r) return "";
    if (r.kind === "save") return A.money(r.amount) + " fonuna eklendi.";
    if (r.kind === "recover") return A.money(r.amount) + " birikiminden vadesiz hesabına geçti.";
    if (r.kind === "bes-change") return "Yeni aylık BES katkın " + A.money(r.amount) + ". Gelecek ödemelerin güncellendi.";
    if (r.kind === "gold-buy") return goldQuantity(r.quantityMg) + " altın hesabına eklendi.";
    if (r.kind === "saved-transfer") return A.money(r.amount) + " transfer edildi · " + (r.label || "");
    if (r.kind === "payee-transfer") return A.money(r.amount) + " transfer edildi · " + (r.payee || "");
    if (TRIAL_KINDS.includes(r.kind)) return (r.label || "") + ".";
    if (r.kind === "redeem") return A.money(r.amount) + " birikiminden vadesiz hesabına geçti.";
    if (r.kind === "ob-pull") return A.money(r.amount) + " diğer bankadan vadesiz hesabına geldi.";
    if (r.kind === "card-pay") return A.money(r.amount) + " kartına ödendi." + (r.topUp ? " " + A.money(r.topUp) + "’si fonundan geldi." : "");
    return r.label || "";
  }
  function updateBudgetPreview(inputId, outputId) {
    var result = A.agent.previewSavings(A.parseMoney(el(inputId).value)), copy = "";
    if (result.valid) {
      copy = result.busy ? "Devam eden işlemden sonra yeniden hesaplayacağım." : result.shortfall ? A.money(result.amount) + " ayırırsan, beklenen giderler ve güvenlik payın için yaklaşık " + A.money(result.shortfall) + " eksik kalır." : !result.feasible ? plainReason(result.reason) : A.money(result.amount) + " ayırırsan, beklenen giderler ve güvenlik payından sonra yaklaşık " + A.money(result.remaining) + " kalır.";
    }
    if (el(outputId).textContent !== copy) text(outputId, copy);
    visible(outputId, !!copy);
    el(outputId).classList.toggle("budget-shortfall", !!result.shortfall);
  }
  function renderTransferNotice(s) {
    var activeNoticeOp = s.operations.find(function (op) { return op.status === "pending" || op.status === "unknown"; });
    if (activeNoticeOp && !view.transferNoticeId) view.transferNoticeId = activeNoticeOp.id;
    var op = s.operations.find(function (op) { return op.id === view.transferNoticeId; }), copy = "";
    var isDismissed = !!op && (view.dismissedTransferNoticeId === op.id || op.status === "succeeded" && view.page === "detail" && op.taskId === activeId());
    var isTrialOp = !!op && TRIAL_KINDS.includes(op.kind), shortUndo = !!op && (TRANSFER_KINDS.includes(op.kind) || OB_KINDS.includes(op.kind) || isTrialOp);
    if (op && !isDismissed) {
      if (op.status === "pending" || op.status === "running") {
        copy = isTrialOp ? "Kararın uygulanmak üzere" : shortUndo
          ? "Transfer gönderilmek üzere"
          : A.money(op.amount) + " · Transfer hazırlanıyor. Gönderilmeden önce geri alabilirsin.";
      } else if (op.status === "cancelled") {
        copy = isTrialOp ? "Kararın geri alındı. Hiçbir ayar değişmedi." : "Transfer iptal edildi. Paran hesaplarında kaldı.";
      } else if (op.status === "unknown") {
        copy = "Transferin sonucu henüz belli değil. Tekrar göndermeden kontrol edelim.";
      } else if (op.status === "succeeded") {
        copy = receiptCopy(op.receipt);
      } else {
        copy = plainReason(op.reason);
      }
    }
    visible("transfer-notice", !!op && !isDismissed);
    if (!op || isDismissed) {
      if (el("transfer-notice-close")) visible("transfer-notice-close", false);
      if (el("transfer-notice-actions")) visible("transfer-notice-actions", false);
      if (el("transfer-notice-share")) visible("transfer-notice-share", false);
      return;
    }
    if (el("transfer-notice-copy").textContent !== copy) text("transfer-notice-copy", copy);
    var canUndo = !!op && op.status === "pending" && Date.now() < op.undoDeadline;
    var isUnknown = !!op && op.status === "unknown";
    var canShare = !!op && op.kind === "saved-transfer" && op.status === "succeeded" && !!op.receipt && op.receipt.verified === true;
    var canCloseNotice = ["succeeded", "cancelled", "failed"].includes(op.status);
    var hadFocus = document.activeElement === el("undo-transfer");
    visible("undo-transfer", canUndo); el("undo-transfer").disabled = !canUndo;
    if (el("transfer-notice-sep")) visible("transfer-notice-sep", canUndo && shortUndo);
    if (el("transfer-notice-actions")) {
      visible("transfer-notice-actions", isUnknown || canShare);
    }
    if (el("transfer-notice-reconcile")) {
      visible("transfer-notice-reconcile", isUnknown);
      el("transfer-notice-reconcile").disabled = isUnknown && op.reconciling;
    }
    if (el("transfer-notice-review")) {
      visible("transfer-notice-review", isUnknown);
    }
    if (el("transfer-notice-share")) {
      visible("transfer-notice-share", canShare);
      el("transfer-notice-share").disabled = !canShare;
      if (canShare) el("transfer-notice-share").dataset.operationId = op.id;
    }
    if (el("transfer-notice-close")) {
      visible("transfer-notice-close", canCloseNotice);
    }
    if (el("transfer-share-preview")) {
      var isShareOpen = canShare && !!view.shareOpen;
      visible("transfer-share-preview", isShareOpen);
      if (isShareOpen) {
        text("share-bubble-msg", A.money(op.amount) + " gönderdim.");
        var noteInput = el("transfer-share-note");
        if (noteInput && document.activeElement !== noteInput) {
          noteInput.value = view.shareCustomNote !== undefined ? view.shareCustomNote : ((op.receipt && op.receipt.note) || "Aylık destek");
        }
        var dateStr = A.USER && A.USER.today ? A.USER.today : "12 Ekim 2026";
        var payeeStr = (op.receipt && op.receipt.payee) || op.payeeLabel || "Kayıtlı Alıcı";
        var ibanStr = (op.receipt && op.receipt.ibanMask) || "TR** **** 4821";
        var refStr = (op.receipt && op.receipt.reference) || "MOCK";
        el("share-receipt-facts").innerHTML = rows([
          ["Tutar", A.money(op.amount)],
          ["Tarih", dateStr],
          ["İşlem referansı", refStr],
          ["Gönderen", "Deniz Yılmaz"],
          ["Alıcı", payeeStr],
          ["Alıcı IBAN", ibanStr]
        ]);
        var hasDraft = !!op.shareDraft;
        visible("transfer-share-status", hasDraft);
        if (hasDraft) {
          text("transfer-share-status", "Paylaşım taslağı hazırlandı");
          if (el("transfer-share-confirm")) text("transfer-share-confirm", "Tamam");
        } else {
          if (el("transfer-share-confirm")) text("transfer-share-confirm", "Paylaşım taslağı hazırla");
        }
      }
    }
    if (el("transfer-review-preview")) {
      var isReviewOpen = isUnknown && !!view.transferReviewOpen;
      visible("transfer-review-preview", isReviewOpen);
      if (isReviewOpen) {
        var savedReview = s.tasks[op.taskId] && s.tasks[op.taskId].humanReview;
        var matchesOperation = savedReview && savedReview.operationId === op.id;
        var hr = matchesOperation ? savedReview : A.agent.buildHumanReviewSummary(op.taskId);
        renderInlineReview("transfer-review", op.taskId, hr, matchesOperation && savedReview);

      }
    }
    el("undo-transfer").dataset.operationId = canUndo ? op.id : "";
    if (hadFocus && !canUndo) el(op ? "transfer-notice" : "screen-title").focus({ preventScroll: true });
  }
  function inlineReviewControls(prefix) {
    if (prefix === "shield-review") return { save: "shield-review-save", status: "shield-review-status", open: "shieldReviewOpen" };
    return prefix === "transfer-review" ? { save: "transfer-review-save", status: "transfer-review-status", open: "transferReviewOpen" } : { save: "human-review-save", status: "human-review-status", open: "humanReviewOpen" };
  }
  // Okunabilir özet: düzenleme alanları isteğe bağlı açılır; varsayılan görünüm kısa başlıklı satırlardır.
  // Ek bağlam akışı · özet: önce banka kaydı (işlem, durum, gerekçeler, müşterinin cevapları), sonra ayrı olarak müşterinin notu. Puan yok.
  function contextReadableHtml(draft) {
    var v = draft.values, c = draft.ctx || {}, word = A.SHIELD_CONTEXT.answers, short = A.SHIELD_CONTEXT.short;
    var answers = [[short.directed, (c.answers || {}).directed], [short.secrecy, (c.answers || {}).secrecy], [short.feeling, (c.answers || {}).feeling]].filter(function (x) { return x[1]; });
    var rs = (c.reasons || []).filter(function (x) { return KISA_REASON[x] && (!presentation.kisa || CUSTOMER_SAFE[x]); });
    var chips = rs.map(function (x) { return '<li>' + KISA_REASON[x][0] + '</li>'; }).join("");
    return '<div><dt>İşlem</dt><dd>' + A.escape(v.operation) + '</dd></div><div><dt>Durum</dt><dd>' + A.escape(v.verified) + '</dd></div>' +
      (chips ? '<div><dt>Gerekçeler</dt><dd><ul class="review-chips">' + chips + '</ul></dd></div>' : '') +
      '<div><dt>Cevapların</dt><dd>' + (answers.length ? '<ul>' + answers.map(function (x) { return '<li>' + x[0] + ': ' + word[x[1]] + '</li>'; }).join("") + '</ul>' : 'Yanıtlanmadı') + '</dd></div>' +
      (v.question && v.question.trim() ? '<div class="review-note"><dt>Senin notun</dt><dd>' + A.escape(v.question.trim()) + '</dd></div>' : '');
  }
  function renderReviewReadable(prefix, draft) {
    var node = el(prefix + "-readable"); if (!node || !draft) return;
    var v = draft.values, html = draft.ctx ? contextReadableHtml(draft) : draft.userEdited ? '<div><dt>Temsilciye gösterilecek özet</dt><dd>' + A.escape(v.summary) + '</dd></div>'
      : [["Sorun", v.question], ["İşlem", v.operation], ["Durum", v.verified], ["Fark edilen işaretler", v.uncertainty]].filter(function (r) { return r[1] && r[1].trim(); })
        .map(function (r) {
          // İşaretler tek paragraf yerine madde madde; "Güvenlik sinyalleri (risk N/100):" öneki ayrı satıra alınır.
          if (r[0] !== "Fark edilen işaretler") return '<div><dt>' + r[0] + '</dt><dd>' + A.escape(r[1].trim()) + '</dd></div>';
          var text = r[1].trim(), risk = "", items;
          if (/\n/.test(text)) {
            // C2-11 biçimi: "Güvenlik işaretleri · risk puanı N/100" + madde satırları.
            var lines = text.split(/\n+/), first = lines[0].match(/risk (?:puanı )?(\d+\/100)/);
            if (first) { risk = "risk " + first[1]; lines = lines.slice(1); }
            items = lines.map(function (x) { return x.replace(/^\s*•\s*/, "").trim().replace(/\.$/, ""); }).filter(Boolean);
          } else {
            var head = (text.match(/^[^:]*\(risk \d+\/100\):\s*/) || [""])[0];
            if (head) risk = head.replace(/^.*\((risk \d+\/100)\).*$/, "$1");
            items = text.slice(head.length).split(/;\s*|\.\s+(?=Güvenlik sorusu)/).map(function (x) { return x.trim().replace(/\.$/, ""); }).filter(Boolean);
          }
          if (!risk) return '<div><dt>' + r[0] + '</dt><dd><ul>' + items.map(function (x) { return '<li>' + A.escape(x) + '</li>'; }).join("") + '</ul></dd></div>';
          // 28 Ekim (sahip: "daha da kısalt"): kalkan özetinde uzun işaret cümleleri yerine kalkandaki kısa çipler; puan yerine işaret sayısı.
          var plan = A.agent.getSnapshot().plans.transfer, short = {}, bare = function (x) { return String(x).trim().replace(/\.$/, ""); };
          ((plan && plan.risk && plan.risk.signals) || []).forEach(function (x) { if (x.active) short[bare(x.label)] = riskChip(x); });
          var chips = items.filter(function (x) { return short[bare(x)]; }), rest = items.filter(function (x) { return !short[bare(x)]; });
          return '<div><dt>İşaretler · ' + (chips.length || items.length) + '</dt><dd><ul class="review-chips">' + chips.map(function (x) { return '<li>' + A.escape(short[bare(x)]) + '</li>'; }).join("") + '</ul>' +
            (rest.length ? '<ul class="review-rest">' + rest.map(function (x) { return '<li>' + A.escape(x) + '</li>'; }).join("") + '</ul>' : '') + '</dd></div>';
        }).join("");
    if (node._html !== html) { node.innerHTML = html; node._html = html; }
  }
  function renderInlineReview(prefix, taskId, hr, saved) {
    var drafts = view.inlineReviewDrafts || (view.inlineReviewDrafts = {}), key = taskId + ":" + (hr.operationId || hr.operationRef || "general");
    var draft = drafts[prefix];
    if (!draft || draft.key !== key) {
      draft = drafts[prefix] = { key: key, taskId: taskId, operationId: hr.operationId || null, dirty: false, userEdited: false, values: { question: hr.question || "", operation: hr.operation || "", verified: hr.verifiedStatus || "", uncertainty: hr.uncertainty || "", summary: hr.summaryText || "" } };
    }
    // Ek bağlam özeti: banka kaydı alanları her çizimde kayıttan gelir (iptal/koruma sonrası durum güncel kalır); müşterinin yazdığı not korunur.
    if (hr.flow === "context") {
      draft.ctx = { answers: hr.answers, reasons: hr.reasons };
      draft.values.operation = hr.operation; draft.values.verified = hr.verifiedStatus; draft.values.uncertainty = hr.uncertainty; draft.values.summary = hr.summaryText;
      if (!draft.dirty) draft.values.question = hr.question || "";
    }
    Object.keys(draft.values).forEach(function (field) {
      var input = el(prefix + "-" + field);
      if (input && input.value !== draft.values[field]) input.value = draft.values[field];
    });
    var summary = el(prefix + "-summary"); if (summary) summary.dataset.userEdited = draft.userEdited ? "true" : "false";
    renderReviewReadable(prefix, draft);
    var controls = inlineReviewControls(prefix), hasSaved = !!saved && saved.status === "draft" && !draft.dirty;
    visible(controls.status, hasSaved);
    if (hasSaved) text(controls.status, hr.flow === "context" ? (saved.editedByUser ? "Notunla kaydedildi · " : "Özet hazırlandı · ") + saved.reference + " · henüz iletilmedi" : prefix === "shield-review" ? "Özet hazır · " + saved.reference : "İnceleme taslağın hazırlandı. Referans: " + saved.reference);
    if (prefix === "shield-review" && el("shield-review-disclaimer")) text("shield-review-disclaimer", hr.flow === "context" ? "Temsilciyi aradığında bu referansı söyle. Özet henüz iletilmedi." : "Temsilciyi aradığında bunu görür.");
    text(controls.save, hasSaved ? "Tamam" : "Özet taslağını kaydet");
    // G3: kaydedildikten sonra "Tamam" kapatır; yanındaki "Kapat" aynı işi yapan ikinci düğme olmasın.
    if (el(prefix + "-cancel")) visible(prefix + "-cancel", !hasSaved);
  }
  async function saveInlineReview(prefix) {
    var draft = view.inlineReviewDrafts && view.inlineReviewDrafts[prefix], controls = inlineReviewControls(prefix);
    if (!draft || draft.saving) return;
    if (!draft.dirty && el(controls.save).textContent === "Tamam") { view[controls.open] = false; render(A.agent.getSnapshot()); return; }
    if (prefix === "transfer-review") {
      var currentOp = A.agent.getSnapshot().operations.find(function (o) { return o.id === view.transferNoticeId; });
      if (!currentOp || currentOp.id !== draft.operationId || currentOp.taskId !== draft.taskId) return;
    }
    var generation = A.agent.getSnapshot().generation;
    draft.saving = true;
    var v = draft.values, saved = A.agent.getSnapshot().tasks[draft.taskId].humanReview;
    var result = await command({ type: "human-review", taskId: draft.taskId, question: v.question, operation: v.operation, verifiedStatus: v.verified, uncertainty: v.uncertainty, summaryText: v.summary, editedByUser: true,
      operationRef: prefix === "shield-review" && saved ? saved.operationRef : undefined });
    if (generation !== A.agent.getSnapshot().generation) return;
    draft.saving = false;
    if (result.ok) draft.dirty = false;
    render(A.agent.getSnapshot());
  }
  function renderRefundNotice(s) {
    var notice = (s.bank.notifications || []).filter(function (n) { return n.type === "refund-received"; }).slice(-1)[0];
    var isVisible = !!notice && (view.dismissedRefundNoticeId !== notice.id);
    visible("refund-notice", isVisible);
    if (isVisible) {
      var copy = "İade hesabına geçti: " + A.money(notice.amount) + " · " + (notice.label || "İade") + " (" + (notice.statusText || "Tamamlandı") + ")";
      text("refund-notice-copy", copy);
    }
  }
  function explanation(taskId, s) {
    var p = s.plans[taskId], f = s.forecast;
    if (taskId === "savings" && f.horizonExpired) return '<p class="agent-muted">Bu örnek dönemi sona erdi. Güncel bir gider tahmini için yeni dönem verisi gerekiyor.</p>';
    // 22 Ekim ("önce borç"): ekstre ayrı satırda; birikim önerisi kart borcundan sonra kalan paradan yapılır.
    var stmtOwe = s.cardStatement && s.cardStatement.open && f.breakdown.known.some(function (x) { return x.id === "card-statement-stmt"; }) ? s.cardStatement.outstanding : 0;
    if (taskId === "savings") return rows([["Hesabındaki para", A.money(s.balances.cash)]].concat(f.incoming ? [["Onaylı gelecek girişler", "+ " + A.money(f.incoming)]] : []).concat([["Ayın kalan giderleri", "− " + A.money(f.expected - stmtOwe)]]).concat(stmtOwe ? [["Kart ekstren", "− " + A.money(stmtOwe)]] : []).concat([["Güvenlik payın", "− " + A.money(f.buffer)]]).concat(f.liquidityReserve ? [["Kırılgan gün için ayrılan", "− " + A.money(f.liquidityReserve)]] : []).concat(f.reserved ? [["Devam eden işlem için ayrılan", "− " + A.money(f.reserved)]] : []).concat([[f.shortfall ? "Eksik kalan" : "Ayırabileceğin tutar", A.money(f.shortfall || f.available)]])) +
      '<ul class="why-points agent-muted"><li>Giderler: son 12 ayın ortalaması (market, fatura, günlük harcama).</li><li>Bugünkü fiyatlar ve ayın kalan günleri hesapta.</li><li>Güvenlik payı vadesizde kalır. Otomatik ödemeler oradan çekilir, fon kendiliğinden bozulmaz.</li><li>' + (f.shortfall ? "Bu ay yeni birikim yerine fondan vadesize aktarım öneriyorum." : "Bu bir tahmin, tutarı değiştirebilir ya da şimdi ayırmayabilirsin.") + '</li></ul>';
    if (taskId === "subscription") return rows([["DigitalFilm · önceki tutar", A.money(s.bank.subscription.previousAmount)], ["DigitalFilm · sıradaki tutar", A.money(s.bank.subscription.amount)], ["Ücret artışı", s.bank.subscription.priceChanged ? "%40" : "Henüz değişmedi"], ["Sinaptikşlarda haber alma", s.bank.priceAlerts.enabled ? "Açık" : "Kapalı"]]) + '<p class="agent-muted">Aynı hizmetin önceki ve güncel ödeme tutarlarını karşılaştırıyorum. Ödeme talimatlarına dokunmadan farkı gösteriyorum. Yeni fatura tutarı belli değilse listede son ödenen tutar görünür.</p>';
    if (taskId === "bes") {
      var estimate = p && ["awaiting", "blocked", "running", "unknown"].includes(p.status) && p.facts.besEstimate ? p.facts.besEstimate : s.besEstimate;
      return rows([["Mevcut aylık katkın", A.money(s.bank.bes.monthly)], ["Seçtiğin yeni aylık katkı", A.money(s.goals.bes.target)], ["Bu yıl kalan ödemeler", estimate.payments + " ödeme"], ["İlave katkı toplamı", A.money(estimate.extra)], ["İlave devlet katkısı tahmini", A.money(estimate.estimatedStateContribution)]]) +
        '<p class="agent-muted">%20 oranı, 2026 kuralına ve kalan yıllık limite göre hesaplandı. Yıllık uygun katkı sınırı ' + A.money(A.RULES.bes.annualEligibleCap) + '. Bu değişiklik şimdi para çekmez. Gelecek katkı ödemelerine uygulanır.</p><p class="agent-muted">' + A.escape(A.RULES.bes.conditions) + '</p>' + sourceLink(A.RULES.bes.source, "Hesabın dayanağı · EGM");
    }
    return rows([["Bankanın alış fiyatı", A.money(s.bank.quote.bid) + "/gram"], ["Bankanın satış fiyatı", A.money(s.bank.quote.ask) + "/gram"], ["Alış-satış farkı", "%" + (s.spreadBps / 100).toLocaleString("tr-TR")], ["Seçtiğin en yüksek fark", "%" + (s.goals.gold.thresholdBps / 100).toLocaleString("tr-TR")]]) +
      '<p class="agent-muted">Fark = (satış − alış) / satış. ' + (s.now >= s.bank.quote.expiresAt ? "Fiyatın süresi doldu. Bu fiyatla alım yapılamaz." : "Bu fiyat iki dakika geçerlidir.") + ' Belirli bir saatte daha düşük fark olacağı vaat edilmez.</p>';
  }
  // 17 Ekim (16 Ekim görüşmeleri): güvenlik payı "günlük limit", "31 Ekim'de kalan para" ve "13:00 sonrası çekebileceğim tek tutar" sanıldı.
  // Tanım her yerde aynı cümleyle ve ne işe yaradığıyla verilir.
  // 17 Ekim: payın kişinin harcamasından geldiği açıkça söylenir ("ortalama 3 günlük harcaman").
  // 26 Ekim: aynı anda tutulan yatırımlar varsa pay "3 günlük harcama + yatırımlarına ulaşma süresi"dir (Hesaplarım · Yatırımların).
  function bufferBasis(s) {
    var p = s.portfolio, f = s.forecast;
    if (!f.bufferAuto) return "senin belirlediğin tutar";
    if (p && p.basket && p.buffer.extra) return A.RULES.portfolio.baseDays + " günlük harcaman ve yatırımlarına ulaşma süren";
    return "ortalama " + Math.max(1, Math.round(f.buffer / Math.max(1, f.dailyAverage))) + " günlük harcaman";
  }
  function fundTo(code) { return code === "AIS" ? "AIS'e" : "ALE'ye"; }
  function fundIn(code) { return code === "AIS" ? "AIS'te" : "ALE'de"; }
  function bufferMeaning() { return "Güvenlik payı, giderlerin tahminimden fazla çıkarsa diye vadesizde ayrıca kalan paradır"; }
  // Kalkan açıkken veya koruma sürerken yeni birikim önerisi askıda; dolandırıcılık anında "parayı ayır" denmez.
  // Ekstre açıkken açık, ekstre kartında fondan tamamlanır; birikim kartı oraya yönlendirir.
  // 24 Ekim inceleme (A2): "aynı para" bakiye kartında görünür. Ekstre + ödemeler + güvenlik payı + ayırabileceğin = vadesiz.
  // Bölümler kalıcı düğümler; tutar değişince genişlik yumuşakça kayar (ekstre ödenince ayırabileceğin büyür).
  function homeAllocParts(s) {
    var f = s.forecast, c = s.cardStatement, stmt = c && c.open ? Math.min(c.outstanding, f.expected) : 0;
    return [
      { key: "stmt", label: "Kart ekstresi", amount: stmt, tone: "amber" },
      { key: "payments", label: "Ödemeler", amount: Math.max(0, f.expected - stmt), tone: "ink" },
      { key: "pay", label: "Güvenlik payı", amount: f.buffer, tone: "blue" },
      { key: "save", label: "Ayırabileceğin", amount: f.available, tone: "green" }
    ];
  }
  function renderHomeAlloc(s) {
    var host = el("home-alloc"), on = era.era === "today" && !s.forecast.horizonExpired && s.balances.cash > 0;
    visible("home-alloc", on); el("home-forecast").classList.toggle("sr-only", on);
    if (!on) return;
    var parts = homeAllocParts(s), total = Math.max(1, s.balances.cash, parts.reduce(function (a, x) { return a + x.amount; }, 0));
    if (!host.firstChild) host.innerHTML = '<div class="era-alloc-bar home-alloc-bar" aria-hidden="true">' + parts.map(function (x) { return '<i class="tone-' + x.tone + '" data-home-seg="' + x.key + '" style="flex-grow:0"></i>'; }).join("") + '</div><dl class="home-alloc-legend">' +
      parts.map(function (x) { return '<div data-home-leg="' + x.key + '"><dt><span class="era-dot tone-' + x.tone + '" aria-hidden="true"></span>' + x.label + '</dt><dd></dd></div>'; }).join("") + '</dl>';
    parts.forEach(function (x) {
      host.querySelector('[data-home-seg="' + x.key + '"]').style.flexGrow = String(Math.round(x.amount / total * 1000));
      var leg = host.querySelector('[data-home-leg="' + x.key + '"]'), txt = A.money(x.amount);
      leg.hidden = !x.amount && x.key === "stmt";
      leg.classList.toggle("is-zero", !x.amount);
      if (leg.lastChild.textContent !== txt) leg.lastChild.textContent = txt;
    });
  }
  function openCardPay() {
    go("card");
    var target = el("card-statement-title") || el("screen-title");
    if (target) { target.focus({ preventScroll: true }); if (target.scrollIntoView) target.scrollIntoView({ block: "start" }); }
  }
  function statementHold(s) { return !!(presentation.features.guards && s.cardStatement && s.cardStatement.open && s.forecast.shortfall > 0); }
  function shieldHold(s) { return !!(s.shieldActive || s.shield && s.shield.status === "protected" && s.protection.newPayeeLocked); }
  function offer(taskId, s) {
    var t = s.tasks[taskId], p = s.plans[taskId], pending = p && ["awaiting", "blocked"].includes(p.status), r = t.lastReceipt;
    if (taskId === "savings" && s.forecast.horizonExpired && !["pending", "running", "unknown"].includes(t.status) && !(t.status === "succeeded" && r)) return { title: "Bu örnek dönemi sona erdi", amount: "", note: "Güncel gider tahmini için yeni dönem verisi gerekiyor.", action: "Yeni dönem verisi gerekiyor", disabled: true };
    var o = { title: cardTitles[taskId], amount: "", note: "", action: "", settings: false, stack: false };
    if (taskId === "savings") {
      o.offered = pending ? p.amount : t.status === "succeeded" && r ? r.amount : s.forecast.available;
      o.amount = A.money(o.offered);
      // 16 Ekim görüşmeleri: güvenlik payı "Neden bu tutar?" içinde bulunamadı ve "günlük 5.000 TL" sanıldı; hesap ve tanım kartta yazılır.
      // 27 Ekim (sahip): kalkan gibi kademeli. Pay ilk bakışta "Paranın yolu" çubuğunda mavi parça, adı ve tutarı bir dokunuşta, tanımı iki dokunuşta.
      var f = s.forecast, plain = !f.incoming && !f.liquidityReserve && !f.reserved && !f.shortfall;
      // 28 Ekim (sahip: "kimse okumaz"): üç kısa satır, noktalı virgül yok. Tutarlar bir önceki kademede (çubuğun açıklaması).
      o.noteLines = [(plain ? "Ödemelerin" : "Bu ayki giderlerin") + " ve güvenlik payın ayrıldıktan sonra kalan.", "Güvenlik payı " + bufferBasis(s) + " kadar.", "Vadesizde kalır, günlük limit değil."];
      o.note = o.noteLines.join(" ");
      // Açık varken düz metin açıklar (çubuk nakitten büyük olurdu); aşağıdaki uyarı ve sonuç dalları da düz metindir.
      o.stack = !f.shortfall;
      // 17 Ekim: bir katılımcı fondaki parayı istediği an geri alabileceğini bilmiyordu; bu bilgi notun sonunda kaybolmasın, ayrı satırda.
      o.redeem = s.fund.product.redeem;
      o.action = o.amount + " ayır";
      if (shieldHold(s) && !(pending && p.kind === "recover")) { o.stack = false; o.redeem = ""; o.title = "Önce güvenliğin"; o.amount = ""; o.note = "Güvenlik kalkanı açıkken yeni birikim önerisi göstermiyorum. Kalkan kapanınca güncel tutarı yeniden hesaplarım."; o.action = "Kalkan açıkken öneri bekliyor"; o.disabled = true; }
      if (statementHold(s) && !pending) { o.stack = false; o.redeem = ""; o.title = "Önce kart ekstren"; o.amount = ""; o.note = "Ekstreni ödeyince kalan parayı yeniden hesaplarım."; o.action = "Ekstreye git"; }
      if (pending && p.kind === "recover") { o.stack = false; o.redeem = ""; o.title = "Beklenmedik giderin için birikimin yanında"; o.note = "Ödemelerin ve güvenlik payın için " + A.money(s.forecast.shortfall) + " eksik kalıyor. Birikiminden hesabına alabilirsin."; o.action = o.amount + " hesabıma al"; }
    }
    if (taskId === "subscription") {
      o.amount = A.money(s.bank.subscription.amount) + " / ay";
      o.title = s.bank.subscription.priceChanged ? "Abonelik ödemen yükseldi" : cardTitles[taskId];
      o.note = s.bank.subscription.priceChanged ? "DigitalFilm ödemen 200 TL’den 280 TL’ye çıktı (%40). Ödemen aynı talimatla devam ediyor." : s.bank.priceAlerts.enabled ? "Ücret artışlarında haber alıyorsun. Ödemelerini ve sıradaki tutarları tek listede görebilirsin." : (s.forecast.shortfall > 0 ? "Otomatik ödemelerin sürüyor. Bir ücret artışı varsa burada görebilirsin." : "Otomatik ödeme tutarlarını karşılaştırırım. İstersen ücret artışlarında haber alabilirsin.");
      o.action = s.bank.priceAlerts.enabled ? "Haber alma ayarları" : "Ücret artarsa haber alayım";
    }
    if (taskId === "bes") {
      o.amount = A.money(pending ? p.amount : t.status === "succeeded" ? s.bank.bes.monthly : s.goals.bes.target) + " / ay";
      o.note = s.forecast.shortfall > 0 ? "BES katkını artırma taslağı bu bütçede uygun değil. Mevcut katkı talimatın sürüyor." : "Aylık " + A.money(s.bank.bes.monthly) + " katkını istersen " + A.money(s.goals.bes.target) + " yapabilirsin. Bütçene uygunluğunu kontrol eder, son kararı sana bırakırım.";
      o.action = s.forecast.shortfall > 0 ? "Mevcut talimatım" : "Katkımı " + A.money(s.goals.bes.target) + " yap";
    }
    if (taskId === "gold") {
      o.amount = "%" + (s.spreadBps / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
      o.note = s.forecast.shortfall > 0 ? "Altın koşulun takip ediliyor. Bu bütçeyle yeni alım önerilmiyor." : (s.goals.gold.watching ? "Alış-satış farkını seçtiğin koşula göre izliyorum. Alım için ayrıca onayını isteyeceğim." : "Bankanın alış ve satış fiyatları arasındaki fark. İstediğin seviyeye gelince alımı sana sorabilirim.");
      o.action = s.forecast.shortfall > 0 ? "Takip ayarlarım" : (pending && p.kind === "gold-buy" ? A.money(p.amount) + " altın al" : s.goals.gold.watching ? "Takip ayarlarım" : "Benim için takip et");
    }
    if (t.paused) { o.stack = false; o.note = "Bu önerinin takibi kapalı. Yeniden açmak istersen ayarlardan değiştirebilirsin."; o.action = "Takibi aç"; o.settings = true; }
    else if (t.status === "pending" || t.status === "running") {
      o.working = true;
      if (p) { o.amount = A.money(p.amount); if (taskId === "savings") { o.offered = p.amount; o.action = o.amount + (p.kind === "recover" ? " hesabıma al" : " ayır"); } }
    }
    else if (t.status === "cancelled") { o.stack = false; o.note = "Transfer iptal edildi. Paran hesaplarında kaldı."; o.action = "Öneriyi yeniden göster"; }
    else if (t.status === "unknown") { o.stack = false; o.note = "İşlemin sonucu henüz belli değil. Yeniden göndermeden kontrol edelim."; o.action = "İşlemin sonucuna bak"; }
    else if (t.status === "failed" || t.status === "blocked") { o.stack = false; o.note = plainReason(t.reason); o.action = taskId === "gold" ? "Takip ayarlarım" : "Seçeneklerime bak"; }
    else if (t.status === "succeeded" && r && !pending) { o.stack = false; o.note = receiptCopy(r); o.action = "İşlemimi gör"; if (taskId === "gold") o.amount = goldQuantity(r.quantityMg); }
    return o;
  }
  // 27 Ekim (sahip: "too much text"): birikim notu kalkan göstergesinin kademeli biçimiyle. Her dokunuş biraz ekler, son dokunuş sadeye döner:
  // 0 · "Paranın yolu" + oranlı çubuk (sayı yok) → 1 · parçaların tutarları → 2 · hesabın ve güvenlik payının sade cümlesi. Ayrıntılı tablo "Neden bu tutar?" içinde kalır.
  // Çubuk kartın önerdiği tutarı gösterir: tutar değiştirilince ayrılmayan kısım "Vadesizde kalır" olur, başlıkla çelişmez.
  // 28 Ekim (sahip: "Birikim'de 22.000, Ekstre'de 4.000 diyor"): ekstre açıkken önerinin neden düştüğü kartta görünür.
  // Ekstre olmasaydı ayırabileceğin tutar üstü çizili, yanında bakiye çubuğundaki sarı parçayla aynı renkte "Önce kart ekstren".
  function wasHtml(s, o) {
    if (presentation.kisa) return kisaWasHtml(s, o);
    var stmt = homeAllocParts(s)[0].amount;
    if (!o.stack || !stmt || s.forecast.shortfall || o.offered !== s.forecast.available) return "";
    return '<span class="sr-only">Ekstreden önce </span><s>' + A.money(o.offered + stmt) + '</s><span class="was-chip"><i class="era-dot tone-amber" aria-hidden="true"></i>Önce kart ekstren</span>';
  }
  // 5 Kasım (sahip): kısa sürümde ekstre baştan hesapta, "önce kart ekstren" çizgisi yok. Yalnız beklenmedik masraf öneriyi düşürünce
  // eski öneri üstü çizili, yanında kırmızı neden çipi (uyarıdaki ünlemle aynı renk).
  function kisaWasHtml(s, o) {
    var k = view.kisaShock;
    if (!k || !o.stack || s.forecast.shortfall || o.offered !== s.forecast.available || k.before <= o.offered) return "";
    return '<span class="sr-only">Masraftan önce </span><s>' + A.money(k.before) + '</s><span class="was-chip is-shock"><i class="era-dot tone-red" aria-hidden="true"></i>' + A.escape(k.label) + '</span>';
  }
  function moneyParts(s, offered) {
    var parts = homeAllocParts(s), save = parts.pop(), rest = Math.max(0, save.amount - offered);
    return parts.concat([{ key: "save", label: rest ? "Ayıracağın" : save.label, amount: offered, tone: "green" }], rest ? [{ key: "rest", label: "Vadesizde kalır", amount: rest, tone: "free" }] : []).filter(function (x) { return x.amount > 0; });
  }
  function moneyStackHtml(s, lines, offered) {
    var parts = moneyParts(s, offered), total = Math.max(1, parts.reduce(function (a, x) { return a + x.amount; }, 0));
    return stackHtml("savings-why", "money-stack", "Paranın yolu",
      '<span class="money-track" aria-hidden="true">' + parts.map(function (x) { return '<i class="tone-' + x.tone + '" style="flex-grow:' + Math.round(x.amount / total * 1000) + '"></i>'; }).join("") + '</span>',
      "Paranın yolu: " + parts.map(function (x) { return x.label + " " + A.money(x.amount); }).join(", "),
      ['<dl class="home-alloc-legend money-legend">' + parts.map(function (x) { return '<div data-money-leg="' + x.key + '"><dt><span class="era-dot tone-' + x.tone + '" aria-hidden="true"></span>' + x.label + '</dt><dd>' + A.money(x.amount) + '</dd></div>'; }).join("") + '</dl>',
        '<ul class="risk-note money-why">' + lines.map(function (x) { return '<li>' + A.escape(x) + '</li>'; }).join("") + '</ul>']);
  }
  function activity(events) {
    var titles = { perception: "Güncel durumuna baktım", reasoning: "Önerini hesapladım", guardrail: "Sınırlarını kontrol ettim", approval: "Onayını aldım", pending: "Transferi göndermeden bekliyorum", cancel: "Transferi göndermeden iptal ettim", verified: "İşlemin sonucunu doğruladım", replan: "Değişen duruma göre yeniden hesapladım", error: "İşlem tamamlanmadı", uncertainty: "Sonucu kontrol etmek gerekiyor", event: "Yeni bir durum oluştu", permission: "Ayarların değişti", control: "Takip tercihin değişti", notification: "Ücret artışı var" };
    return events.filter(function (e) { return titles[e.phase]; }).length ? '<ol class="agent-timeline">' + events.filter(function (e) { return titles[e.phase]; }).slice(-20).reverse().map(function (e) {
      var note = e.phase === "notification" ? A.money(e.detail.previous) + " → " + A.money(e.detail.current) : e.phase === "verified" && e.detail.kind === "price-alert" ? "Haber alma tercihin kaydedildi. Otomatik ödemelerin devam ediyor." : e.phase === "reasoning" ? kindNames[e.detail.kind] + " · " + A.money(e.detail.amount) : e.phase === "guardrail" ? (e.detail.needsApproval ? "Bu işlem için son karar sende." : e.detail.allowed ? "Belirlediğin sınırlara uygun." : plainReason(e.detail.reason)) : e.phase === "verified" ? "İşlem kaydını ayrıca kontrol ettim." : e.phase === "event" && e.detail.amount ? A.money(e.detail.amount) + " yeni gider gerçekleşti." : e.phase === "error" || e.phase === "uncertainty" ? plainReason(e.detail.reason) : "";
      return '<li><div class="agent-log-meta">' + new Date(e.at).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }) + '</div><b>' + A.escape(e.phase === "verified" && e.detail.kind === "price-alert" ? "Haber alma tercihini kontrol ettim" : titles[e.phase]) + '</b><p>' + A.escape(note) + '</p></li>';
    }).join("") + '</ol>' : '<p class="agent-muted">Henüz bir işlem yapılmadı.</p>';
  }
  function paymentList(payments) {
    function date(value) { return new Date(value + "T12:00:00+03:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", timeZone: "Europe/Istanbul" }); }
    return payments.map(function (payment) {
      var confirmed = payment.amount !== null;
      return '<li class="automatic-payment-row" data-payment="' + A.escape(payment.id) + '"><div class="payment-heading"><b>' + A.escape(payment.label) + '</b><span>' + A.money(confirmed ? payment.amount : payment.lastAmount) + '</span></div>' +
        '<p>' + (confirmed ? date(payment.nextDue) + ' · sıradaki ödeme' : date(payment.lastPaid) + ' · son ödeme') + '</p>' +
        (payment.priceChanged ? '<p class="payment-change">' + A.money(payment.previousAmount) + ' → ' + A.money(payment.amount) + ' · %40 artış</p>' : '') +
        (!confirmed ? '<p class="payment-pending">Yeni fatura tutarı henüz belli değil · ' + date(payment.nextDue) + '</p>' : '') + '</li>';
    }).join("");
  }
  function rememberPlan() {
    var p = A.agent.getSnapshot().plans[activeId()];
    reviewedPlan = p ? { taskId: p.taskId, id: p.id, version: p.version } : null;
  }
  function fitCard() {
    var height = el("slide-" + activeId()).scrollHeight;
    if (height > 0) el("carousel").style.height = height + "px";
  }
  var TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  function formatDayLabel(dateStr, isToday) {
    var parts = (dateStr || "").split("-");
    if (parts.length < 3) return dateStr;
    var day = parseInt(parts[2], 10);
    var month = TR_MONTHS[parseInt(parts[1], 10) - 1] || "";
    var year = parts[0];
    if (isNaN(day) || !month) return dateStr;
    var formatted = day + " " + month + " " + year;
    if (isToday) return "Bugün · " + formatted;
    return formatted;
  }
  function renderAccountsLedger(s) {
    var query = (view.ledgerSearch || "").trim();
    if (el("ledger-search") && el("ledger-search").value !== query && document.activeElement !== el("ledger-search")) {
      el("ledger-search").value = query;
    }
    if (el("ledger-search-clear")) {
      visible("ledger-search-clear", !!query);
    }
    var txs = (s.bank && s.bank.transactions) || [];
    var attention = s.ledgerAttention || {};
    var filtered = query ? txs.filter(function (tx) { return A.matchTransactionSemantic(tx, query, s.now); }) : txs;

    if (query && filtered.length === 0) {
      el("accounts-ledger").innerHTML = '<div class="ledger-empty-state">' +
        '<p class="ledger-empty-title">Eşleşen işlem bulunamadı</p>' +
        '<p class="agent-muted">“<strong>' + A.escape(query) + '</strong>” ile eşleşen bir hesap hareketi bulunamadı.</p>' +
        '<button type="button" class="btn line-dark small pill" id="ledger-empty-clear">Aramayı temizle</button>' +
        '</div>';
      text("ledger-search-status", "0 sonuç bulundu");
      return;
    }

    text("ledger-search-status", query ? filtered.length + " işlem bulundu" : "");
    var ecoCount = presentation.features.ecosystem ? txs.filter(function (tx) { return ECO_LEDGER[tx.category]; }).length : 0;
    visible("ledger-info-chip", !!ecoCount && !query && !view.ecoChipUsed);
    if (ecoCount) el("ledger-info-chip").innerHTML = '<span class="chip-i" aria-hidden="true">i</span>' + ecoCount + ' işlemde senin için bilgi var <span aria-hidden="true">→</span>';

    var groups = {};
    for (var i = 0; i < filtered.length; i++) {
      var tx = filtered[i];
      var dayKey = A.simulationDay(tx.at) || A.simulationDay(s.now);
      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(tx);
    }

    var allDays = {};
    for (var a = 0; a < txs.length; a++) {
      var k = A.simulationDay(txs[a].at) || A.simulationDay(s.now);
      allDays[k] = true;
    }
    var sortedAllDays = Object.keys(allDays).sort().reverse();
    var todayKey = A.simulationDay(s.now), latestDayKey = sortedAllDays[0] || todayKey;
    var sortedDays = Object.keys(groups).sort().reverse();

    var activeHeaderId = document.activeElement && document.activeElement.id && document.activeElement.id.indexOf("ledger-header-") === 0 ? document.activeElement.id : null;

    el("accounts-ledger").innerHTML = sortedDays.map(function (dayKey) {
      var txsInDay = groups[dayKey];
      var isToday = (dayKey === todayKey);
      var isOpen;
      if (view.expandedDays[dayKey] !== undefined) {
        isOpen = !!view.expandedDays[dayKey];
      } else if (query) {
        isOpen = true;
      } else {
        // H-02: olağan dışı işlem içeren gün varsayılan açık gelir.
        isOpen = isToday || !allDays[todayKey] && dayKey === latestDayKey || txsInDay.some(function (tx) { return attention[tx.id]; });
      }

      var dayTotal = txsInDay.reduce(function (sum, tx) {
        return sum + (tx.postings || []).filter(function (x) { return x.account === "cash"; }).reduce(function (n, x) { return n + x.amount; }, 0);
      }, 0);
      var totalText = (dayTotal > 0 ? "+ " : "") + A.money(dayTotal);
      var flaggedInDay = txsInDay.filter(function (tx) { return attention[tx.id]; }).length;
      var infoInDay = presentation.features.ecosystem ? txsInDay.filter(function (tx) { return ECO_LEDGER[tx.category]; }).length : 0;
      var countText = txsInDay.length + " işlem" + (flaggedInDay ? " · " + flaggedInDay + " dikkat" : "") + (infoInDay ? " · " + infoInDay + " bilgi" : "");
      var titleText = formatDayLabel(dayKey, isToday);

      var itemsHtml = txsInDay.slice().reverse().map(function (tx) {
        var cashAmount = (tx.postings || []).filter(function (x) { return x.account === "cash"; }).reduce(function (n, x) { return n + x.amount; }, 0);
        var amountText = (cashAmount > 0 ? "+ " : "") + A.money(cashAmount);
        var label = tx.kind === "save" ? "Birikim fonuna aktarıldı" : tx.kind === "recover" ? "Birikim fonundan vadesize aktarıldı" : tx.label;
        // SA-03: iç kategori kodu (health, coffee, crypto-platform) kullanıcıya gösterilmez.
        var sub = tx.merchant || guardDate(A.simulationDay(tx.at));
        var ref = tx.ref || tx.id;
        var canTrackRefund = presentation.features.refunds && A.agent.canTrackRefund(tx.ref || tx.id);
        var refundHtml = "";
        if (canTrackRefund) {
          var tracker = s.bank.refundTrackers && s.bank.refundTrackers[ref];
          var isTracking = tracker && tracker.enabled;
          if (isTracking) {
            var statusInfo = A.getRefundTrackerStatus(tracker, s.bank.transactions);
            var badgeCls = statusInfo.status === "completed" ? "status-completed" : statusInfo.status === "partial" ? "status-partial" : "status-pending";
            var descText = statusInfo.status === "completed"
              ? A.money(statusInfo.receivedAmount) + " iadenin tamamı hesabına aktarıldı."
              : statusInfo.status === "partial"
              ? A.money(statusInfo.receivedAmount) + " / " + A.money(tracker.expectedAmount) + " geldi · " + A.money(statusInfo.remainingAmount) + " bekleniyor"
              : "Vadesiz hesabına " + A.money(tracker.expectedAmount) + " iade bekleniyor.";
            refundHtml = '<div class="refund-tracker-card ' + badgeCls + '">' +
              '<div class="refund-tracker-row">' +
                '<span class="refund-badge ' + badgeCls + '">' + A.escape(statusInfo.statusText) + '</span>' +
                '<span class="refund-info">' + A.escape(descText) + '</span>' +
                '<button type="button" class="btn line-dark small pill btn-refund-close" data-refund-ref="' + A.escape(ref) + '">Takibi kapat</button>' +
              '</div>' +
              '<div class="refund-disclaimer">Takibi kapatmak satıcıdaki iade sürecini veya yasal haklarını etkilemez.</div>' +
            '</div>';
          } else if (view.refundFormOpen === ref) {
            var defaultAmtStr = (Math.abs(cashAmount) / 100).toString();
            refundHtml = '<div class="refund-tracker-form">' +
              '<div class="refund-form-head"><strong>İadem geldiğinde haber ver</strong></div>' +
              '<div class="refund-form-field">' +
                '<label for="refund-input-' + A.escape(ref) + '">Beklenen iade tutarı (TL)</label>' +
                '<input type="text" id="refund-input-' + A.escape(ref) + '" class="refund-amount-input" value="' + A.escape(defaultAmtStr) + '" autocomplete="off" />' +
              '</div>' +
              '<p class="refund-disclaimer">İade süresi satıcı ve banka süreçlerine bağlıdır. Kesin geliş tarihi vaat edilmez. Yalnızca vadesiz hesaba gelen iadeler takip edilir.</p>' +
              '<div class="refund-form-actions">' +
                '<button type="button" class="btn primary small pill btn-refund-start" data-refund-ref="' + A.escape(ref) + '">Takibi başlat</button>' +
                '<button type="button" class="btn line-dark small pill btn-refund-cancel" data-refund-ref="' + A.escape(ref) + '">Vazgeç</button>' +
              '</div>' +
            '</div>';
          } else {
            refundHtml = '<div class="refund-tracker-trigger">' +
              '<button type="button" class="btn-refund-track" data-refund-ref="' + A.escape(ref) + '">İadem geldiğinde haber ver</button>' +
            '</div>';
          }
        }
        var eco = presentation.features.ecosystem && !!ECO_LEDGER[tx.category], ecoOpen = eco && !!(view.ecoOpen || {})[tx.id];
        var flag = attention[tx.id], amtClass = cashAmount > 0 ? "is-credit" : (cashAmount < 0 ? "is-debit" + (flag ? " is-attention" : "") : "");
        return '<div class="agent-ledger-row' + (flag ? ' has-attention' : '') + '" data-tx-ref="' + A.escape(ref) + '">' +
          '<b>' + A.escape(label) + '</b>' +
          // Gerekçe varsayılan kapalı; "i" düğmesiyle açılır (bilgi yükünü azaltmak için).
          (flag ? '<span class="ledger-amount-wrap"><span class="' + amtClass + '">' + A.escape(amountText) + '</span><button type="button" class="ledger-info-btn" data-attention-info="' + A.escape(tx.id) + '" aria-expanded="' + !!(view.attentionOpen || {})[tx.id] + '" aria-controls="attention-' + A.escape(tx.id) + '" aria-label="Neden işaretlendi?"><span aria-hidden="true">i</span></button></span>'
            : eco ? '<span class="ledger-amount-wrap"><span class="' + amtClass + '">' + A.escape(amountText) + '</span><button type="button" class="ledger-info-btn is-info" data-eco-info="' + A.escape(tx.id) + '" aria-expanded="' + ecoOpen + '" aria-controls="eco-info-' + A.escape(tx.id) + '" aria-label="' + (eco ? ECO_LEDGER[tx.category].label : "") + '"><span aria-hidden="true">i</span></button></span>'
            : '<span class="' + amtClass + '">' + A.escape(amountText) + '</span>') +
          '<small>' + A.escape(sub) + '</small>' +
          (eco ? ecoLedgerInfoHtml(s, tx, cashAmount) : '') +
          (flag ? '<p class="ledger-attention" id="attention-' + A.escape(tx.id) + '"' + ((view.attentionOpen || {})[tx.id] ? '' : ' hidden') + '>' + A.escape(flag.reason) + '</p>' : '') +
          refundHtml +
          '</div>';
      }).join("");

      return '<div class="ledger-day-group" data-date="' + A.escape(dayKey) + '">' +
        '<h4 class="ledger-day-heading">' +
        '<button type="button" class="ledger-day-header" aria-expanded="' + (isOpen ? 'true' : 'false') + '" aria-controls="ledger-group-' + A.escape(dayKey) + '" data-toggle-day="' + A.escape(dayKey) + '" id="ledger-header-' + A.escape(dayKey) + '">' +
        '<div class="ledger-day-info">' +
        '<span class="ledger-day-title">' + A.escape(titleText) + '</span>' +
        '<span class="ledger-day-count">' + A.escape(countText) + '</span>' +
        '</div>' +
        '<div class="ledger-day-meta">' +
        '<span class="ledger-day-total' + (dayTotal > 0 ? ' is-credit' : (dayTotal < 0 ? ' is-debit' : '')) + (flaggedInDay ? ' is-attention' : '') + '">' + A.escape(totalText) + '</span>' +
        '<span class="ledger-day-chevron" aria-hidden="true">▾</span>' +
        '</div>' +
        '</button>' +
        '</h4>' +
        '<div class="ledger-day-body" id="ledger-group-' + A.escape(dayKey) + '" role="region" aria-labelledby="ledger-header-' + A.escape(dayKey) + '"' + (isOpen ? '' : ' hidden') + '>' +
        itemsHtml +
        '</div>' +
        '</div>';
    }).join("");

    if (activeHeaderId && el(activeHeaderId)) {
      el(activeHeaderId).focus({ preventScroll: true });
    }
  }
  function renderComparisonChartSvg(cmp, prefix, selectedIndex) {
    var W = 340, H = 218, padL = 45, padR = 14, padT = 24, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var hasRef = cmp.refId !== "none" && cmp.finalRef !== null;
    var values = cmp.points.map(function (p) { return p.assetValue; });
    if (hasRef) values = values.concat(cmp.points.map(function (p) { return p.refValue; }));
    var low = Math.min.apply(null, values), high = Math.max.apply(null, values);
    var span = Math.max(high - low, cmp.baseAmount * .05), tickStep = Math.pow(10, Math.floor(Math.log(span / 3) / Math.LN10));
    var stepRatio = span / 3 / tickStep;
    tickStep *= stepRatio <= 1 ? 1 : stepRatio <= 2 ? 2 : stepRatio <= 5 ? 5 : 10;
    var minY = Math.floor((low - span * .08) / tickStep) * tickStep;
    var maxY = Math.ceil((high + span * .08) / tickStep) * tickStep;
    function x(i) { return padL + i / Math.max(1, cmp.points.length - 1) * plotW; }
    function y(v) { return padT + (maxY - v) / (maxY - minY) * plotH; }
    function n(v) { return v.toFixed(2); }
    var bottom = H - padB, parts = [], fills = [], strokes = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" class="comparison-svg" role="group" aria-label="' + A.escape(cmp.assetLabel + ' getiri grafiği. ' + (hasRef ? cmp.refLabel + ' ile karşılaştırma. ' : 'Karşılaştırma kapalı. ') + cmp.statusText) + '">');
    parts.push('<defs>');
    ["above", "below", "neutral"].forEach(function (name) {
      var color = name === "above" ? "#175cd3" : name === "below" ? "#dc6803" : "#777780"; // mavi/turuncu: renk körlüğünde de ayrışır
      parts.push('<linearGradient id="' + prefix + '-area-' + name + '" gradientUnits="userSpaceOnUse" x1="0" y1="' + padT + '" x2="0" y2="' + bottom + '"><stop offset="0" stop-color="' + color + '" stop-opacity=".23"/><stop offset="1" stop-color="' + color + '" stop-opacity=".025"/></linearGradient>');
    });
    parts.push('</defs><text x="' + padL + '" y="12" class="chart-unit-text">TL</text>');
    for (var v = minY; v <= maxY; v += tickStep) {
      parts.push('<line x1="' + padL + '" y1="' + n(y(v)) + '" x2="' + (W - padR) + '" y2="' + n(y(v)) + '" class="chart-grid-line"/>');
      parts.push('<text x="' + (padL - 7) + '" y="' + n(y(v) + 3) + '" text-anchor="end" class="chart-axis-text">' + (v / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + '</text>');
    }
    cmp.points.forEach(function (p, i) {
      parts.push('<text x="' + n(x(i)) + '" y="' + (H - 9) + '" class="chart-axis-text" text-anchor="middle">' + A.escape(p.month) + '</text>');
    });
    function segment(x1, a1, x2, a2, status) {
      var areaStatus = status === "standalone" || status === "equal" ? "neutral" : status;
      fills.push('<path d="M ' + n(x1) + ' ' + n(a1) + ' L ' + n(x2) + ' ' + n(a2) + ' L ' + n(x2) + ' ' + bottom + ' L ' + n(x1) + ' ' + bottom + ' Z" class="chart-area chart-area-' + areaStatus + '" fill="url(#' + prefix + '-area-' + areaStatus + ')"/>');
      strokes.push('<line x1="' + n(x1) + '" y1="' + n(a1) + '" x2="' + n(x2) + '" y2="' + n(a2) + '" class="chart-line-' + status + '"/>');
    }
    for (var i = 0; i < cmp.points.length - 1; i++) {
      var p = cmp.points[i], q = cmp.points[i + 1], d1 = p.assetValue - p.refValue, d2 = q.assetValue - q.refValue;
      if (!hasRef) segment(x(i), y(p.assetValue), x(i + 1), y(q.assetValue), "standalone");
      else if (d1 * d2 < 0) {
        var t = d1 / (d1 - d2), crossX = x(i) + t * (x(i + 1) - x(i)), crossY = y(p.assetValue + t * (q.assetValue - p.assetValue));
        segment(x(i), y(p.assetValue), crossX, crossY, d1 > 0 ? "above" : "below");
        segment(crossX, crossY, x(i + 1), y(q.assetValue), d2 > 0 ? "above" : "below");
      } else segment(x(i), y(p.assetValue), x(i + 1), y(q.assetValue), d1 > 0 || d2 > 0 ? "above" : d1 < 0 || d2 < 0 ? "below" : "equal");
    }
    // Fill first, then the reference and asset: neither curve is obscured by the area.
    parts.push(fills.join(""));
    if (hasRef) parts.push('<path d="' + cmp.points.map(function (p, i) { return (i ? "L " : "M ") + n(x(i)) + ' ' + n(y(p.refValue)); }).join(' ') + '" class="chart-line-reference"/>');
    parts.push(strokes.join(""));
    var selected = cmp.points[selectedIndex];
    if (selected) parts.push('<line x1="' + n(x(selectedIndex)) + '" y1="' + padT + '" x2="' + n(x(selectedIndex)) + '" y2="' + bottom + '" class="chart-selection-line"/>');
    cmp.points.forEach(function (p, i) {
      var status = hasRef ? p.status : "standalone";
      var tip = p.monthLong + ' · ' + cmp.assetLabel + ': ' + A.money(p.assetValue);
      if (hasRef) tip += ' · ' + cmp.refLabel + ': ' + A.money(p.refValue) + ' · ' + (p.diff >= 0 ? '+' : '−') + A.money(Math.abs(p.diff)) + ' fark';
      parts.push('<circle id="' + prefix + '-point-' + i + '" cx="' + n(x(i)) + '" cy="' + n(y(p.assetValue)) + '" r="' + (i === selectedIndex ? 4.5 : 3) + '" class="chart-point-' + status + '"/>');
      parts.push('<circle id="' + prefix + '-hit-' + i + '" cx="' + n(x(i)) + '" cy="' + n(y(p.assetValue)) + '" r="20" class="chart-point-hit" role="button" tabindex="0" aria-pressed="' + (i === selectedIndex) + '" aria-label="' + A.escape(tip) + '" data-comparison-index="' + i + '"><title>' + A.escape(tip) + '</title></circle>');
    });
    parts.push('</svg>');
    return parts.join("");
  }

  function renderAssetComparisonHtml(cmp, prefix) {
    var hasRef = cmp.refId !== "none" && cmp.finalRef !== null;
    var idx = Number.isInteger(view.selectedGoldPoint) ? Math.max(0, Math.min(cmp.points.length - 1, view.selectedGoldPoint)) : cmp.points.length - 1, point = cmp.points[idx];
    var selectId = prefix + "-ref-select";
    var references = A.COMPARISON.references.slice().sort(function (a, b) { return a.id === "inflation" ? -1 : b.id === "inflation" ? 1 : 0; });
    var options = references.map(function (r) { return '<option value="' + r.id + '"' + (r.id === cmp.refId ? ' selected' : '') + '>' + A.escape(r.label) + '</option>'; }).join("");
    var icon = cmp.status === "above" ? "↑" : cmp.status === "below" ? "↓" : "—";
    var gainText = (cmp.finalGainAssetPct > 0 ? "+" : "") + cmp.finalGainAssetPct.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
    var html = [];
    html.push('<div class="comparison-heading"><div><span class="comparison-eyebrow">' + A.escape(cmp.assetLabel) + '</span><strong class="comparison-value">' + A.money(cmp.finalAsset) + '</strong></div><span class="comparison-return">' + gainText + '<small>Dönem getirisi</small></span></div>');
    html.push('<p class="comparison-baseline">10.000 TL başlangıç · Nisan–Ekim 2026 · 6 ay</p><p class="comparison-past">Geçmişi gösterir. Gelecek için tahmin değildir.</p>');
    html.push('<div class="comparison-control-row"><label for="' + selectId + '" class="comparison-label">Neyle karşılaştıralım?</label><select id="' + selectId + '" class="comparison-select" data-prefix="' + prefix + '">' + options + '</select></div>');
    html.push('<p class="comparison-purpose"><strong>' + A.escape(cmp.purposeLabel) + '</strong> ' + A.escape(cmp.comparisonExplanation) + '</p>');
    html.push('<div class="comparison-chart-wrapper">' + renderComparisonChartSvg(cmp, prefix, idx) + '</div>');
    html.push('<div class="comparison-legend">');
    if (hasRef) {
      html.push('<span class="legend-item"><span class="legend-swatch line-above" aria-hidden="true"></span>↑ Referansın üstünde</span><span class="legend-item"><span class="legend-swatch line-below" aria-hidden="true"></span>↓ Referansın altında</span><span class="legend-item"><span class="legend-swatch line-reference" aria-hidden="true"></span>' + A.escape(cmp.refLabel) + '</span>');
    } else html.push('<span class="legend-item"><span class="legend-swatch line-standalone" aria-hidden="true"></span>Altın · Karşılaştırma kapalı</span>');
    html.push('</div>');
    html.push('<div class="comparison-point-readout" role="status" aria-live="polite"><span class="comparison-point-date">' + A.escape(point.monthLong) + '</span>' + rows([[cmp.assetLabel, A.money(point.assetValue)]].concat(hasRef ? [[cmp.refLabel, A.money(point.refValue)], ["Fark", (point.diff > 0 ? "+" : point.diff < 0 ? "−" : "") + A.money(Math.abs(point.diff))]] : [])) + '</div>');
    html.push('<p class="comparison-interaction-hint">Aylık değerler için grafikte bir noktaya dokun.</p>');
    html.push('<div id="' + prefix + '-status-pill" class="comparison-status-pill status-' + cmp.status + '" role="status"><span class="status-icon" aria-hidden="true">' + icon + '</span><span class="status-text">' + A.escape(cmp.statusText) + '</span></div>');
    html.push('<p class="comparison-color-note">' + (cmp.referenceIsInflation ? 'Mavi (↑): satın alma gücünü koruyan seviyenin üstünde. Turuncu (↓): o seviyenin altında.' : hasRef ? 'Mavi (↑) ve turuncu (↓), seçilen referansa göre konumu gösterir. Turuncu tek başına zarar anlamına gelmez.' : 'Referans kapalı. Çizgi ve dolgu nötr gri.') + '</p>');
    if (cmp.disclaimer.fictionalLabel) html.push('<p class="comparison-demo-note">' + A.escape(cmp.disclaimer.fictionalLabel) + '</p>');
    html.push('<details class="comparison-method"><summary>Hesap ve varsayımlar</summary><div class="comparison-metrics-table">');
    html.push('<div class="cmp-metric"><span>Başlangıç (Nisan 2026)</span><strong>10.000 TL</strong></div><div class="cmp-metric"><span>Altın Değeri (Ekim 2026)</span><strong>' + A.money(cmp.finalAsset) + '</strong></div>');
    if (hasRef) html.push('<div class="cmp-metric"><span>' + A.escape(cmp.refLabel) + '</span><strong>' + A.money(cmp.finalRef) + '</strong></div><div class="cmp-metric highlight"><span>Dönem sonu farkı</span><strong class="' + (cmp.finalDiff > 0 ? 'text-above' : cmp.finalDiff < 0 ? 'text-below' : '') + '">' + (cmp.finalDiff > 0 ? '+' : cmp.finalDiff < 0 ? '−' : '') + A.money(Math.abs(cmp.finalDiff)) + '</strong></div>');
    if (cmp.referenceIsInflation) html.push('<div class="cmp-metric"><span>Satın alma gücü değişimi</span><strong>' + (cmp.finalRealReturnPct > 0 ? '+' : '') + cmp.finalRealReturnPct.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + '%</strong></div><div class="cmp-metric"><span>Başlangıç döneminin fiyatlarıyla</span><strong>' + A.money(cmp.finalPurchasingPowerValue) + '</strong></div>');
    html.push('</div>');
    html.push('<p class="comparison-narrative">' + A.escape(cmp.narrative) + '</p><div class="comparison-disclaimer"><p><strong>Dönem:</strong> ' + A.escape(cmp.disclaimer.period) + '</p><p><strong>Masraf ve Vergi Varsayımları:</strong> ' + A.escape(cmp.disclaimer.normalizationNote) + ' ' + A.escape(cmp.disclaimer.assetAssumptions) + ' ' + A.escape(cmp.disclaimer.refAssumptions) + '</p><p>' + (hasRef ? 'Renkler seçilen referansa göre konumu gösterir. Turuncu alan tek başına zarar anlamına gelmez. Getiri oranları arasındaki fark başlangıç tutarına göre yüzde puandır.' : 'Karşılaştırma kapalıyken çizgi ve dolgu nötr gri gösterilir.') + '</p><p class="disclaimer-ethics">' + A.escape(cmp.disclaimer.ethicsNote) + '</p></div></details>');
    return html.join("\n");
  }

  function renderComparisonViews() {
    var focused = document.activeElement, activeId = focused ? focused.id : null;
    var cmp = A.getAssetComparison("gold", view.selectedGoldRef || presentation.defaultReference);
    [{ id: "primary-comparison-view", prefix: "primary-comparison" }, { id: "gold-comparison-view", prefix: "gold-home" }, { id: "detail-gold-comparison-view", prefix: "gold-detail" }, { id: "accounts-gold-comparison-view", prefix: "gold-accounts" }].forEach(function (m) {
      var container = el(m.id);
      if (!container) return;
      var signature = JSON.stringify([cmp, view.selectedGoldPoint]);
      if (container.dataset.signature === signature) return;
      var method = container.querySelector('.comparison-method'), methodOpen = method && method.open;
      container.innerHTML = renderAssetComparisonHtml(cmp, m.prefix);
      if (methodOpen) container.querySelector('.comparison-method').open = true;
      container.dataset.signature = signature;
    });
    if (activeId && el(activeId) && document.activeElement !== el(activeId)) el(activeId).focus({ preventScroll: true });
  }


  function renderSavedTransfers(s) {
    var list = el("saved-transfers-list");
    if (!list) return;
    var transfers = (s.bank && s.bank.savedTransfers) || [];
    var activeOp = s.operations.find(function (op) { return ["pending", "running", "unknown"].includes(op.status); });
    var p = s.plans.transfer;
    var isReviewing = !!p && p.status === "awaiting" && p.kind === "saved-transfer";
    var savedSent = !!p && p.kind === "saved-transfer" && sentNow(p);

    list.innerHTML = transfers.map(function (item) {
      var isSelected = isReviewing && p.savedId === item.id;
      return '<li class="saved-transfer-row' + (isSelected ? ' selected' : '') + '">' +
        '<div class="saved-transfer-info">' +
          '<div class="saved-transfer-name"><strong>' + A.escape(item.label) + '</strong> <span class="saved-transfer-payee">(' + A.escape(item.payee) + ')</span></div>' +
          '<div class="saved-transfer-iban">' + A.escape(item.ibanMask) + ' · ' + A.escape(item.note) + '</div>' +
        '</div>' +
        '<div class="saved-transfer-action">' +
          '<span class="saved-transfer-amount">' + A.money(item.amount) + '</span>' +
          '<button type="button" class="btn line-dark small pill saved-transfer-send-btn" data-saved-transfer="' + A.escape(item.id) + '"' + (activeOp ? ' disabled' : '') + '>Gönder</button>' +
        '</div>' +
      '</li>';
    }).join("");

    var reviewCard = el("saved-transfer-review");
    if (reviewCard) {
      visible("saved-transfer-review", isReviewing || savedSent);
      visible("saved-review-actions", !savedSent); visible("saved-review-note", !savedSent); visible("saved-sent", savedSent);
      el("saved-steps").classList.toggle("done", savedSent && !opWorking(p));
      el("saved-sent").classList.toggle("is-working", savedSent && opWorking(p));
      if (savedSent) text("saved-sent", (opWorking(p) ? "" : "✓ ") + A.money(p.amount));
      if (isReviewing || savedSent) {
        var payeeLabel = p.payeeLabel || "Kayıtlı Alıcı";
        var ibanMask = (p.recipientIban) || "";
        // Gönderim tamamlanınca bakiye zaten düşmüştür; satırlar onay anındaki tabloyu korur.
        var cashBefore = s.balances.cash + (savedSent && p.status === "succeeded" ? p.amount : 0);
        var hasEnough = cashBefore >= p.amount;
        var remainingAfter = cashBefore - p.amount;

        text("saved-review-title", payeeLabel);
        text("saved-review-amount", A.money(p.amount));
        el("saved-review-facts").innerHTML = rows([
          ["Alıcı", payeeLabel],
          ["Alıcı IBAN", ibanMask],
          ["Gönderen hesap", "Vadesiz hesap (" + A.money(cashBefore) + ")"],
          ["Transferden sonra vadesiz", hasEnough ? A.money(remainingAfter) : "Yetersiz bakiye (" + A.money(cashBefore) + ")"]
        ]);
        // 24 Ekim (sahip: "hâlâ çok text"): güvence cümlesi yok; adım noktaları ve onaydan sonraki "Geri al" bildirimi aynı şeyi söyler.
        text("saved-review-note", hasEnough ? "" : "Hesabındaki bakiye bu transfer için yetersiz."); visible("saved-review-note", !hasEnough);
        var approveBtn = el("approve-saved-transfer");
        approveBtn.textContent = A.money(p.amount) + " gönder · onayla";
        approveBtn.disabled = !hasEnough || !!activeOp;
      }
    }
  }

  function initChatMessages() {
    if (!presentation.features.chat && view.chatMode === "expense") return;
    if (!view.chatMessages || !view.chatMessages.length) view.chatMessages = [{ sender: "assistant", text: "Merhaba Deniz. Bugün neye bakalım?", chips: chatTaskChoices(A.agent.getSnapshot()) }];
    else if (view.chatMessages.length === 1) view.chatMessages[0].chips = chatTaskChoices(A.agent.getSnapshot());
  }

  // Aday 15: "Neden bu tutar?" altındaki gider kırılımı sohbeti. Kural tabanlı; metin motorun kendi sayılarından üretilir.
  // 28 Ekim (sahip): ayrı "detay öğren" bağlantısı "Nasıl hesapladım?" ile aynı satıra yapışıyordu. Sohbeti "Ayın kalan giderleri" satırının kendisi açar.
  function withExpenseRow(html, s) {
    if (!presentation.features.expenseChat || s.forecast.horizonExpired) return html;
    return html.replace("<dt>Ayın kalan giderleri</dt>", '<dt><button type="button" class="row-link" id="expense-detail-open" data-expense-detail="open" aria-label="Ayın kalan giderleri · detay öğren"><span class="row-link-label">Ayın kalan giderleri</span><span class="row-link-go" aria-hidden="true">›</span></button></dt>');
  }
  function expenseCategory(s, id) { return s.forecast.breakdown.categories.find(function (x) { return x.id === id; }); }
  function expenseBreakdownText(s) {
    var b = s.forecast.breakdown, lines = ["Ayın kalan giderleri için " + A.money(b.total) + " tahmin ediyorum. Kırılımı şöyle:"];
    b.categories.forEach(function (x) { lines.push("• " + x.label + ": " + A.money(x.amount) + (x.overridden ? " (senin tahminin · benim tahminim " + A.money(x.estimated) + ")" : "")); });
    if (b.adjustment) lines.push("• Ek gider düzeltmesi: " + A.money(b.adjustment));
    b.known.forEach(function (x) { lines.push("• " + x.label + " (" + guardDate(x.due) + "): " + A.money(x.amount)); });
    lines.push("Değişken kalemler son 12 aydaki harcama ortalamandan, bugünkü fiyatlara uyarlanarak ayın kalan günlerine bölündü. Tarihli ödemeler takviminden geliyor.");
    return lines.join("\n");
  }
  function expenseChips(s) {
    var chips = [{ label: "Bir kalemi düzelt", action: "expense-fix" }];
    if (s.forecast.breakdown.categories.some(function (x) { return x.overridden; })) chips.push({ label: "Düzeltmeleri geri al", action: "expense-undo-all" });
    chips.push({ label: "Öneriye dön", action: "expense-back" });
    return chips;
  }
  function openExpenseChat(opener) {
    var s = A.agent.getSnapshot();
    // Jüride genel sohbet yok: geliştirme karşılaması ve görev çipleri gösterilmez.
    if (presentation.features.chat) initChatMessages(); else view.chatMessages = [];
    view.chatMessages.push({ sender: "user", text: "Ayın kalan giderleri nereden geliyor?" });
    view.chatMessages.push({ sender: "assistant", text: expenseBreakdownText(s), chips: expenseChips(s) });
    view.chatReturnFocusId = opener && opener.id || null; view.chatMode = "expense"; view.chatOpen = true;
    A.telemetry.log("expense-detail", { action: "open" });
    render(s); el("chat-close").focus({ preventScroll: true });
  }
  function expenseResultText(before, after, label) {
    return label + " Ayın kalan giderleri " + A.money(after.forecast.expected) + ", birikim önerin " + A.money(after.forecast.available) + " oldu (önceki: " + A.money(before.forecast.available) + "). Para hareket etmedi. Öneriyi uygulamak yine senin onayınla.";
  }
  async function expenseChatAction(action, label) {
    var s = A.agent.getSnapshot();
    if (action === "expense-back") { closeChat(); return; }
    view.chatMessages.push({ sender: "user", text: label });
    if (action === "expense-fix") {
      view.chatMessages.push({ sender: "assistant", text: "Hangi kalemi düzeltelim? Bu yalnız tahmini değiştirir. Hesabındaki para yerinde kalır.", chips: s.forecast.breakdown.categories.map(function (x) { return { label: x.label.replace(/ \(.*\)$/, ""), action: "expense-cat:" + x.id }; }) });
    } else if (action.indexOf("expense-cat:") === 0) {
      var cat = expenseCategory(s, action.slice(12));
      view.chatMessages.push({ sender: "assistant", text: cat.label + " için ayın kalan günlerine tahminim " + A.money(cat.estimated) + (cat.overridden ? "; şu an senin tahminin " + A.money(cat.amount) + " kullanılıyor" : "") + ". Bu ay ne kadar olmasını bekliyorsun?", expenseForm: { category: cat.id, value: String(cat.amount / 100) } });
    } else if (action.indexOf("expense-undo:") === 0 || action === "expense-undo-all") {
      var ids = action === "expense-undo-all" ? s.forecast.breakdown.categories.filter(function (x) { return x.overridden; }).map(function (x) { return x.id; }) : [action.slice(13)];
      for (var i = 0; i < ids.length; i++) await command({ type: "expense-estimate", category: ids[i], amount: null });
      var after = A.agent.getSnapshot();
      view.chatMessages.push({ sender: "assistant", text: expenseResultText(s, after, "Düzeltmeyi geri aldım. Benim tahminim kullanılıyor."), chips: expenseChips(after) });
    }
    renderChat();
  }
  async function submitExpenseForm(idx, raw) {
    var msg = view.chatMessages[idx], s = A.agent.getSnapshot();
    if (!msg || !msg.expenseForm || msg.expenseForm.done) return;
    var cleaned = String(raw).trim().replace(/\s|TL/gi, "").replace(/\.(?=\d{3}(\D|$))/g, ""), amount = A.parseMoney(cleaned), cat = expenseCategory(s, msg.expenseForm.category);
    if (amount === null) { msg.expenseForm.error = "Tutarı rakamla yaz. Örneğin 6000."; container_rerender(); return; }
    var result = await command({ type: "expense-estimate", category: cat.id, amount: amount });
    if (!result.ok) { msg.expenseForm.error = result.reason || "Tahmin güncellenemedi."; container_rerender(); return; }
    msg.expenseForm.done = true; msg.expenseForm.value = String(amount / 100);
    view.chatMessages.push({ sender: "user", text: A.money(amount) });
    var after = A.agent.getSnapshot();
    view.chatMessages.push({ sender: "assistant", text: expenseResultText(s, after, cat.label + " tahminini " + A.money(amount) + " yaptım."), chips: [{ label: "Bu düzeltmeyi geri al", action: "expense-undo:" + cat.id }, { label: "Başka bir kalem", action: "expense-fix" }, { label: "Öneriye dön", action: "expense-back" }] });
    renderChat();
    function container_rerender() { renderChat(); var input = el("expense-edit-amount-" + idx); if (input) input.focus({ preventScroll: true }); }
  }
  function renderChat() {
    var container = el("chat-messages");
    if (!container) return;
    initChatMessages();

    var html = view.chatMessages.map(function (msg, idx) {
      if (msg.sender === "user") {
        return '<div class="chat-msg-row user"><div class="chat-bubble user">' + A.escape(msg.text) + '</div></div>';
      }
      var parts = ['<div class="chat-msg-row assistant"><div class="chat-avatar-mini" aria-hidden="true">A</div><div class="chat-bubble assistant"><p class="chat-msg-text">' + A.escape(msg.text).replace(/\n/g, "<br>") + '</p>'];

      if (msg.chips && msg.chips.length) {
        parts.push('<div class="chat-bubble-chips">' + msg.chips.map(function (c) {
          return '<button type="button" class="chat-action-chip" data-chat-action="' + A.escape(c.action) + '" data-chat-label="' + A.escape(c.label) + '" data-operation-id="' + A.escape(c.operationId || '') + '">' + A.escape(c.label) + '</button>';
        }).join("") + '</div>');
      }

      if (msg.expenseForm && !msg.expenseForm.done) {
        var fid = "expense-edit-amount-" + idx;
        parts.push('<form class="expense-edit-form" data-expense-idx="' + idx + '"><label for="' + fid + '">Yeni tahmin (TL)</label><div class="expense-edit-row"><input type="text" inputmode="decimal" id="' + fid + '" value="' + A.escape(msg.expenseForm.value) + '" autocomplete="off"' + (msg.expenseForm.error ? ' aria-invalid="true" aria-describedby="' + fid + '-error"' : '') + '><button type="submit" class="btn primary small pill">Kaydet</button></div>' +
          (msg.expenseForm.error ? '<p class="expense-edit-error" id="' + fid + '-error" role="alert">' + A.escape(msg.expenseForm.error) + '</p>' : '') + '</form>');
      }
      if (msg.review) {
        var hr = msg.review;
        var isSaved = !!msg.reviewSaved;
        var statusNote = msg.connectNotice || msg.reviewSavedNotice || "";
        parts.push(
          '<div class="chat-review-card" data-review-idx="' + idx + '">' +
            '<div class="chat-review-header"><strong>Temsilci Özeti Taslağı</strong><span class="chat-review-badge">Yerel Taslak</span></div>' +
            '<p class="chat-review-note">Destek görüşmesinde kullanabileceğin taslak. Bilgileri düzenleyebilirsin:</p>' +
            '<div class="chat-review-fields">' +
              '<div class="review-field-group"><label for="chat-rev-q-' + idx + '">1. Sorun ve İstenen Yardım</label><input type="text" id="chat-rev-q-' + idx + '" class="review-input chat-rev-q" value="' + A.escape(hr.question || "") + '"></div>' +
              '<div class="review-field-group"><label for="chat-rev-op-' + idx + '">2. İlgili İşlem / Tutar</label><input type="text" id="chat-rev-op-' + idx + '" class="review-input chat-rev-op" value="' + A.escape(hr.operation || "") + '"></div>' +
              '<div class="review-field-group"><label for="chat-rev-ver-' + idx + '">3. Kesin Doğrulanmış Durum</label><textarea id="chat-rev-ver-' + idx + '" class="review-textarea chat-rev-ver" rows="2">' + A.escape(hr.verifiedStatus || "") + '</textarea></div>' +
              '<div class="review-field-group"><label for="chat-rev-unc-' + idx + '">4. Yapılan Kontroller ve Belirsizlik</label><textarea id="chat-rev-unc-' + idx + '" class="review-textarea chat-rev-unc" rows="2">' + A.escape(hr.uncertainty || "") + '</textarea></div>' +
              '<div class="review-field-group"><label for="chat-rev-sum-' + idx + '">Temsilciye Hazır Özet (Düzenlenebilir)</label><textarea id="chat-rev-sum-' + idx + '" class="review-summary-box chat-rev-sum" rows="3"' + (hr.userEdited ? ' data-user-edited="true"' : '') + '>' + A.escape(hr.summaryText || "") + '</textarea></div>' +
            '</div>' +
            '<div class="chat-review-actions">' +
              '<button type="button" class="btn primary small pill btn-chat-save-review" data-review-idx="' + idx + '">' + (isSaved ? "Kaydedildi ✓" : "Özet Taslağını Kaydet") + '</button>' +
              '<button type="button" class="btn line-dark small pill btn-chat-connect-human" data-review-idx="' + idx + '">Temsilciye aktar</button>' +
            '</div>' +
            '<div class="chat-review-status-box" id="chat-rev-status-' + idx + '" role="status" aria-live="polite"' + (statusNote ? '' : ' hidden') + '>' + A.escape(statusNote) + '</div>' +
          '</div>'
        );
      }

      parts.push('</div></div>');
      return parts.join("");
    }).join("");

    // Background bank updates must not rebuild unchanged editable chat drafts.
    if (container._renderedChat === html) return;
    var focused = document.activeElement, focusState = null, oldScroll = container.scrollTop;
    if (focused && container.contains(focused) && focused.id) {
      focusState = { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection };
    }
    container.innerHTML = html;
    container._renderedChat = html;
    container.scrollTop = focusState ? oldScroll : container.scrollHeight;
    if (focusState) {
      var restored = el(focusState.id);
      if (restored) {
        restored.focus({ preventScroll: true });
        if (typeof restored.setSelectionRange === "function" && focusState.start !== null) restored.setSelectionRange(focusState.start, focusState.end, focusState.direction || "none");
      }
    }

    container.querySelectorAll(".chat-action-chip").forEach(function (btn) {
      btn.onclick = function () {
        var action = btn.dataset.chatAction;
        var label = btn.dataset.chatLabel || btn.textContent;
        if (action.indexOf("expense-") === 0) {
          expenseChatAction(action, label);
        } else if (action === "review-yes") {
          handleChatInput("Sorun özeti hazırla", btn.dataset.operationId);
        } else if (action === "review-no") {
          handleChatInput("Şimdi değil");
        } else if (action === "reconcile") {
          handleChatInput("İşlemin sonucunu kontrol et", btn.dataset.operationId);
        } else if (action === "open-payments") {
          openOffer(1, true);
        } else if (action === "open-savings" || action === "open-bes" || action === "open-gold") {
          var cardIndex = action === "open-bes" ? 2 : action === "open-gold" ? 3 : 0;
          go("savings", cardIndex);
          document.querySelector('[data-open="' + cardIndex + '"]').focus({ preventScroll: true });
        } else if (action === "open-transfers" || action === "open-accounts") {
          go(action === "open-transfers" && presentation.allowsPage("transfer") ? "transfer" : "accounts");
          el("screen-title").focus({ preventScroll: true });
        } else if (action === "say-operation") {
          handleChatInput("İşlemim ne durumda?", btn.dataset.operationId);
        } else {
          handleChatInput(label);
        }
      };
    });

    container.querySelectorAll(".expense-edit-form").forEach(function (form) {
      form.onsubmit = function (e) { e.preventDefault(); var idx = Number(form.dataset.expenseIdx); submitExpenseForm(idx, el("expense-edit-amount-" + idx).value); };
    });

    container.querySelectorAll(".btn-chat-save-review").forEach(function (btn) {
      btn.onclick = async function () {
        var idx = btn.dataset.reviewIdx;
        var card = container.querySelector('.chat-review-card[data-review-idx="' + idx + '"]');
        if (!card) return;
        var qVal = card.querySelector(".chat-rev-q") ? card.querySelector(".chat-rev-q").value : "";
        var opVal = card.querySelector(".chat-rev-op") ? card.querySelector(".chat-rev-op").value : "";
        var verVal = card.querySelector(".chat-rev-ver") ? card.querySelector(".chat-rev-ver").value : "";
        var uncVal = card.querySelector(".chat-rev-unc") ? card.querySelector(".chat-rev-unc").value : "";
        var sumVal = card.querySelector(".chat-rev-sum") ? card.querySelector(".chat-rev-sum").value : "";
        var msg = view.chatMessages[idx];
        if (msg && msg.review) {
          msg.review.question = qVal;
          msg.review.operation = opVal;
          msg.review.verifiedStatus = verVal;
          msg.review.uncertainty = uncVal;
          msg.review.summaryText = sumVal;

        }
        if (msg.reviewSaving) return;
        msg.reviewSaving = true;
        var generation = A.agent.getSnapshot().generation;
        var result = await command({
          type: "human-review",
          taskId: msg.reviewTaskId || view.chatReviewTaskId || "transfer",
          question: qVal,
          operation: opVal,
          verifiedStatus: verVal,
          uncertainty: uncVal,
          summaryText: sumVal,
          editedByUser: true
        });
        if (generation !== A.agent.getSnapshot().generation) return;
        msg.reviewSaving = false;
        msg.reviewSaved = !!result.ok;
        msg.reviewSavedNotice = result.ok ? "İnceleme taslağın hazırlandı." : (result.reason || "Taslak kaydedilemedi.");
        renderChat();
      };
    });

    container.querySelectorAll(".btn-chat-connect-human").forEach(function (btn) {
      btn.onclick = function () {
        var idx = btn.dataset.reviewIdx;
        var card = container.querySelector('.chat-review-card[data-review-idx="' + idx + '"]');
        if (!card) return;
        var msg = view.chatMessages[idx];
        if (msg) {
          msg.connectNotice = "Özet bu ekranda hazır. Temsilciyle görüşürken kullanabilirsin.";
        }
        var statusBox = card.querySelector(".chat-review-status-box");
        if (statusBox) {
          statusBox.textContent = "Özet bu ekranda hazır. Temsilciyle görüşürken kullanabilirsin.";
          statusBox.hidden = false;
        }
      };
    });

    container.querySelectorAll(".chat-review-card").forEach(function (card) {
      var idx = card.dataset.reviewIdx;
      var msg = view.chatMessages[idx];
      var q = card.querySelector(".chat-rev-q");
      var op = card.querySelector(".chat-rev-op");
      var ver = card.querySelector(".chat-rev-ver");
      var unc = card.querySelector(".chat-rev-unc");
      var sum = card.querySelector(".chat-rev-sum");
      if (!sum) return;
      var sync = function () {
        if (sum.dataset.userEdited === "true") return;
        var parts = [];
        if (op && op.value.trim()) parts.push(op.value.trim() + " için onay verdim.");
        if (ver && ver.value.trim()) parts.push(ver.value.trim());
        if (unc && unc.value.trim()) parts.push(unc.value.trim());
        if (q && q.value.trim()) parts.push(q.value.trim());
        sum.value = parts.join(" ");
        if (msg && msg.review) msg.review.summaryText = sum.value;
      };
      [q, op, ver, unc].forEach(function (inp) {
        if (inp) {
          inp.addEventListener("input", function () {
            if (msg && msg.review) {
              if (inp === q) msg.review.question = inp.value;
              if (inp === op) msg.review.operation = inp.value;
              if (inp === ver) msg.review.verifiedStatus = inp.value;
              if (inp === unc) msg.review.uncertainty = inp.value;
            }
            if (msg && msg.review) { msg.reviewSaved = false; msg.reviewSavedNotice = ""; }
            var save = card.querySelector(".btn-chat-save-review"); if (save) save.textContent = "Özet Taslağını Kaydet";
            var status = card.querySelector(".chat-review-status-box"); if (status) status.hidden = true;
            sync();
          });
        }
      });
      sum.addEventListener("input", function () {
        sum.dataset.userEdited = "true";
        if (msg && msg.review) {
          msg.review.summaryText = sum.value;
          msg.review.userEdited = true; msg.reviewSaved = false; msg.reviewSavedNotice = "";
          var save = card.querySelector(".btn-chat-save-review"); if (save) save.textContent = "Özet Taslağını Kaydet";
          var status = card.querySelector(".chat-review-status-box"); if (status) status.hidden = true;
        }
      });
    });
  }

  function chatOperation(s, operationId) {
    if (operationId) return s.operations.find(function (o) { return o.id === operationId; });
    var ops = s.operations.slice().reverse();
    return ops.find(function (o) { return o.status === "unknown"; }) ||
      ops.find(function (o) { return ["pending", "running"].includes(o.status); }) || ops[0];
  }
  function chatOperationText(op) {
    if (!op) return "Henüz bir transfer işlemi başlatılmadı. Kayıtlı İşlemler bölümünden başlayabilirsin.";
    var receipt = op.receipt || {}, amount = A.money(op.amount), label;
    if (op.kind === "saved-transfer") label = amount + " transfer · " + (receipt.payee || op.payeeLabel || "Kayıtlı alıcı");
    else if (op.kind === "payee-transfer") label = amount + " transfer · " + (receipt.payee || op.payeeLabel || "Yeni alıcı");
    else if (TRIAL_KINDS.includes(op.kind)) label = "Ücretsiz deneme kararın";
    else if (op.kind === "save") label = amount + " birikim hesabına aktarım";
    else if (op.kind === "recover") label = amount + " vadesiz hesabına aktarım";
    else if (op.kind === "gold-buy") label = amount + " altın alımı";
    else if (op.kind === "bes-change") label = amount + " BES katkı değişikliği";
    else label = amount + " işlem";
    if (op.status === "unknown") return label + " için sonuç henüz doğrulanamadı. Yeniden göndermeden mevcut işlemi sorgulayabiliriz.";
    if (op.status === "pending") return label + " gönderim için bekliyor. Gönderilmeden önce Geri al seçeneğini kullanabilirsin.";
    if (op.status === "running") return label + " işleniyor. Sonuç doğrulaması bekleniyor.";
    if (op.status === "succeeded" && receipt.verified === true) return label + " tamamlandı ve işlem kaydından doğrulandı. Referans: " + receipt.reference + ".";
    if (op.status === "failed") return label + " gerçekleşmedi. " + (op.reason || "Mevcut işlem kaydı kontrol edildi.");
    if (op.status === "cancelled") return label + " gönderilmeden iptal edildi.";
    return label + " için doğrulanmış sonuç bulunmuyor.";
  }
  function chatTaskChoices(s) {
    var op = chatOperation(s), choices = [
      { label: "Bu ay ne kadar ayırabilirim?", action: "say-savings" },
      { label: "Yaklaşan ödemelerim", action: "say-payments" }
    ];
    if (op && op.status === "unknown") choices.unshift({ label: "İşlemin sonucunu kontrol et", action: "reconcile", operationId: op.id });
    else if (op) choices.push({ label: ["saved-transfer", "payee-transfer", "save", "recover"].includes(op.kind) ? "Transferim ne durumda?" : "İşlemim ne durumda?", action: "say-operation", operationId: op.id });
    else choices.push({ label: "Kayıtlı transferlerim", action: "open-transfers" });
    return choices;
  }
  function chatResultReply(op) {
    var reply = { sender: "assistant", text: chatOperationText(op) };
    if (op && op.status === "unknown") reply.chips = [{ label: "İşlemin sonucunu kontrol et", action: "reconcile", operationId: op.id }];
    else if (op && op.status === "failed") reply.chips = [{ label: "Destek için özet hazırla", action: "review-yes", operationId: op.id }];
    else if (!op) reply.chips = [{ label: "Kayıtlı transferlerimi aç", action: "open-transfers" }];
    return reply;
  }
  async function handleChatInput(userText, operationId) {
    if (!userText || !userText.trim()) return;
    initChatMessages();
    view.chatMessages.push({ sender: "user", text: userText.trim() });
    var t = userText.trim().toLocaleLowerCase("tr-TR"), s = A.agent.getSnapshot();
    var pendingReview = view.chatPendingReview;
    var isDecline = t === "hayır" || t === "şimdi değil" || t.includes("istemiyorum") || t.includes("doğrudan aktar");
    var explicitSummary = /(?:sorun|destek|temsilci)\s+(?:için\s+)?özet/.test(t) || /özet.*(?:hazırla|isterim)/.test(t);
    var consent = pendingReview && /^(?:evet|olur|tamam)[\s.!]*$/.test(t);
    var isQuery = t.includes("sonucu kontrol") || t.includes("sonucunu kontrol") || t.includes("sonucu sorgula");
    view.chatPendingReview = null;
    if (isQuery && !isDecline) {
      var op = chatOperation(s, operationId);
      if (op && op.status === "unknown" && !op.reconciling && !view.chatQueryOperationId) {
        var generation = s.generation;
        view.chatQueryOperationId = op.id;
        view.chatMessages.push({ sender: "assistant", text: "İşlem kaydını kontrol ediyorum." });
        renderChat();
        await command({ type: "reconcile", operationId: op.id, taskId: op.taskId });
        if (generation !== A.agent.getSnapshot().generation) return;
        view.chatQueryOperationId = null;
        view.chatMessages.push(chatResultReply(chatOperation(A.agent.getSnapshot(), op.id)));
      } else view.chatMessages.push(op && op.reconciling ? { sender: "assistant", text: "İşlemin durum sorgusu devam ediyor." } : chatResultReply(op));
    } else if (isDecline) {
      view.chatMessages.push({ sender: "assistant", text: pendingReview || explicitSummary || t.includes("özet") ? "Özet hazırlamadım." : "Tamam. İstersen başka bir konuya bakalım.", chips: chatTaskChoices(s) });
    } else if (explicitSummary || consent) {
      var requestedId = operationId || (consent && pendingReview.operationId);
      var activeOp = chatOperation(s, requestedId), tId = (activeOp && activeOp.taskId) || activeId() || "savings";
      var draft = A.agent.buildHumanReviewSummary(tId);
      if (activeOp && draft.operationId !== activeOp.id) {
        view.chatMessages.push({ sender: "assistant", text: "Bu konuya ait daha yeni bir işlem var. Özeti hazırlamadan önce güncel işlem durumuna bakalım.", chips: [{ label: "Güncel işlem durumunu gör", action: "say-operation" }] });
      } else {
        view.chatReviewTaskId = tId;
        var existing = view.chatMessages.slice().reverse().find(function (msg) { return msg.review && msg.reviewTaskId === tId && msg.reviewOperationId === (activeOp && activeOp.id || null); });
        if (existing) view.chatMessages.push({ sender: "assistant", text: "Yukarıdaki özeti düzenleyebilir veya kaydedebilirsin. Taslağın korundu." });
        else view.chatMessages.push({ sender: "assistant", text: "Destek için özet taslağın hazır. Bilgileri düzenleyip kaydedebilirsin.", review: draft, reviewTaskId: tId, reviewOperationId: activeOp && activeOp.id || null });
      }
    } else if (t.includes("insan") || t.includes("temsilci") || t.includes("yetkili") || t.includes("müşteri hizmet") || t.includes("canlı destek") || t.includes("bağlan")) {
      var supportOp = chatOperation(s);
      view.chatPendingReview = { operationId: supportOp && supportOp.id || null };
      view.chatMessages.push({ sender: "assistant", text: "İnsan desteği için özet hazırlaman gerekmez. İstersen görüşmede kullanabileceğin bir sorun özeti hazırlayabilirim.", chips: [
        { label: "Sorun özeti hazırla", action: "review-yes", operationId: supportOp && supportOp.id || "" },
        { label: "Şimdi değil", action: "review-no" }
      ] });
    } else if (t.includes("ödeme") || t.includes("fatura") || t.includes("abonelik")) {
      var today = A.simulationDay(s.now);
      var payments = s.bank.payments.filter(function (p) { return p.status === "pending" && p.due >= today; }).slice().sort(function (a,b) { return a.due.localeCompare(b.due); });
      var dueText = payments.slice(0,3).map(function (p) {
        var order = s.bank.automaticPaymentOrders.find(function (o) { return o.id === p.orderId; });
        return (order ? order.label : p.label || "Planlı ödeme") + " · " + A.money(p.amount) + " · " + new Date(p.due + "T12:00:00+03:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", timeZone: "Europe/Istanbul" });
      });
      view.chatMessages.push({ sender: "assistant", text: dueText.length ? "Bilinen sıradaki ödemelerin:\n" + dueText.join("\n") + "\nHenüz tutarı belli olmayan faturalar bu listede yer almıyor." : "Şu an bilinen bir gelecek ödeme kaydı bulunmuyor.", chips: [{ label: "Tüm otomatik ödemelerimi gör", action: "open-payments" }] });
    } else if (t.includes("transfer") || t.includes("gönder") || t.includes("para gitti") || t.includes("annem") || t.includes("işlemim") || t.includes("işlem durumu")) {
      view.chatMessages.push(chatResultReply(chatOperation(s, operationId)));
    } else if (t.includes("bes")) {
      view.chatMessages.push({ sender: "assistant", text: "Mevcut aylık BES katkın " + A.money(s.bank.bes.monthly) + ". Katkı planında tutarı inceleyebilir ve değiştirebilirsin. Değişiklik ayrıca onayını gerektirir.", chips: [{ label: "BES katkı planımı gör", action: "open-bes" }] });
    } else if (t.includes("altın")) {
      view.chatMessages.push({ sender: "assistant", text: "Altın kartında getiri karşılaştırmasına bakabilir, bütçeni ve takip edeceğin fiyat farkını seçebilirsin. Takip başlatmak alım yapmaz. Alım için ayrıca onayını isterim.", chips: [{ label: "Altın kartını gör", action: "open-gold" }] });
    } else if (t.includes("birikim") || t.includes("biriktir") || t.includes("ayır") || t.includes("tasarruf")) {
      var budgetText = s.forecast.shortfall > 0 ? "Beklenen giderlerin ve güvenlik payın için " + A.money(s.forecast.shortfall) + " eksik görünüyor. Önce bu açığı nasıl karşılayacağına bakalım." : "Bu ay beklenen giderlerin ve " + A.money(s.forecast.buffer) + " güvenlik payından sonra yaklaşık " + A.money(s.forecast.available) + " ayırabilirsin. Tutarı sen değiştirebilirsin.";
      view.chatMessages.push({ sender: "assistant", text: budgetText, chips: [{ label: "Birikim önerisini gör", action: "open-savings" }] });
    } else if (t.includes("bakiye") || t.includes("hesap") || t.includes("param") || t.includes("kalan")) {
      view.chatMessages.push({ sender: "assistant", text: "Vadesiz hesabında " + A.money(s.balances.cash) + " bulunuyor. Bu ay beklenen giderlerin yaklaşık " + A.money(s.forecast.expected) + ".", chips: [{ label: "Hesaplarımı gör", action: "open-accounts" }] });
    } else {
      view.chatMessages.push({ sender: "assistant", text: "Bu isteği henüz anlayamadım. Birikim, ödemeler veya işlem durumundan hangisine bakalım?", chips: chatTaskChoices(s) });
    }
    renderChat();
  }

  function closeChat() {
    view.chatOpen = false;
    render(A.agent.getSnapshot());
    var opener = view.chatReturnFocusId && el(view.chatReturnFocusId);
    if (opener) opener.focus({ preventScroll: true });
  }

  function applyPresentation() {
    var dev = presentation.development;
    ["open-assistant-chat", "home-chat-banner", "floating-chat-trigger", "home-saved-transfer", "help-disclosure", "accounts-gold-comparison-disclosure"].forEach(function (id) { visible(id, dev); });
    // ia-1: kayıtlı işlemler "Para gönder" sayfasının parçası; sayfa yalnız jüri ve geliştirmede açılır.
    visible("saved-transfers-section", presentation.allowsPage("transfer"));
    if (!dev) {
      ["refund-notice", "transfer-notice-review", "transfer-review-preview", "transfer-notice-share", "transfer-share-preview", "effects-savings", "journey-details"].forEach(function (id) { visible(id, false); });
    }
    document.querySelector(".agent-indicators").hidden = !dev;
    document.querySelector(".agent-carousel-nav").hidden = !dev;
    el("carousel").setAttribute("aria-label", dev ? "Asistan önerileri" : "Birikim önerisi");
    if (dev) el("carousel").setAttribute("aria-roledescription", "karusel");
    else el("carousel").removeAttribute("aria-roledescription");
    visible("technical-controls", dev);
    document.querySelectorAll("[data-event]").forEach(function (b) {
      var guardEvent = A.EVENTS.some(function (e) { return e.id === b.dataset.event && e.guard; });
      b.hidden = guardEvent ? !presentation.features.guards : !dev && b.dataset.event !== "expense";
    });
    document.querySelector(".agent-preset-row").hidden = !dev;
    document.querySelector('label[for="demo-preset"]').hidden = !dev;
    visible("preset-note", dev);
    if (!dev) {
      text("story-title", view.page === "comparison" ? "Sinaptikşı bir referansla anlamlandır." : "Birikim, günlük hayatına uyum sağlasın.");
      text("story-copy", view.page === "comparison" ? "Altın örneğini aynı başlangıç tutarı ve dönemde enflasyon veya başka bir referansla karşılaştır. Grafik hesaplarındaki paradan bağımsızdır." : "Ödemelerinden ve güvenlik payından sonra ne kadar ayırabileceğini gör. Tutarı değiştir, etkisine bak ve kararını ver. Yeni bir gider olursa öneri yeniden hesaplanır.");
      el("story-steps").innerHTML = (view.page === "comparison" ? ["Referansı seç veya kapat.", "Aylık noktaların değerine bak.", "Nominal artış ile satın alma gücünü ayırt et."] : ["Tutarı ve bütçe etkisini gör.", "İstersen nedenine bak, tutarı değiştir.", "Son ekranda onayla. Koşullar değişince yeniden değerlendir."]).map(function (step) { return "<li>" + A.escape(step) + "</li>"; }).join("");
    }
  }

  // Aday 3: önümüzdeki 30 gün, her zaman görünen nakit akışı. Tek seri (gün sonu vadesiz bakiyesi) + güvenlik payı eşiği.
  // Kontrollü dönem dışındaki günler çizilmez. Dokunma/fare/ok tuşlarıyla gün seçilir; "Gün gün" listesi tablo görünümüdür.
  function cashflowPoints(s) { return s.cashflow.days.filter(function (d) { return !d.beyondHorizon && d.balance !== null; }); }
  function compactTl(kurus) { var tl = kurus / 100; return Math.abs(tl) >= 1000 ? (Math.round(tl / 100) / 10).toLocaleString("tr-TR") + " bin" : String(Math.round(tl)); }
  function cashflowReadout(s, d) {
    if (!d) return "Bir güne dokun. Gün sonu bakiyesini ve o günün ödemelerini gösteririm.";
    var flows = d.flows.map(function (f) { return (f.kind === "in" ? "+ " : "− ") + A.money(f.amount) + " " + f.label; }).join(" · ");
    return guardDate(d.date) + " · gün sonu " + A.money(d.balance) + (flows ? " · " + flows : " · yalnız günlük harcama") + (d.balance < s.cashflow.buffer ? " · güvenlik payının altında" : "");
  }
  // Görev 07 (16 Ekim, sahip): aynı grafik Hesaplarım'da etkileşimli, Ana sayfa uyarısının içinde sade çizilir.
  // En düşük gün, güvenlik payı altındaysa doğrudan etiketlenir (dataviz: uç değer etiketi).
  function cashflowChartSvg(s, interactive) {
    var cf = s.cashflow, pts = cashflowPoints(s);
    if (!pts.length) return "";
    var W = 320, H = 150, L = 44, R = 12, T = 12, B = 22, buffer = cf.buffer;
    var vals = pts.map(function (d) { return d.balance; }).concat([buffer, cf.days[0] ? pts[0].balance : 0]);
    var hi = Math.max.apply(null, vals), lo = Math.min(0, Math.min.apply(null, vals));
    var step = Math.pow(10, Math.floor(Math.log10(Math.max(1, hi - lo) / 2))) , top = Math.ceil(hi / step) * step || step;
    var x = function (i) { return L + (pts.length === 1 ? 0 : i * (W - L - R) / (pts.length - 1)); }, y = function (v) { return T + (top - v) / (top - lo) * (H - T - B); };
    var line = pts.map(function (d, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(d.balance).toFixed(1); }).join(" ");
    var area = line + " L" + x(pts.length - 1).toFixed(1) + " " + y(lo).toFixed(1) + " L" + x(0).toFixed(1) + " " + y(lo).toFixed(1) + " Z";
    var ticks = [lo, (lo + top) / 2, top].map(function (v) { return '<line class="cf-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="cf-tick" x="' + (L - 6) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end">' + compactTl(v) + '</text>'; }).join("");
    // 18 Ekim: ilk gün "Bugün" yazar; tarihli ödemeler noktanın üstünde kısa etiketle görünür (dokunmadan okunur).
    var xl = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].map(function (i, k) { return '<text class="cf-tick' + (k === 0 ? ' cf-today' : '') + '" x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (k === 0 ? "start" : k === 2 ? "end" : "middle") + '">' + A.escape(k === 0 ? "Bugün" : guardDate(pts[i].date)) + '</text>'; }).join("");
    var marks = pts.map(function (d, i) { var low = d.balance < buffer; return (d.flows.length || low) ? '<circle class="cf-dot' + (low ? ' is-low' : '') + '" cx="' + x(i).toFixed(1) + '" cy="' + y(d.balance).toFixed(1) + '" r="4"/>' : ''; }).join("");
    var minI = -1; pts.forEach(function (d, i) { if (d.date === cf.minDay) minI = i; });
    var shortLabel = function (f) { var l = String(f.label).replace(/\s*\(.*\)$/, "").replace(/ (katkı payı|aboneliği|ekstresi|ödemesi)$/i, "").replace(/^Şirket /, ""); l = l.charAt(0).toLocaleUpperCase("tr-TR") + l.slice(1); return (l.length > 14 ? l.split(" ")[0] : l) + " " + (f.kind === "in" ? "+" : "−") + compactTl(f.amount); };
    // Düşük gündeki ödeme ayrı etiket yerine kırmızı etikette söylenir (dik çizginin üstüne binmesin); yer varsa sola, payın altına yazılır.
    var minFlow = minI >= 0 ? pts[minI].flows.filter(function (f) { return f.kind === "out"; })[0] : null;
    // 18 Ekim (C3 provası): ay sonundaki düşük gün etiketi çizginin üstüne biniyordu. Sırayla aday konumlar denenir; çizgiye, kırmızı pay çizgisine
    // ve onun etiketine değmeyen ilk konum seçilir; hiçbiri boş değilse sağ üst köşe (orada çizgi yok) kullanılır.
    var minText = minI >= 0 ? (minFlow ? shortLabel(minFlow) : guardDate(pts[minI].date)) + " · " + A.money(pts[minI].balance) : "", minLabel = "";
    if (cf.deficit > 0 && minI >= 0) {
      var mx = x(minI), my = y(pts[minI].balance), tw = minText.length * 5.3, by = y(buffer), bufW = ("Güvenlik payı " + A.money(buffer)).length * 4.8;
      var clear = function (x0, x1, yb) {
        var y0 = yb - 9, y1 = yb + 2;
        if (x0 < L || x1 > W - R || y0 < T || y1 > H - B) return false;
        if (by >= y0 - 2 && by <= y1 + 2) return false;
        if (x0 < L + 4 + bufW && by - 13 < y1 && by - 2 > y0) return false;
        return !pts.some(function (d, k) { var px = x(k), py = y(d.balance); return px >= x0 - 3 && px <= x1 + 3 && py >= y0 - 4 && py <= y1 + 4; });
      };
      var spots = [[mx - 8 - tw, mx - 8, my + 16, "end"], [mx + 8, mx + 8 + tw, my + 16, "start"], [mx - 8 - tw, mx - 8, my - 8, "end"], [mx + 8, mx + 8 + tw, my - 8, "start"]];
      var spot = spots.filter(function (c) { return clear(c[0], c[1], c[2]); })[0] || [W - R - tw, W - R, T + 10, "end"];
      minLabel = '<text class="cf-min-label" x="' + (spot[3] === "end" ? spot[1] : spot[0]).toFixed(1) + '" y="' + spot[2].toFixed(1) + '" text-anchor="' + spot[3] + '">' + A.escape(minText) + '</text>';
    }
    var events = pts.map(function (d, i) {
      if (!d.flows.length || (minLabel && i === minI && minFlow)) return "";
      var ex = Math.max(L + 24, Math.min(W - R - 24, x(i)));
      return '<text class="cf-event-label" x="' + ex.toFixed(1) + '" y="' + Math.max(T + 8, y(d.balance) - 9).toFixed(1) + '" text-anchor="middle">' + A.escape(shortLabel(d.flows[0])) + '</text>';
    }).join("");
    var sel = interactive && Number.isInteger(view.cfIndex) && pts[view.cfIndex] ? view.cfIndex : null;
    var cross = sel === null ? '' : '<line class="cf-cross" x1="' + x(sel).toFixed(1) + '" x2="' + x(sel).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/><circle class="cf-dot is-selected" cx="' + x(sel).toFixed(1) + '" cy="' + y(pts[sel].balance).toFixed(1) + '" r="5"/>';
    var last = pts[pts.length - 1];
    var label = "Gün sonu vadesiz bakiyesi, " + guardDate(pts[0].date) + " – " + guardDate(last.date) + (cf.deficit > 0 ? ". En düşük: " + guardDate(cf.minDay) + ", " + A.money(cf.minBalance) + ", güvenlik payı " + A.money(buffer) + "." : ".") + (interactive ? " Ok tuşlarıyla gün seç." : "");
    return '<svg class="cf-chart' + (interactive ? '' : ' cf-chart-static') + '"' + (interactive ? ' data-cf-chart tabindex="0" data-cf-left="' + L + '" data-cf-right="' + R + '" data-cf-count="' + pts.length + '"' : '') + ' viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + A.escape(label) + '">' +
        ticks + '<path class="cf-area" d="' + area + '"/>' +
        '<line class="cf-buffer" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(buffer).toFixed(1) + '" y2="' + y(buffer).toFixed(1) + '"/><text class="cf-buffer-label" x="' + (L + 4) + '" y="' + (y(buffer) - 4).toFixed(1) + '" text-anchor="start">Güvenlik payı ' + A.escape(A.money(buffer)) + '</text>' +
        '<path class="cf-line" d="' + line + '"/>' + marks + events + minLabel + cross + xl + '</svg>';
  }
  function cashflowCardHtml(s) {
    var cf = s.cashflow, pts = cashflowPoints(s);
    if (!pts.length) return '<p class="eyebrow">Ay sonuna kadar · vadesiz hesabın</p><h3 id="cashflow-30-title">Bu dönem için tahmin yok</h3><p class="agent-muted">Yeni dönem verisi gelince günlük akışı gösteririm.</p>';
    var buffer = cf.buffer, sel = Number.isInteger(view.cfIndex) && pts[view.cfIndex] ? view.cfIndex : null;
    var last = pts[pts.length - 1], fragile = cf.deficit > 0;
    var status = fragile ? guardDate(cf.minDay) + '’de güvenlik payının ' + A.money(cf.deficit) + ' altına inebilir' : 'Hesabın güvenlik payının (' + A.money(buffer) + ') altına inmiyor';
    // 18 Ekim (16 Ekim görüşmeleri): katılımcı grafikten "günde ne kadar harcayabilirim"i kendisi hesaplamaya çalıştı; cevap başlıkta.
    var allow = cf.dailyAllowance >= 100000 ? Math.floor(cf.dailyAllowance / 5000) * 5000 : Math.floor(cf.dailyAllowance / 1000) * 1000, avg = Math.round(cf.dailyVariable / 100) * 100;
    var dated = pts.reduce(function (acc, d) { return acc.concat(d.flows.filter(function (f) { return f.kind === "out"; })); }, []);
    var headline = fragile ? status : "Günde yaklaşık " + A.money(allow) + " harcayabilirsin";
    var calm = Math.floor(cf.dailyAllowance / 5000) * 5000;
    var sub = fragile ? (calm > 0 ? "Payın üstünde kalmak için " + guardDate(cf.minDay) + "’e kadar günde yaklaşık " + A.money(calm) + "'nin altında harca." : "")
      : guardDate(last.date) + "’e kadar böyle gidersen ay sonunda güvenlik payın (" + A.money(buffer) + ") kalır.";
    var list = pts.filter(function (d) { return d.flows.length || d.date === cf.minDay || d === last; }).map(function (d) {
      return '<li class="' + (d.balance < buffer ? "is-fragile" : "") + '"><span>' + guardDate(d.date) + '</span><span>' + A.escape(d.flows.map(function (f) { return (f.kind === "in" ? "+ " : "− ") + A.money(f.amount) + " " + f.label; }).join(" · ") || "Günlük harcama") + '</span><b>' + A.money(d.balance) + '</b></li>';
    }).join("");
    return '<p class="eyebrow">Ay sonuna kadar · vadesiz hesabın</p><h3 id="cashflow-30-title" class="cf-headline' + (fragile ? ' is-fragile' : '') + '">' + A.escape(headline) + '</h3>' +
      '<p class="cf-status' + (fragile ? ' is-fragile' : '') + '">' + A.escape(sub) + '</p>' +
      // Grafik 46.000 TL'den değil, önerinin ayrıldığı varsayımıyla başlar; bu "Gün gün" içinde saklı kalmasın.
      '<p class="agent-muted cf-assume">' + (cf.assumedSaving ? 'Önerdiğim ' + A.escape(A.money(cf.assumedSaving)) + '’yi bugün ayırdığını varsayıyorum. ' : '') + 'Market, kafe, ulaşım gibi günlük harcamalar için' + (dated.length ? '. Tarihli ödemelerin (' + A.escape(dated.map(function (f) { return f.label + " " + A.money(f.amount); }).join(", ")) + ') zaten düşüldü.' : '.') + '</p>' +
      cashflowChartSvg(s, true) +
      '<p class="agent-muted cf-buffer-note">Kırmızı çizgi güvenlik payın (' + A.escape(A.money(buffer)) + ', ' + A.escape(bufferBasis(s)) + '). ' + A.escape(bufferMeaning()) + '. ' + A.escape(s.fund.product.redeem) + '</p><button type="button" class="nudge-link" id="cf30-buffer-edit">Güvenlik payını değiştir</button>' +
      (fragile && presentation.features.guards ? '<button type="button" class="btn line-dark pill small cf-solve" id="cf30-solve">Çözüm seçeneklerini gör <span aria-hidden="true">→</span></button>' : '') +
      '<p class="cf-readout" id="cf30-readout" aria-live="polite">' + A.escape(cashflowReadout(s, sel === null ? null : pts[sel])) + '</p>' +
      '<details class="nudge-why" id="cf30-days"><summary>Gün gün</summary><ol class="cashflow-timeline">' + list + '</ol>' +
      '<p class="agent-muted">Gün sonu bakiyesi: bugünkü para' + (cf.assumedSaving ? ' − önerdiğim birikim (' + A.money(cf.assumedSaving) + ')' : '') + ' − günlük ortalama harcama (' + A.money(Math.round(cf.dailyVariable)) + ') − tarihli ödemeler + onaylı girişler. ' + (cf.coveredThrough ? guardDate(cf.coveredThrough) + ' sonrası için gider verisi olmadığından grafik orada durur.' : '') + '</p></details>';
  }
  function guardDate(value) { return new Date(value + "T12:00:00+03:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", timeZone: "Europe/Istanbul" }); }
  // 26 Ekim · portföy sepeti (Hesaplarım): toplam varlık, güne göre ulaşabileceğin para ve bunun güvenlik payına etkisi.
  // Önce rakamlar; yöntem "Nasıl hesapladım?" içinde. Sinaptik hiçbir yatırımı satmaz; anahtar yalnız hesaba katıp katmamayı seçer.
  function pfSpeed(h) { return !h.useForSafety ? "off" : h.worstDays === 0 ? "s0" : h.worstDays <= 3 ? "s1" : "s2"; }
  // "13 Ekim'de", "2 Kasım'da", "1 Aralık'ta": ay adına göre bulunma eki (ünlü uyumu ve sertleşme).
  function guardDateIn(value) {
    var t = guardDate(value), last = (t.match(/[aeıioöuü](?=[^aeıioöuü]*$)/i) || ["e"])[0].toLowerCase();
    return t + "'" + (/[çfhkpsşt]$/i.test(t) ? "t" : "d") + (/[aıou]/.test(last) ? "a" : "e");
  }
  function pfArrival(h, today) {
    if (h.arrival === today) return h.anytime ? "7/24 · anında" : "Bugün " + h.cutoffLabel + "'e kadar";
    return (h.settlementDays ? "T+" + h.settlementDays + " · " : "") + guardDateIn(h.arrival) + " hesabında";
  }
  function focusPortfolio() { var pt = el("portfolio-title"), card = el("portfolio-card"); if (pt) { pt.focus({ preventScroll: true }); if (card.scrollIntoView) card.scrollIntoView({ block: "start" }); } }
  function portfolioCardHtml(s) {
    var p = s.portfolio;
    if (!p || !p.basket) return "";
    var today = s.cashflow.start, b = p.buffer, n = p.need, g = p.gap && (!n || p.gap.date !== n.date) ? p.gap : null;
    var nowReach = (p.ladder.find(function (l) { return l.today; }) || { reachable: 0 }).reachable;
    var order = p.positions.slice().sort(function (a, c) { return (a.useForSafety === c.useForSafety ? 0 : a.useForSafety ? -1 : 1) || a.worstDays - c.worstDays; });
    var bar = order.map(function (h) { return '<i class="pf-seg pf-' + pfSpeed(h) + '" style="flex-grow:' + Math.max(8, Math.round(h.amount / Math.max(1, p.total) * 1000)) + '"></i>'; }).join("");
    var steps = p.ladder.map(function (l) { return '<div' + (n && n.date === l.date ? ' class="is-need"' : '') + '><dt>' + (l.today ? "Bugün" : guardDate(l.date)) + '</dt><dd>' + A.money(l.reachable) + '</dd></div>'; }).join("");
    var list = p.positions.slice().sort(function (a, c) { return a.worstDays - c.worstDays; }).map(function (h) {
      return '<li class="pf-row' + (h.useForSafety ? '' : ' is-off') + '"><span class="pf-dot pf-' + pfSpeed(h) + '" aria-hidden="true"></span><div class="pf-main"><b>' + A.escape(h.label) + '</b> ' + A.escape(h.name) +
        '<small>' + (h.kind === "hisse" ? "Hisse" : "Fon") + ' · ' + A.escape(pfArrival(h, today)) + '</small></div><span class="pf-amt">' + A.money(h.amount) + '</span>' +
        (h.savings ? '<span class="pf-fixed" aria-hidden="true"></span>' : '<button type="button" role="switch" class="era-switch pf-switch" data-pf-use="' + A.escape(h.id) + '" aria-checked="' + String(!!h.useForSafety) + '" aria-label="' + A.escape(h.label + " acil durumda kullanılabilir") + '"><span class="era-knob"></span></button>') + '</li>';
    }).join("");
    var waits = b.tiers.filter(function (t) { return t.days > 0; }), why = b.extra ? waits.map(function (t) { return t.label; }).join(", ") + (waits.length ? " gelene kadar " : "") + (b.unfilled ? (waits.length ? "ve dolduracak yatırım olmadığı için " : "Dolduracak yatırım olmadığı için ") : "") : "";
    var payLine = p.bufferAuto
      ? '<p class="pf-pay"><b>Güvenlik payın ' + A.money(b.total) + '</b><span>' + (b.extra ? A.money(b.base) + " taban + " + A.escape(why) + A.money(b.extra) : A.RULES.portfolio.baseDays + " günlük harcaman · payını hemen doldurabilirsin") + '</span></p>'
      : '<p class="pf-pay"><b>Güvenlik payın ' + A.money(s.forecast.buffer) + '</b><span>Payı sen belirledin. Yatırımlarına göre önerim ' + A.money(b.total) + '.</span></p>';
    var pay = n ? s.bank.payments.find(function (x) { return x.status === "pending" && x.due === n.date; }) : null;
    var needBox = n ? '<div class="pf-need' + (n.gap ? ' is-short' : '') + '"><b>' + guardDate(n.date) + (pay ? " · " + A.escape(pay.label || "Ödeme") : "") + '</b>' +
      rows([["O gün gereken", A.money(n.amount)], ["O güne ulaşabileceğin", A.money(n.reachable)], ["Yatırımlarının toplamı", A.money(p.total)]]) +
      (n.gap ? '<p>' + A.money(n.gap) + ' o güne yetişmiyor.</p>' : '') + (g ? '<p>En büyük açık ' + guardDateIn(g.date) + " " + A.money(g.gap) + '.</p>' : '') + '</div>' : '';
    var how = rows([[A.RULES.portfolio.baseDays + " günlük harcaman (taban)", A.money(b.base)]].concat(b.tiers.map(function (t) {
        return [t.label + (t.withCash ? " ve boşta paran" : "") + (t.days ? " · " + t.days + " gün bekleme" : " · hemen"), A.money(Math.round(t.part / 10000) * 10000) + (t.days ? " · beklerken " + A.money(Math.round(t.cost / 10000) * 10000) : "")];
      })).concat(b.unfilled ? [["Dolduracak yatırım yok", A.money(Math.round(b.unfilled / 10000) * 10000)]] : []));
    return '<section class="pf-card" id="portfolio-card" aria-labelledby="portfolio-title"><p class="eyebrow">Yatırımların · paraya ulaşma</p>' +
      '<h3 id="portfolio-title" tabindex="-1">Toplam ' + A.money(p.total) + ' · bugün ulaşabileceğin ' + A.money(nowReach) + '</h3>' +
      '<div class="pf-bar" aria-hidden="true">' + bar + '</div><dl class="pf-steps">' + steps + '</dl>' +
      '<div class="pf-head" aria-hidden="true"><span>Yatırım</span><span>Acil durumda</span></div><ul class="pf-list">' + list + '</ul>' + payLine + needBox +
      '<details class="nudge-why" id="portfolio-how"><summary>Nasıl hesapladım?</summary>' + how +
      '<p class="agent-muted">Payın bir gün harcanırsa onu yeniden dolduracak parayı önce vadesizdeki boşta paranda ve birikim fonunda, sonra hızlıdan yavaşa diğer yatırımlarında ararım. Kendi hesapların arasında para taşımak payı değiştirmez. Beklemen gereken her parça için, o parça kadar ama bekleme günlerindeki harcamandan fazla olmayan tutarı vadesizde tutarım.' +
      (b.extra ? ' Hepsine bugün ulaşabilseydin payın ' + A.money(b.base) + ' olurdu.' : '') + '</p>' +
      '<p class="agent-muted">Bekleme: kesim saati olan yatırımda hafta sonu ve kesim sonrası için 2 gün, üstüne valör sayarım. Cuma akşamı ve tatilde daha uzun sürebilir, gerçek tarih satırda yazar. Hisse ve hisse fonlarının değerinin %80’ini sayarım. Fiyat satışa kadar düşebilir. Kapattığın yatırımı hiç saymam. Hiçbir yatırımını satmam. Satış talimatını sen verirsin.</p></details></section>';
  }
  // İçerik değişmedikçe kartı yeniden kurma; değişirse odağı aynı eyleme veya kart başlığına taşı.
  function setGuardHtml(id, html) {
    var node = el(id);
    if (guardHtml[id] === html) return;
    var active = document.activeElement, focused = node.contains(active) ? active.dataset.guardAction || (active.dataset.riskStack ? "stack:" + active.dataset.riskStack : "heading") : null;
    // Yazı alanları (ör. belgeden öde mesajı) kimliğiyle ve imleç konumuyla geri odaklanır.
    var fieldId = focused && /^(INPUT|TEXTAREA)$/.test(active.tagName) && active.id ? active.id : null, caret = fieldId ? [active.selectionStart, active.selectionEnd] : null;
    node.innerHTML = html; guardHtml[id] = html;
    if (!focused) return;
    var field = fieldId && document.getElementById(fieldId);
    if (field && node.contains(field)) { field.focus({ preventScroll: true }); try { field.setSelectionRange(caret[0], caret[1]); } catch (e) {} return; }
    // Kademeli gösterge yeniden çizilince odak aynı göstergeye döner (ekran okuyucu kullanıcısı yerini kaybetmez).
    var target = (focused.indexOf("stack:") === 0 ? node.querySelector('[data-risk-stack="' + focused.slice(6) + '"]') : node.querySelector('[data-guard-action="' + focused + '"]:not([disabled])')) || node.querySelector("h3");
    if (target) target.focus({ preventScroll: true });
  }
  function trialGuardHtml(s, activeOp) {
    var g = (s.trialGuards || []).find(function (x) { return x.due || (["blocked", "continued"].includes(x.status) && !(view.dismissedTrials || {})[x.id]); });
    if (!g) return "";
    var head = '<article class="guard-card trial-guard" aria-labelledby="trial-guard-title"><p class="eyebrow guard-eyebrow">Deneme üyeliği uyarısı</p>';
    if (g.status === "blocked") return head + '<h3 id="trial-guard-title" tabindex="-1">' + A.escape(g.merchant) + ' yenilemesi kartında engellendi</h3><p class="guard-copy">' + guardDate(g.renewalDue) + ' tarihli ' + A.money(g.renewalAmount) + '’lik yeni dönem çekimi kartından geçmeyecek.' + (g.currentAvailable > 0 ? ' Ayırabileceğin tutar korunuyor: ' + A.money(g.currentAvailable) + '.' : ' Bu ayki bütçene girmez.') + '</p><p class="agent-muted guard-fineprint">Üyeliğin sağlayıcıda açık kalabilir. Kapatmak için ' + A.escape(g.merchant) + ' hesabından da iptal etmen gerekebilir.</p><div class="guard-actions"><button type="button" class="btn line-dark pill small" data-guard-action="trial-dismiss" data-trial-id="' + A.escape(g.id) + '">Tamam</button></div></article>';
    if (g.status === "continued") return head + '<h3 id="trial-guard-title" tabindex="-1">' + A.escape(g.merchant) + ' yenilemesi giderlerine eklendi</h3><p class="guard-copy">' + A.money(g.renewalAmount) + ', ' + guardDate(g.renewalDue) + ' ödemesi olarak kalan gider tahminine eklendi. Ayırabileceğin tutar ' + A.money(g.currentAvailable) + ' olarak güncellendi.</p><p class="agent-muted guard-fineprint">Ödemeyi “Ödemelerimi gör” listesinde görebilirsin.</p><div class="guard-actions"><button type="button" class="btn line-dark pill small" data-guard-action="trial-dismiss" data-trial-id="' + A.escape(g.id) + '">Tamam</button></div></article>';
    var pendingDecision = !!activeOp && TRIAL_KINDS.includes(activeOp.kind), locked = !!activeOp ? " disabled" : "";
    var when = g.daysLeft === 0 ? "bugün" : g.daysLeft + " gün sonra";
    var impact = g.reduction > 0 ? "Yenilenirse bu ay ayırabileceğin tutar " + A.money(g.reduction) + " azalacak." : "Yenilenirse bu tutar kalan ödemelerine eklenecek.";
    // 18 Ekim: marka adı ve büyük kırmızı fiyat reklam gibi okundu; kart önce kartına ne olacağını söyler.
    return head + '<h3 id="trial-guard-title" tabindex="-1">' + (g.daysLeft === 0 ? "Bugün" : when.charAt(0).toUpperCase() + when.slice(1)) + ' kartından ' + A.money(g.renewalAmount) + ' çekilecek</h3>' +
      '<p class="guard-copy">' + A.escape(g.merchant) + ' ücretsiz denemen ' + when + ' bitiyor. Sonra her ay ' + A.money(g.renewalAmount) + '. ' + impact + '</p>' +
      '<details class="nudge-why" id="trial-guard-why" data-step="trial-why"><summary>Neden bu uyarı?</summary>' + rows([["Kart doğrulaması", A.money(g.authorizationAmount) + " · " + guardDate(g.startedOn) + (g.authorizationStatus === "released" ? " · serbest bırakıldı" : "")], ["Deneme süresi", g.trialDays + " gün · " + guardDate(g.endsOn) + " bitiş"], ["Yenileme", A.money(g.renewalAmount) + " / ay · " + guardDate(g.renewalDue)], ["Şu an ayırabileceğin", A.money(g.currentAvailable)], ["Yenilenirse ayırabileceğin", A.money(g.availableIfRenews)]]) +
      '<p class="agent-muted">Denemeye başlarken kartını doğrulamak için 1 TL geçici olarak ayrılmış. Yenileme henüz gider tahmininde yok. Devam edersen eklenir ve öneri buna göre güncellenir.</p>' + contrastTag("trial") + '</details>' +
      '<div class="guard-actions"><button type="button" class="btn line-dark pill" data-guard-action="trial-block" data-trial-id="' + A.escape(g.id) + '"' + locked + '>Yenileme çekimini engelle</button><button type="button" class="btn line-dark pill" data-guard-action="trial-continue" data-trial-id="' + A.escape(g.id) + '"' + locked + '>Devam et, giderime ekle</button></div>' +
      '<p class="agent-muted guard-fineprint">' + (pendingDecision ? "Kararın uygulanmak üzere. Üstteki bildirimden geri alabilirsin." : "Kart kontrolü yalnız bu üye işyerinin yeni dönem çekimini kartında durdurur. Üyeliğini sağlayıcıda ayrıca kapatman gerekebilir.") + '</p></article>';
  }
  // 20 Ekim (kod incelemesi): yalnız durum varken anlamı olan işaretler pasifken listelenmez ("0 · Şu an telefonda bir görüşme sürüyor" yanlış bir ifade olurdu).
  // Kişisel hareket profili: son 90 gündeki ödemeler logaritmik bir şeritte nokta, bu transfer kırmızı işaret.
  function amountProfileHtml(sig) {
    var pr = sig.profile, lo = Math.max(1000, pr.smallest || 1000), hi = Math.max(pr.amount, pr.largest) * 1.15;
    var x = function (v) { return Math.max(0, Math.min(100, 100 * Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo))); };
    var levelClass = { "olağan": "ok", "hafif": "mild", "belirgin": "notable", "çok yüksek": "high" }[sig.level] || "ok";
    return '<div class="risk-profile"><div class="risk-profile-head"><b>Senin için olağan mı?</b><span class="profile-level profile-' + levelClass + '">Olağan dışılık: ' + A.escape(sig.level) + '</span></div>' +
      '<div class="profile-strip" role="img" aria-label="Son ' + pr.windowDays + ' günde ' + pr.count + ' ödeme, ' + A.money(pr.smallest) + ' ile ' + A.money(pr.largest) + ' arasında · bu transfer ' + A.money(pr.amount) + '">' +
        '<span class="profile-band" style="left:' + x(pr.smallest) + '%;width:' + Math.max(2, x(pr.largest) - x(pr.smallest)) + '%"></span>' +
        pr.payments.map(function (v) { return '<i class="profile-dot" style="left:' + x(v).toFixed(1) + '%"></i>'; }).join("") +
        '<i class="profile-now" style="left:' + x(pr.amount).toFixed(1) + '%"></i></div>' +
      '<p class="profile-legend"><span>Olağan ödemelerin: ' + A.money(pr.smallest) + ' – ' + A.money(pr.largest) + '</span><span class="profile-legend-now">Bu transfer: ' + A.money(pr.amount) + '</span></p>' +
      '<p class="profile-reason">' + A.escape(sig.reason) + '</p>' +
      '<p class="agent-muted profile-note">Değerlendirme son ' + pr.windowDays + ' gündeki ' + pr.count + ' ödemenden ve hesaplarındaki paradan çıkarıldı.</p></div>';
  }

  // 24 Ekim (sahip): kademeli risk göstergesi, dört derinlik. Her dokunuş bir öncekinin üstüne az bilgi ekler (bilgi yükü birden gelmez):
  // 0 · "Risk" + sakin renk bandı ve imleç (ön-dikkat: konum, sayı yok) → 1 · durum + kaç işaret + kısa çipler (ne?)
  // → 2 · her işaretin sade cümlesi + sonucu (neden?) → 3 · aynı satırlara ağırlıklar eklenir, puan ve eşik; kişisel tutar profili ayrıca açılır.
  // Bir daha dokununca sadeye döner. Ağırlıklar, eşikler ve kalkan davranışı değişmez. Bütün katmanlar DOM'da, gizli olan `hidden`.
  var RISK_SHORT = { "active-call": "Görüşme sürüyor", "recent-redemption": "Yakın fon bozumu", "new-payee": "Yeni alıcı", "repeat-new-payee": "Görüşmede yeni alıcılar", "high-amount": "Olağan dışı tutar" };
  var RISK_WORD = { low: "Düşük", medium: "Dikkat", high: "Yüksek" }, RISK_DEPTH = 4;
  function riskChip(x) { return x.code === "high-amount" ? (x.level === "hafif" ? "Biraz yüksek tutar" : "Yüksek tutar") : RISK_SHORT[x.code] || x.label; }
  // Kademeli göstergelerin ortak kabuğu (kalkan riski, birikimin paranın yolu): etiket + çubuk + derinlik noktaları + ok, ardından katmanlar.
  // Derinlik katman sayısından gelir; dokunuş işleyicisi data-depth'i okur. Bütün katmanlar DOM'da, gizli olan `hidden`.
  function stackHtml(ctx, cls, label, track, sr, layers) {
    var depth = layers.length + 1, lvl = (view.riskLevel || {})[ctx] || 0, dots = "";
    for (var i = 0; i < depth; i++) dots += '<i' + (i <= lvl ? ' class="on"' : '') + '></i>';
    return '<div class="risk-stack ' + cls + ' lvl-' + lvl + '">' +
      '<button type="button" class="risk-gauge" data-risk-stack="' + ctx + '" data-depth="' + depth + '" aria-expanded="' + String(lvl > 0) + '">' +
        '<span class="risk-label" aria-hidden="true">' + A.escape(label) + '</span>' + track +
        '<span class="risk-depth" aria-hidden="true">' + dots + '</span><span class="risk-chev" aria-hidden="true"></span>' +
        '<span class="sr-only">' + sr + " · " + (lvl < depth - 1 ? "biraz daha göstermek için dokun" : "sadeleştirmek için dokun") + '</span></button>' +
      layers.map(function (html, n) { return '<div class="risk-layer risk-layer-' + (n + 1) + '"' + (lvl > n ? '' : ' hidden') + '>' + html + '</div>'; }).join("") + '</div>';
  }
  // 5 Kasım (fraud uzmanı: puan, küçük yazılar ve çok açıklama karmaşık): jüri canlı kısa müşteri yolunda puan, katkı (+20), eşik ve kayan imleç yok.
  // "Risk" dokunulabilir düğme kalır: 1 · bu işlemde gerçekten geçerli kısa gerekçeler → 2 · her birinin kısa cümlesi. Puan iç hesapta ve teknik kayıtta kalır.
  // Arama gerekçe değildir (başka telefondaki arama gözlenmez). Hiç gerekçe yoksa düğme yok: "olağan" gibi bir güvence de verilmez.
  var KISA_REASON = { "new-payee": ["Yeni alıcı", "Bu alıcıya daha önce para göndermedin."], "recent-redemption": ["Yakın birikim bozumu", "Son bir saatte birikiminden çektiğin para bu transferle çıkıyor."],
    "high-amount": ["Olağan dışı tutar", "Tutar, önceki transferlerine göre olağan dışı."], "repeat-new-payee": ["Art arda yeni alıcı", "Kısa sürede yeni alıcılara başka transferler de yapıldı."],
    "ans-directed": ["Telefon görüşmesi: Evet", "Bir telefon görüşmesi yüzünden bu işlemi yaptığını söyledin."], "ans-secrecy": ["Gizlilik isteği: Evet", "Biri bunu gizli tutmanı istedi."],
    "ans-feeling": ["Kontrol dışında: Evet", "Bu işlemi kendi kontrolünde yapmıyormuş gibi hissettiğini söyledin."] };
  // 19 Kasım (Akbank fraud direktörü): tespit mekanizmasının tamamı müşteriye gösterilmez; gösterilirse dolandırıcı kurbanı ona göre yönlendirir
  // (ör. "fonunu bozma", "yavaş dokun"). Müşteri yalnız dolandırıcının değiştiremeyeceği göstergeleri ve kendi cevaplarını görür.
  // Birikim bozumu ve davranış sinyali ajanın içeride baktığı şeylerdir; müşteri ekranına ve müşterinin gördüğü özete yazılmaz.
  var CUSTOMER_SAFE = { "new-payee": 1, "high-amount": 1, "repeat-new-payee": 1 };
  function kisaReasons(signals, answers) {
    var on = signals.filter(function (x) { return CUSTOMER_SAFE[x.code]; });
    ["directed", "secrecy", "feeling"].forEach(function (q) { if (answers && answers[q] === "yes") on.push({ code: "ans-" + q }); });
    return on;
  }
  function reasonStackHtml(risk, ctx, answers) {
    var on = kisaReasons(risk.signals.filter(function (x) { return x.active && KISA_REASON[x.code]; }), answers);
    if (!on.length) return "";
    var say = function (x) { return x.code === "high-amount" && x.level === "hafif" ? "Tutar, önceki transferlerinden biraz yüksek." : KISA_REASON[x.code][1]; };
    return stackHtml(ctx, "risk-reasons", "Risk", '<span class="risk-sum" aria-hidden="true">' + on.length + ' gerekçe</span>',
      "Risk gerekçeleri: " + on.map(function (x) { return KISA_REASON[x.code][0]; }).join(", "),
      ['<ul class="risk-chips">' + on.map(function (x) { return '<li>' + KISA_REASON[x.code][0] + '</li>'; }).join("") + '</ul>',
        '<ul class="risk-signals risk-why">' + on.map(function (x) { return '<li class="on"><span>' + A.escape(say(x)) + '</span></li>'; }).join("") + '</ul>' +
        '<p class="agent-muted risk-note">Bunlar işlemin bağlamı. Alıcı hakkında bir hüküm değil.</p>']);
  }
  function riskStackHtml(risk, ctx, fromPct, opts) {
    if (presentation.kisa) return reasonStackHtml(risk, ctx, opts && opts.answers);
    opts = opts || {};
    var rules = A.RULES.scamShield, pct = Math.max(2, Math.min(98, risk.score));
    var on = risk.signals.filter(function (x) { return x.active; }), amountSig = on.find(function (x) { return x.code === "high-amount" && x.profile; });
    return stackHtml(ctx, "risk-" + risk.level, opts.label || "Risk",
      '<span class="risk-track" aria-hidden="true"><i class="z-low" style="width:' + rules.mediumThreshold + '%"></i><i class="z-mid" style="width:' + (rules.highThreshold - rules.mediumThreshold) + '%"></i><i class="z-high"></i>' +
        '<b class="risk-cursor" data-to="' + pct + '" style="left:' + (fromPct === undefined ? pct : fromPct) + '%"></b></span>',
      "Transfer risk göstergesi: " + RISK_WORD[risk.level] + (on.length ? ", " + on.length + " işaret" : ""),
      ['<p class="risk-state"><b>' + RISK_WORD[risk.level] + '</b>' + (on.length ? ' · ' + on.length + ' işaret' : ' · işaret yok') + '</p>' +
        (on.length ? '<ul class="risk-chips">' + on.map(function (x) { return '<li>' + A.escape(riskChip(x)) + '</li>'; }).join("") + '</ul>' : ''),
      (on.length ? '<ul class="risk-signals risk-why">' + on.map(function (x) { return '<li class="on"><span>' + A.escape(x.label) + '</span><b class="risk-w">+' + x.weight + '</b></li>'; }).join("") + '</ul>' : '') +
        '<p class="agent-muted risk-note">' + A.escape(opts.note || riskSentence(risk)) + '</p>',
      '<div class="risk-head"><b>Risk puanı</b><span class="risk-score risk-' + risk.level + '">' + risk.score + '/100</span></div>' +
        '<p class="agent-muted risk-scale">Puan işaretlerin toplamı. ' + rules.mediumThreshold + '’ta dikkat, ' + rules.highThreshold + '’te güvenlik kalkanı başlar.</p>' +
        (amountSig ? '<details class="nudge-disclosure risk-more"><summary>Olağan ödemelerinle karşılaştır</summary>' + amountProfileHtml(amountSig) + '</details>' : '') + (opts.extra3 || '')]);
  }
  // İmleç önceki konumundan yeni konumuna yumuşakça kayar (innerHTML yenilemesinden sonra iki kare bekleyip).
  function slideRiskCursor(host) {
    var c = host && host.querySelector(".risk-cursor"); if (!c) return;
    var go = function () { c.style.left = c.dataset.to + "%"; };
    if (window.requestAnimationFrame) requestAnimationFrame(function () { requestAnimationFrame(go); }); else go();
  }
  function riskSentence(risk) {
    var rules = A.RULES.scamShield;
    if (risk.level === "high") return "Devam edersen güvenlik kalkanı açılacak ve transfer 15 dakika bekletilecek.";
    if (risk.level === "medium") return "Dikkat gerektiren işaretler var. Onay ekranında göstereceğim.";
    return "Olağan bir transfer görünüyor.";
  }
  // Aday 5: belgeden ödeme. 1. onay: okunan bilgileri doğrula/düzelt. 2. onay: mevcut transfer onay kartı (veya kalkan). Otonom gönderim yok.
  // Aday 5: belgeden öde. Giriş (mesaj yapıştır / PDF / fotoğraf) → inceleme adımları → okunan alanlar (1. onay) → transfer onayı (2. onay).
  function newScan() { return { mode: "text", text: "", fileId: null, sheet: false, phase: "input", step: 0, result: null, source: "", sourceText: "" }; }
  var scanGen = 0;
  // 24 Ekim (sahip): bekleme metni yok. İş sürerken düğmenin kenarında sarı yay döner; bitince düğme yeşile döner.
  // state: "" | "working" | "done". Tıklama engeli aria-disabled ile; disabled odağı düşürürdü.
  function progressBtn(state, label, doneLabel) {
    if (!state) return { cls: "", attrs: "", label: label };
    return { cls: " btn-progress is-" + state, attrs: ' aria-disabled="true"' + (state === "working" ? ' aria-busy="true"' : ''),
      label: (state === "done" ? doneLabel : label) + '<span class="sr-only" role="status">' + (state === "done" ? " · tamam" : " · işleniyor") + '</span>' };
  }
  function scanFile(sc) { return sc.fileId ? A.SCAN.files.find(function (f) { return f.id === sc.fileId && f.kind === sc.mode; }) : null; }
  function scanThumb(f) {
    var lines = f.text.split("\n").slice(0, 5).map(function (l, i) { return '<span class="' + (i === 0 ? "thumb-head" : "thumb-line") + '">' + A.escape(l) + '</span>'; }).join("");
    return '<div class="scan-thumb scan-thumb-' + f.kind + '" aria-hidden="true">' + (f.kind === "pdf" ? '<span class="thumb-badge">PDF</span>' : '') + lines + '</div>';
  }
  function scanPanelHtml() {
    var sc = view.scan || (view.scan = newScan());
    var stage = sc.phase === "review" ? "1. onay: bilgileri kontrol et" : "mesaj, PDF veya fotoğraf";
    var head = '<div class="lab-head"><p class="eyebrow guard-eyebrow">Mesaj veya belgeden öde · ' + stage + '</p><button type="button" class="human-review-close-btn" data-guard-action="scan-close" aria-label="Mesaj veya belgeden ödemeyi kapat">×</button></div>';
    if (sc.phase === "review") {
      var r = sc.result, found = [["Alıcı", !!r.payee], ["IBAN", !!r.iban], ["Tutar", r.amount !== null], ["Açıklama", !!r.note]];
      return head + '<h3 id="scan-title" tabindex="-1">Okuduğum bilgiler doğru mu?</h3><p class="guard-copy">Kaynak: ' + A.escape(sc.source) + '</p>' +
        '<blockquote class="scan-quote">' + A.escape(sc.sourceText) + '</blockquote>' +
        '<ul class="scan-found" aria-label="Bulunan bilgiler">' + found.map(function (x) { return '<li class="' + (x[1] ? "is-found" : "is-missing") + '">' + x[0] + (x[1] ? " · bulundu" : " · bulunamadı") + '</li>'; }).join("") + '</ul>' +
        '<form id="scan-form" class="agent-form" novalidate><label for="scan-payee">Alıcı</label><input id="scan-payee" type="text" autocomplete="off" value="' + A.escape(r.payee || "") + '"' + (r.payee ? '' : ' placeholder="Alıcının adını yaz"') + '>' +
        '<label for="scan-iban">IBAN</label><input id="scan-iban" type="text" autocomplete="off" spellcheck="false" value="' + A.escape(r.iban || "") + '" aria-describedby="scan-iban-status"' + (r.iban ? '' : ' placeholder="TR ile başlayan IBAN"') + '>' +
        '<p class="nt-iban-status ' + (r.ibanValid ? "is-format" : "is-invalid") + '" id="scan-iban-status">' + (r.ibanValid ? "IBAN biçimi doğru · alıcıyı doğrulamaz." : r.iban ? "IBAN kontrol hanesi tutmuyor. Rakamları kontrol et." : "IBAN bulunamadı. Sen yaz.") + '</p>' +
        '<label for="scan-amount">Tutar (TL)</label><input id="scan-amount" type="text" inputmode="decimal" autocomplete="off" value="' + (r.amount !== null ? String(r.amount / 100) : "") + '"' + (r.amount !== null ? '' : ' placeholder="Mesajda tutar yok, sen yaz"') + '>' +
        '<label for="scan-note">Açıklama</label><input id="scan-note" type="text" autocomplete="off" maxlength="140" value="' + A.escape(r.note || "") + '"' + (r.note ? '' : ' placeholder="İstersen açıklama yaz"') + '>' +
        (r.due ? '<p class="agent-muted">Belgedeki son ödeme tarihi: ' + guardDate(r.due) + '</p>' : '') +
        '<p class="nt-iban-status is-invalid" id="scan-error" role="alert" hidden></p>' +
        '<div class="lab-actions">' + stepDots(1, 2) + '<button type="submit" class="btn primary pill">Bilgiler doğru, ödeme onayına geç</button><button type="button" class="nudge-link" data-guard-action="scan-back">Baştan başla</button></div></form>' +
        '';
    }
    var file = scanFile(sc), ready = sc.mode === "text" ? !!sc.text.trim() : !!file, busy = sc.phase !== "input";
    var cta = progressBtn(sc.phase === "analyzing" ? "working" : sc.phase === "read" ? "done" : "", "İncele", "✓ Okundu");
    var tabs = [["text", "Mesaj"], ["pdf", "PDF"], ["photo", "Fotoğraf"]].map(function (m) { return '<button type="button" class="scan-mode' + (sc.mode === m[0] ? " is-on" : "") + '" data-guard-action="scan-mode" data-mode="' + m[0] + '" aria-pressed="' + (sc.mode === m[0]) + '">' + m[1] + '</button>'; }).join("");
    var body;
    if (sc.mode === "text") {
      body = '<label for="scan-text">Ödeme mesajı</label><textarea id="scan-text" class="scan-text" rows="4" placeholder="Mesajı buraya yapıştır"' + (busy ? ' readonly' : '') + '>' + A.escape(sc.text) + '</textarea>' +
        '<div class="scan-text-actions"><button type="button" class="btn line-dark small pill" data-guard-action="scan-paste">Yapıştır</button>' + (sc.text ? '<button type="button" class="nudge-link" data-guard-action="scan-clear">Temizle</button>' : '') + '</div>';
    } else if (file) {
      body = '<div class="scan-file">' + scanThumb(file) + '<div class="scan-file-meta"><b>' + A.escape(file.name) + '</b><span>' + A.escape(file.size) + ' · yüklendi</span><button type="button" class="nudge-link" data-guard-action="scan-remove">Kaldır</button></div></div>';
    } else {
      var options = A.SCAN.files.filter(function (f) { return f.kind === sc.mode; });
      body = '<button type="button" class="scan-drop" data-guard-action="scan-choose" aria-expanded="' + sc.sheet + '">' + (sc.mode === "pdf" ? "PDF dosyası seç" : "Fotoğraf çek veya galeriden seç") + '</button>' +
        (sc.sheet ? '<div class="scan-sheet" role="group" aria-label="' + (sc.mode === "pdf" ? "Dosyalar" : "Galeri") + '"><p class="agent-muted">' + (sc.mode === "pdf" ? "Dosyalar · İndirilenler" : "Galeri · Son fotoğraflar") + '</p>' +
          options.map(function (f) { return '<button type="button" class="scan-sheet-item" data-guard-action="scan-file" data-file="' + f.id + '">' + scanThumb(f) + '<span><b>' + A.escape(f.name) + '</b><small>' + A.escape(f.size) + '</small></span></button>'; }).join("") + '</div>' : '');
    }
    return head + '<h3 id="scan-title" tabindex="-1">Neyle ödeyelim?</h3><p class="guard-copy">Mesajı yapıştır ya da belgeyi yükle.</p>' +
      '<div class="scan-modes" role="group" aria-label="Kaynak türü">' + tabs + '</div>' + body +
      '<button type="button" class="btn primary pill scan-analyze' + cta.cls + '" id="scan-analyze" data-guard-action="scan-analyze"' + (ready ? '' : ' disabled') + cta.attrs + '>' + cta.label + '</button>';
  }
  async function analyzeScan() {
    var sc = view.scan; if (!sc || sc.phase !== "input") return;
    var file = scanFile(sc), text = sc.mode === "text" ? sc.text : file && file.text;
    if (!text || !text.trim()) return;
    sc.phase = "analyzing"; sc.source = sc.mode === "text" ? "Yapıştırılan mesaj" : file.title + " · " + file.name; sc.sourceText = text.trim();
    var gen = ++scanGen, ms = Math.max(0, Number(A.CONFIG.scanAnalyzeMs === undefined ? 1500 : A.CONFIG.scanAnalyzeMs));
    var wait = function (t) { return new Promise(function (resolve) { setTimeout(resolve, t); }); }, gone = function () { return gen !== scanGen || view.scan !== sc || !view.scanOpen; };
    render(A.agent.getSnapshot());
    await wait(ms); if (gone()) return;
    sc.phase = "read"; render(A.agent.getSnapshot());
    await wait(Math.min(600, ms / 2)); if (gone()) return;
    sc.result = A.extractPayment(text); sc.phase = "review";
    A.telemetry.log("scan-read", { mode: sc.mode, found: ["payee", "iban", "amount", "note"].filter(function (k) { return sc.result[k] !== null; }) });
    render(A.agent.getSnapshot());
    var missing = !sc.result.payee ? "scan-payee" : !sc.result.iban ? "scan-iban" : sc.result.amount === null ? "scan-amount" : "scan-title";
    el(missing).focus({ preventScroll: true });
  }
  async function submitScan() {
    var sc = view.scan; if (!sc || sc.phase !== "review") return;
    var r = sc.result, payee = el("scan-payee").value.trim(), iban = el("scan-iban").value, description = el("scan-note").value.trim();
    var amount = A.parseMoney(el("scan-amount").value.trim().replace(/\.(?=\d{3}(\D|$))/g, ""));
    var compact = iban.replace(/\s+/g, "").toUpperCase(), fullLength = /^TR\d{24}$/.test(compact);
    var error = !payee ? "Alıcının adını yaz." : !A.agent.validateIban(iban) ? "IBAN TR ile başlamalı ve rakamlarla devam etmeli." : fullLength && !A.ibanChecksumValid(compact) ? "IBAN kontrol hanesi tutmuyor. Rakamları kontrol et." : !amount ? "Geçerli bir TL tutarı gir." : "";
    if (error) { text("scan-error", error); visible("scan-error", true); el(!payee ? "scan-payee" : error.indexOf("IBAN") === 0 ? "scan-iban" : "scan-amount").focus({ preventScroll: true }); return; }
    var completed = r.amount === null || !r.payee || !r.iban, edited = payee !== (r.payee || "") || compact !== (r.iban || "").replace(/\s+/g, "") || (r.amount !== null && amount !== r.amount) || description !== (r.note || "");
    var result = await command({ type: "prepare-payee-transfer", payee: payee, iban: iban, amount: amount, description: description,
      note: sc.source + " · okunan bilgiler " + (edited ? "senin düzeltmenle" : completed ? "senin tamamlamanla" : "senin kontrolünle") + " onaylandı" });
    if (!result.ok) { text("scan-error", result.reason || "Ödeme hazırlanamadı."); visible("scan-error", true); return; }
    var blockedScan = blockedTransferReason(result);
    if (blockedScan) { text("scan-error", blockedScan); visible("scan-error", true); el("scan-amount").focus({ preventScroll: true }); return; }
    view.scanOpen = false; view.scan = null; render(A.agent.getSnapshot());
    var heading = el(result.shield ? "scam-shield-title" : "payee-review-title"); if (heading) heading.focus({ preventScroll: true });
  }
  function blockedTransferReason(result) {
    var s = A.agent.getSnapshot(), tp = s.plans.transfer;
    if (result.shield || !tp || tp.status !== "blocked") return "";
    return plainReason(s.tasks.transfer.reason) || "Bu transfer şu an hazırlanamadı.";
  }
  function renderTransferLab(s) {
    var open = presentation.features.guards && !!view.transferLabOpen;
    visible("new-transfer-panel", open);
    if (!open) return;
    var mask = A.agent.validateIban(el("nt-iban").value), amount = A.parseMoney(el("nt-amount").value), raw = el("nt-iban").value.replace(/\s+/g, "");
    var status = !raw ? "" : mask ? "Alıcı IBAN · " + mask : "IBAN TR ile başlamalı ve rakamlarla devam etmeli.";
    if (el("nt-iban-status").textContent !== status) text("nt-iban-status", status);
    el("nt-iban-status").classList.toggle("is-invalid", !!raw && !mask);
    // 16 Ekim görüşmesi: bu demo kısayolu jüride senaryoyu sıfırlayıp bakiyeyi 296.000 TL yapıyordu; yalnız geliştirme görünümünde.
    visible("nt-switch", presentation.development && s.preset !== "security"); visible("nt-example", presentation.development);
    text("nt-balance", "Vadesiz: " + A.money(s.balances.cash) + " · Birikim (fon): " + A.money(s.balances.savings));
    var prev = el("nt-risk").querySelector(".risk-cursor"), from = prev ? parseFloat(prev.style.left) : undefined;
    var html = mask && amount > 0 ? riskStackHtml(A.agent.assessTransferRisk({ amount: amount, ibanMask: mask }), "lab", from)
      : '<p class="agent-muted">IBAN ve tutarı girince riski burada gösteririm.</p>';
    if (guardHtml["nt-risk"] !== html) { el("nt-risk").innerHTML = html; guardHtml["nt-risk"] = html; slideRiskCursor(el("nt-risk")); }
  }
  // 21 Ekim (sahip): para çıkan her akışta birikim onayındaki aşama göstergesi. Geçilen adım dolu, bulunulan adım uzun ve soluk; onaydan sonra hepsi yeşil ve düğmenin yerinde "✓ tutar".
  function stepDots(current, total, done) {
    var dots = "";
    for (var i = 1; i <= total; i++) dots += '<i' + (done ? '' : i === current ? ' class="now"' : i > current ? ' class="next"' : '') + '></i>';
    return '<div class="approve-steps' + (done ? ' done' : '') + '" aria-hidden="true">' + dots + '</div>';
  }
  function sentPill(amount, working) { return '<div class="approve-sent' + (working ? ' is-working' : '') + '" aria-hidden="true">' + (working ? '' : '✓ ') + A.money(amount) + '</div>'; }
  function opWorking(p) { return !!p && ["pending", "running"].includes(p.status); }
  function sentNow(p) { return view.sentPlan === p.id && ["pending", "running", "succeeded"].includes(p.status); }
  function payeeReviewHtml(s, activeOp) {
    var p = s.plans.transfer;
    // Onaydan sonra kart aynı boyutta kalır (ani küçülme yok); yalnız düğmelerin yerini "✓ tutar" alır.
    var sent = !!p && p.kind === "payee-transfer" && sentNow(p);
    if (!sent && (!p || p.kind !== "payee-transfer" || p.status !== "awaiting" || s.shieldActive)) return "";
    var risk = p.risk, cashBefore = s.balances.cash + (sent && p.status === "succeeded" ? p.amount : 0);
    return '<article class="guard-card payee-review" aria-labelledby="payee-review-title"><p class="eyebrow guard-eyebrow">Transfer onayı</p><h3 id="payee-review-title" tabindex="-1">' + A.escape(p.payee) + '</h3><p class="amount">' + A.money(p.amount) + '</p>' +
      rows([["Alıcı IBAN", p.recipientIban]].concat(p.description ? [["Açıklama", p.description]] : [], p.note ? [["Kaynak", p.note]] : []).concat([["Gönderen hesap", "Vadesiz (" + A.money(cashBefore) + ")"], ["Transferden sonra vadesiz", A.money(cashBefore - p.amount)]].concat([]))) + riskStackHtml(risk, "payee:" + p.id) +
      (sent ? stepDots(2, 2, !opWorking(p)) + sentPill(p.amount, opWorking(p)) + '</article>' :
      stepDots(2, 2) + '<div class="guard-actions"><button type="button" class="btn primary pill" data-guard-action="payee-approve"' + (activeOp ? " disabled" : "") + '>' + A.money(p.amount) + ' gönder · onayla</button><button type="button" class="btn line-dark pill small" data-guard-action="payee-discard">Vazgeç</button></div>' +
      '</article>');
  }
  // Koruma kaldırma kuralı iki kartta aynı cümleyle: görüşme sürerken yalnız temsilci, bittikten sonra süre dolunca kullanıcı.
  function releaseNote(rel, now) {
    if (rel.allowed) return "";
    if (rel.callActive) return "Görüşme sürerken korumayı yalnız temsilci kaldırabilir.";
    return "Korumayı " + (rel.at ? Math.max(1, Math.ceil((rel.at - now) / 60000)) : 0) + " dakika sonra kendin kaldırabilirsin. Daha önce gerekiyorsa müşteri temsilcisi kaldırabilir.";
  }
  // 5 Kasım · ek bağlam akışı (jüri canlı kısa). Puan yok, bekleme yok. Bir anda tek soru, üç eşit cevap; sonuç motordaki karardan gelir.
  // Durumlar kayıttan okunur: Gönderilmedi · Doğrulama gerekiyor · Durduruldu · İptal edildi. "Bu transferi iptal et" yalnız bu taslağı kapatır;
  // yeni alıcı koruması ayrı ve açık bir seçim. Doğrulama uygulaması yok: "Doğrula" düğmesi yok, doğrulamanın beklediği söylenir.
  function contextShieldHtml(s, activeOp) {
    var sh = s.shield, o = s.shieldOutcome, cancelled = sh.status === "cancelled", pr = s.protection;
    if (!s.shieldActive && !cancelled) return "";
    var busyNow = !!activeOp, a = sh.answers || {}, money = A.money(sh.amount), C = A.SHIELD_CONTEXT, word = C.answers;
    var cap = { ask: "Ek bilgi gerekiyor", approve: "Cevabın kaydedildi", verify: "Doğrulama gerekiyor", stop: "Durduruldu", hold: "İncelemede" }[o] || "";
    var head = cancelled ? ["İptal edildi", "Transfer iptal edildi. Paran hesabında."] : [cap, { ask: "Göndermeden önce kısa bir soru", approve: "Karar sende", verify: "Bu transfer doğrulama bekliyor", stop: "Bu transferi gönderme", hold: "Bu alıcıya transfer doğrulama bekliyor" }[o]];
    var state = cancelled ? "İptal edildi · para gönderilmedi" : o === "approve" ? "Gönderilmedi · onayın bekleniyor" : o === "verify" || o === "hold" ? "Gönderilmedi · uygulamadan gönderilemez" : "Gönderilmedi · paran hesabında";
    function answerBtn(q, v) { return '<button type="button" class="btn line-dark small pill guard-answer" data-guard-action="shield-ctx" data-q="' + q + '" data-a="' + v + '"' + (busyNow ? " disabled" : "") + '>' + word[v] + '</button>'; }
    function question(q, text) { return '<div class="guard-question" role="group" aria-labelledby="shield-q-' + q + '"><p id="shield-q-' + q + '">' + text + '</p><div class="guard-answer-row is-three">' + ["yes", "no", "unsure"].map(function (v) { return answerBtn(q, v); }).join("") + '</div></div>'; }
    var answered = [a.directed && [C.short.directed, a.directed], a.secrecy && [C.short.secrecy, a.secrecy], a.feeling && [C.short.feeling, a.feeling]].filter(Boolean);
    var body = '';
    if (!cancelled && o === "ask") { var nq = C.next(a); body = question(nq, C.questions[nq]); }
    if (answered.length && !(o === "ask" && !a.directed)) body = '<ul class="guard-answers" aria-label="Cevapların">' + answered.map(function (x) { return '<li>' + x[0] + ': <b>' + word[x[1]] + '</b></li>'; }).join("") + '</ul>' + body;
    var outcome = cancelled ? '<p class="guard-copy" id="shield-outcome">' + money + ' gönderilmedi. Yalnız bu transfer iptal edildi. ' + (a.directed === "yes" ? "Kayıtlı alıcıların ve ödemelerin açık. Yeni alıcıya doğrulamadan para gitmez." : "Diğer işlemlerin açık.") + '</p>' +
        '<p class="shield-steps-title">Şimdi:</p><ol class="shield-steps"><li>Seni yönlendiren biri varsa aramayı kapat.</li><li>Temsilciyi sen ara: <b>444 25 25</b></li><li>“Akbank’tan arıyoruz” denirse: Güvenlik Merkezi → “Beni arayan Akbank mı?”</li></ol>'
      : o === "approve" ? '<p class="guard-copy" id="shield-outcome">Cevabın kaydedildi. Göndermek senin onayında. Şüphe varsa iptal et.</p>'
      : o === "verify" ? '<p class="guard-copy" id="shield-outcome">Göndermeden önce bir temsilcinin seninle doğrulaması gerekiyor. Uygulamadan şu an gönderilemez. Temsilciyi sen ara: <b>444 25 25</b></p>'
      : o === "stop" ? '<p class="guard-alert" id="shield-outcome" role="alert">Gizli tutmanı isteyen biri var. Banka, polis ya da 112 senden para göndermeni ve bunu gizlemeni istemez. Bu transferi gönderme.</p>'
      : o === "hold" ? '<p class="guard-copy" id="shield-outcome">' + (sh.hold && sh.hold.otherPayee ? "Telefonla yönlendirildiğini söyledin. Doğrulanana kadar yeni alıcıya para gitmez. Kayıtlı alıcıların ve ödemelerin açık." : "Bu alıcı için doğrulama istendi. Yeni cevap ya da bekleme bunu kaldırmaz.") + ' Temsilciyi sen ara: <b>444 25 25</b></p>' : '';
    var reviewBtn = '<button type="button" class="btn line-dark pill small" data-guard-action="shield-review" aria-expanded="' + String(!!view.shieldReviewOpen) + '" aria-controls="shield-review-panel">' + (view.shieldReviewOpen ? "Temsilci özetini gizle" : cancelled ? "Temsilci için özeti aç" : "Temsilci için özet hazırla") + '</button>';
    var protectOn = pr.newPayeeLocked, rel = s.protectionRelease || {};
    var protect = !cancelled ? '' : protectOn ? '<div class="shield-protect is-on" id="shield-protect"><p><b>Yeni alıcı koruması açık</b> · ' + A.escape(pr.reference || "") + '</p><p class="agent-muted guard-fineprint">Yeni alıcılara transfer kapalı. Kayıtlı alıcıların açık. ' +
        releaseNote(rel, s.now) + '</p>' + (rel.allowed ? '<button type="button" class="btn line-dark pill small" data-guard-action="shield-release">Korumayı kaldır</button>' : '') + '</div>'
      : '<div class="shield-protect" id="shield-protect"><button type="button" class="btn line-dark pill small" data-guard-action="shield-protect">Yeni alıcılara gönderimleri de korumaya al</button><p class="agent-muted guard-fineprint">İsteğe bağlı. Açarsan yeni alıcılara transfer kapanır, kayıtlı alıcıların açık kalır.</p></div>';
    var actions = cancelled ? reviewBtn
      : o === "approve" ? '<button type="button" class="btn primary pill" data-guard-action="payee-approve"' + (busyNow ? " disabled" : "") + '>' + money + ' gönder · onayla</button><button type="button" class="btn line-dark pill small" data-guard-action="shield-cancel"' + (busyNow ? " disabled" : "") + '>Bu transferi iptal et</button>'
      : o === "ask" ? '<button type="button" class="btn line-dark pill small" data-guard-action="shield-cancel"' + (busyNow ? " disabled" : "") + '>Bu transferi iptal et</button>'
      : '<button type="button" class="btn primary pill" data-guard-action="shield-cancel"' + (busyNow ? " disabled" : "") + '>Bu transferi iptal et</button>' + reviewBtn;
    return '<article class="guard-card scam-shield is-context' + (cancelled ? ' is-protected' : '') + '" data-outcome="' + (cancelled ? "cancelled" : o) + '" aria-labelledby="scam-shield-title"><p class="eyebrow guard-eyebrow">Güvenlik kalkanı · ' + head[0] + '</p><h3 id="scam-shield-title" tabindex="-1">' + head[1] + '</h3>' +
      '<p class="amount">' + money + '</p><p class="guard-payee">' + A.escape(sh.payee) + ' · ' + A.escape(sh.recipientIban) + ((sh.signals || []).indexOf("new-payee") >= 0 ? ' · yeni alıcı' : '') + '</p>' +
      '<p class="guard-state" id="shield-state">' + state + '</p>' + body + outcome +
      '<div class="shield-why">' + riskStackHtml(sh.risk, "shield:" + sh.id, undefined, { answers: sh.answers }) + '</div>' +
      '<div class="guard-actions">' + actions + '</div>' + protect + '</article>';
  }
  function scamShieldHtml(s, activeOp) {
    var sh = s.shield, review = s.tasks.transfer && s.tasks.transfer.humanReview;
    if (sh && sh.flow === "context") return view.shieldDismissed ? "" : contextShieldHtml(s, activeOp);
    if (sh && sh.status === "protected" && s.protection.newPayeeLocked && !view.shieldDismissed) {
      // 20 Ekim (katılımcı): baskı altındaki kişi korumayı da kaldırır. Görüşme sürerken yalnız temsilci; bittikten 15 dk sonra kullanıcı.
      var rel = s.protectionRelease || {};
      var release = rel.allowed ? '<button type="button" class="btn line-dark pill small" data-guard-action="shield-release">Korumayı kaldır</button>' : '';
      var releaseNoteHtml = rel.allowed ? '' : '<p class="agent-muted guard-fineprint" id="shield-release-note">' + releaseNote(rel, s.now) + '</p>';
      return '<article class="guard-card scam-shield is-protected" aria-labelledby="scam-shield-title"><p class="eyebrow guard-eyebrow">Güvenlik kalkanı · Koruma açık</p><h3 id="scam-shield-title" tabindex="-1">Transfer durduruldu. Paran hesabında.</h3>' +
        '<p class="guard-copy">' + (review ? A.money(review.amount) + " gönderilmedi. " : "") + 'Yeni alıcılara transfer kapalı, kayıtlı alıcıların açık.</p>' +
        // 18 Ekim (risk-2): "Akbank seni arayacak" denmez (dolandırıcı aynı vaatle geri arayabilir). İletişimi kullanıcı başlatır; temsilci döngüde kalır.
        '<p class="shield-steps-title">Şimdi:</p><ol class="shield-steps"><li>Görüşmeyi kapat.</li><li>Temsilciyi sen ara: <b>444 25 25</b></li><li>“Akbank’tan arıyoruz” denirse: Güvenlik Merkezi → “Beni arayan Akbank mı?”</li></ol>' +
        '<div class="guard-actions"><button type="button" class="btn line-dark pill small" data-guard-action="shield-review" aria-expanded="' + String(!!view.shieldReviewOpen) + '" aria-controls="shield-review-panel">Temsilcinin göreceği özet' + (view.shieldReviewOpen ? "i gizle" : "") + '</button>' + release + '</div>' + releaseNoteHtml + '</article>';
    }
    if (!s.shieldActive) return "";
    var p = s.plans.transfer, signals = p.risk.signals.filter(function (x) { return x.active; });
    var cooled = !!sh.coolingUntil && s.now >= sh.coolingUntil, busyNow = !!activeOp;
    // 20 Ekim (katılımcı): "09:15'e kadar" demo saatiyle okununca "birkaç saat" sanıldı; kalan süre göreli yazılır.
    var waitMin = sh.coolingUntil ? Math.max(1, Math.ceil((sh.coolingUntil - s.now) / 60000)) : 0;
    function answerButton(value, label) { return '<button type="button" class="btn line-dark small pill guard-answer" data-guard-action="shield-' + value + '" aria-pressed="' + String(sh.answer === value) + '">' + label + '</button>'; }
    return '<article class="guard-card scam-shield" aria-labelledby="scam-shield-title"><p class="eyebrow guard-eyebrow">Güvenlik kalkanı · ' + signals.length + ' işaret</p><h3 id="scam-shield-title" tabindex="-1">Bu transferi göndermeden önce dur</h3>' +
      '<p class="amount">' + A.money(p.amount) + '</p><p class="guard-payee">' + A.escape(p.payee) + ' · ' + A.escape(p.recipientIban) + ' · yeni alıcı</p>' +
      '<div class="guard-question" role="group" aria-labelledby="shield-question"><p id="shield-question">Telefondaki kişi bu işlemi gizli tutmanı mı istedi?</p><div class="guard-answer-row">' + answerButton("yes", "Evet") + answerButton("no", "Hayır") + '</div></div>' +
            // 18 Ekim (sade-1): risk ekranında metin çoktu. Görünen: soru, kısa yanıt, bekleme, eylem; gerekçe "Neden durdurdum?" altında.
            // 5 Kasım (sahip): kalkandaki göstergenin etiketi de her yerdeki gibi "Risk". Gerekçe aynı katmanlarda.
      (sh.answer === "yes" ? '<p class="guard-alert" role="alert">Bu, dolandırıcılığın en sık işareti. Banka, polis veya savcı asla başka bir hesaba para aktarmanı ya da işlemi gizli tutmanı istemez.</p>' :
        sh.answer === "no" ? '<p class="guard-copy">Banka, polis veya savcı telefonda para aktarmanı istemez. Emin değilsen aramayı Güvenlik Merkezi → “Beni arayan Akbank mı?” ile doğrula.</p>' : '') +
      (sh.coolingUntil ? '<p class="guard-cooling" role="status">' + (cooled ? "Güvenlik beklemesi tamamlandı. Karar sende." : "Transferi " + waitMin + " dakika bekletiyorum. Paran hesabında. Sonra karar sende.") + '</p>' : '') +
      '<div class="guard-actions"><button type="button" class="btn primary pill" data-guard-action="shield-stop"' + (busyNow ? " disabled" : "") + '>İşlemi durdur ve korumaya al</button>' +
      (cooled && sh.answer ? '<button type="button" class="btn outline pill" data-guard-action="shield-approve"' + (busyNow ? " disabled" : "") + '>' + A.money(p.amount) + ' yine de gönder · onayla</button>' : '') + '</div>' +
      (cooled && !sh.answer ? '<p class="agent-muted guard-fineprint">Göndermeye karar verirsen önce yukarıdaki soruyu yanıtla.</p>' : '') +
      // H-13: soru ve eylemler önce; risk sinyalleri ve "Senin için olağan mı?" ayrıntısı kapalı açıklamada.
      '<div class="shield-why">' + riskStackHtml(p.risk, "shield:" + p.id, undefined, { note: "Bu işaretler birlikte görüldüğü için transferi beklettim.", extra3: contrastTag("shield") }) + '</div></article>';
  }
  // 29 Ekim · kısa sürüm: Kalkan sahnesi sosyal mühendisliğe, Ajanlar sahnesindeki fiyat kalkanı profillemeye karşı. İkisi aynı yumuşak etiketle okunur.
  // 22 Ekim (sahip planı, 20 Ekim): son ödeme günü kararı. Tamamı varsayılan seçili (nudge), asgari eşit görünür ve maliyeti TL olarak yanında.
  // FCA OP45: asgariyi gizlemek gecikmeyi artırabildi; bu yüzden asgari saklanmaz. Metin az; ayrıntı "Nasıl hesapladın?" içinde.
  function newStmt() { return { choice: "full", custom: "", pending: null, sent: null, dismissed: false }; }
  function stmtSelection(c) {
    var v = view.stmt;
    if (v.choice === "min" && c.minimumOption) return { amount: c.minimumOption.amount, topUp: c.minimumOption.topUp, cost: c.minimumOption.cost, valid: true };
    if (v.choice === "custom") {
      var amount = A.parseMoney(v.custom);
      if (!amount) return { amount: 0, valid: false, reason: "" };
      var pv = A.agent.previewCardPayment(amount);
      return { amount: amount, topUp: pv.topUp || 0, cost: pv.cost || 0, valid: pv.valid, reason: pv.reason };
    }
    return { amount: c.full.amount, topUp: c.full.topUp, cost: 0, valid: true };
  }
  function cardStatementHtml(s, activeOp) {
    var c = s.cardStatement, v = view.stmt;
    if (!c || v.dismissed || !c.open && !v.sent) return "";
    var title = (c.paid > 0 && c.open ? "Kalan " + A.money(c.outstanding) : A.money(c.total)) + " · son ödeme " + guardDate(c.due);
    var head = '<article class="guard-card card-statement' + (v.sent && !c.open ? ' is-paid' : '') + '" aria-labelledby="card-statement-title"><p class="eyebrow guard-eyebrow">Borç ödeme</p><h3 id="card-statement-title" tabindex="-1">' + A.escape(v.sent ? A.money(c.total) + " · son ödeme " + guardDate(c.due) : title) + '</h3>';
    if (v.sent) {
      return head + stepDots(2, 2, !v.sent.working) + sentPill(v.sent.amount, v.sent.working) +
        (v.sent.topUp || c.open ? '<p class="agent-muted guard-fineprint">' + (v.sent.topUp ? A.money(v.sent.topUp) + "’si fonundan geldi. Güvenlik payın vadesizde. " : "") + (c.open ? "Kalan borç " + A.money(c.outstanding) + "." : "") + '</p>' : '') +
        '<div class="guard-actions"><button type="button" class="btn line-dark pill small" data-guard-action="stmt-done">Tamam</button></div></article>';
    }
    var sel = stmtSelection(c), busyNow = !!activeOp;
    if (v.pending) {
      var pd = v.pending, after = s.balances.cash - (pd.amount - pd.topUp), left = c.outstanding - pd.amount;
      return head + '<div class="fund-confirm">' + rows([["Karta", A.money(pd.amount)]].concat(pd.amount > pd.topUp ? [["Vadesizden", A.money(pd.amount - pd.topUp)]] : []).concat(pd.topUp ? [["Fondan", A.money(pd.topUp)]] : []).concat([["Sonra vadesiz", A.money(after)]]).concat(left > 0 ? [["Kalan borç", A.money(left) + " · ≈ " + A.money(Math.round(pd.cost / 100) * 100) + " faiz"]] : [])) +
        stepDots(2, 2) + '<div class="guard-actions"><button type="button" class="btn primary pill" data-guard-action="stmt-confirm"' + (busyNow ? " disabled" : "") + '>' + A.money(pd.amount) + ' öde · onayla</button><button type="button" class="btn line-dark pill small" data-guard-action="stmt-cancel">Vazgeç</button></div></div></article>';
    }
    function option(key, label, amount, meta, metaClass) {
      var on = v.choice === key;
      return '<button type="button" class="stmt-option' + (on ? ' is-on' : '') + '" data-guard-action="stmt-choice" data-choice="' + key + '" aria-pressed="' + on + '"><span>' + label + '</span><b>' + A.money(amount) + '</b><small class="' + metaClass + '">' + meta + '</small></button>';
    }
    var opts = option("full", c.paid > 0 ? "Kalanı" : "Tamamı", c.full.amount, "faiz yok", "stmt-free") +
      (c.minimumOption ? option("min", "Asgari", c.minimumOption.amount, "≈ " + A.money(Math.round(c.minimumOption.cost / 100) * 100) + " faiz", "stmt-cost") : "");
    var custom = v.choice === "custom";
    var customHtml = custom ? '<div class="fund-amount-box stmt-amount-box"><input id="stmt-amount" inputmode="decimal" autocomplete="off" aria-label="Ödeme tutarı" placeholder="0" value="' + A.escape(v.custom) + '"><span>TL</span></div>' +
      (sel.amount && !sel.valid && sel.reason ? '<p class="agent-muted guard-fineprint stmt-custom-note">' + A.escape(sel.reason) + '</p>' : sel.valid && sel.cost ? '<p class="agent-muted guard-fineprint stmt-custom-note">Kalan ' + A.money(c.outstanding - sel.amount) + ' · ≈ ' + A.money(Math.round(sel.cost / 100) * 100) + ' faiz</p>' : '') : '';
    var r = A.RULES.cardStatement, pct = function (bps) { return "%" + (bps / 100).toLocaleString("tr-TR"); };
    var why = '<details class="nudge-why" id="card-statement-why" data-step="statement-why"><summary>Nasıl hesapladın?</summary>' + rows([["Ekstre borcu", A.money(c.total)], ["Asgari (" + pct(c.minimumBps) + ")", A.money(c.minimum)]].concat(c.paid ? [["Ödediğin", A.money(c.paid)]] : []).concat([["Aylık akdi faiz", pct(c.monthlyRateBps)], ["KKDF + BSMV (faizin)", pct(c.taxBps)], [c.paid ? "Kalan ödenmezse" : "Yalnız asgariyi ödersen", "≈ " + A.money(c.paid ? c.costIfUnpaid : c.minimumOption ? c.minimumOption.cost : c.costIfUnpaid) + " / ay"]])) +
      '<ul class="why-points agent-muted"><li>Asgari: dönem borcunun %20’si (limiti 100.000 TL’ye kadar kartlar, BDDK).</li><li>Faiz yaklaşık: kalan borç 30 gün değişmezse. Kesin tutar ekstrende.</li><li>Ekstrenin tamamını ödenecek sayıyorum. Birikim önerin bu paradan yapılmaz.</li>' +
      (c.full.topUp ? '<li>Tamamı için ' + A.money(c.full.topUp) + '’yi fonundan tamamlarım. Güvenlik payın vadesizde kalır.</li>' : '') + '</ul>' + sourceLink(r.source, "Asgari ödeme kuralı · BDDK") + '</details>';
    return head + '<div class="stmt-options" role="group" aria-label="Ödeme tutarı">' + opts + '</div>' +
      '<button type="button" class="nudge-link stmt-custom-link" data-guard-action="stmt-choice" data-choice="custom" aria-pressed="' + custom + '">Başka tutar</button>' + customHtml +
      stepDots(1, 2) + '<div class="guard-actions"><button type="button" class="btn primary pill" data-guard-action="stmt-pay"' + (busyNow || !sel.valid ? " disabled" : "") + '>' + (sel.amount ? A.money(sel.amount) + ' öde' : 'Tutar gir') + '</button></div>' + why + '</article>';
  }
  // Son ödeme gününe geri sayım: kesimden son ödeme gününe çubuk, "Bugün" işareti. Yazı değil, kalan sürenin kendisi görünür.
  function dueBarHtml(c) {
    var span = Math.max(1, Math.round((Date.parse(c.due) - Date.parse(c.issued)) / 86400000)), left = Math.max(0, c.daysLeft), pct = Math.round((span - left) / span * 100);
    return '<div class="cc-due' + (left <= 3 ? ' is-near' : '') + '" aria-label="Son ödeme gününe ' + left + ' gün"><div class="cc-due-track"><i style="width:' + Math.max(4, pct) + '%"></i></div>' +
      '<div class="cc-due-labels"><span>Kesim · ' + guardDate(c.issued) + '</span><b>' + (left === 0 ? "Bugün son gün" : left + " gün kaldı") + '</b><span>' + guardDate(c.due) + '</span></div></div>';
  }
  // Ana sayfada hatırlatma ve iki seçeneğin karşılaştırması; ödeme ve onay tek yerde, Kredi kartım ekranında (bir işlev iki ekranda yaşamaz).
  // 28 Ekim (sahip: "yeterince gelişmiş değil"): uzun cümle yerine kart görseli, kalan gün etiketi ve iki eşit kutu. Kutuya dokununca ödeme ekranı o seçimle açılır.
  function cardDueHtml(s) {
    var c = s.cardStatement;
    if (!c || !c.open || view.stmt.sent) return "";
    var left = Math.max(0, c.daysLeft);
    var tile = function (key, label, amount, meta, cls) { return '<button type="button" class="stmt-option" data-guard-action="card-open" data-choice="' + key + '"><span>' + label + '</span><b>' + A.money(amount) + '</b><small class="' + cls + '">' + meta + '</small></button>'; };
    return '<article class="guard-card card-statement card-due" aria-labelledby="card-due-title">' +
      '<div class="card-due-head"><p class="eyebrow guard-eyebrow">Kart ekstren</p><span class="card-due-days' + (left <= 3 ? ' is-near' : '') + '">' + (left === 0 ? "Bugün son gün" : left + " gün kaldı") + '</span></div>' +
      '<div class="card-due-main">' + cardVisualHtml(s.card, true) + '<h3 id="card-due-title" tabindex="-1"><b>' + (c.paid > 0 ? "Kalan " + A.money(c.outstanding) : A.money(c.total)) + '</b><span class="sr-only"> · </span><span>son ödeme ' + guardDate(c.due) + '</span></h3></div>' +
      '<div class="stmt-options" role="group" aria-label="Nasıl ödemek istersin?">' + tile("full", c.paid > 0 ? "Kalanı" : "Tamamı", c.full.amount, "faiz yok", "stmt-free") +
        (c.minimumOption ? tile("min", "Asgari", c.minimumOption.amount, "≈ " + A.money(Math.round(c.minimumOption.cost / 100) * 100) + " faiz", "stmt-cost") : "") + '</div></article>';
  }
  function cardVisualHtml(cd, mini) {
    return '<div class="cc-visual' + (mini ? ' is-mini' : '') + '" aria-hidden="true"><span class="cc-brand">akbank</span><span class="cc-kind">Kredi Kartı</span><span class="cc-chip"></span>' +
      '<span class="cc-number">•••• •••• •••• ' + A.escape(cd.last4) + '</span><span class="cc-holder">' + A.escape(cd.holder) + '</span></div>';
  }
  function cardTopHtml(s) {
    var cd = s.card, c = s.cardStatement, open = c && c.open, usedPct = Math.min(100, Math.round(cd.used / cd.limit * 1000) / 10);
    var action = function (key, icon, label, on) { return '<button type="button" class="cc-action' + (on ? ' is-on' : '') + '" data-guard-action="' + key + '"><span class="cc-action-icon"><svg viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg></span>' + label + '</button>'; };
    return cardVisualHtml(cd) +
      '<div class="cc-actions" role="group" aria-label="Kart işlemleri">' +
        action("cc-pay", '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M12 13v4M10 15l2 2 2-2"/>', "Borç öde", open) +
        // Hesap özeti ve otomatik ödeme kartın ek bölümlerinde; bölümler çizilmiyorsa düğmeleri de yok.
        (presentation.features.cardMore ? action("cc-statement", '<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21Z"/><path d="M10 8h4M10 12h4"/>', "Hesap özeti") +
        action("cc-autopay", '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/>', "Otomatik ödeme", cd.autopay) : '') + '</div>' +
      '<section class="cc-summary" aria-label="Kart özeti"><div class="cc-limit"><div><b>' + A.money(cd.available) + '</b><span>Kullanılabilir limit</span></div><div class="cc-right"><b>' + A.money(cd.limit) + '</b><span>Toplam kart limiti</span></div></div>' +
        '<div class="cc-limit-bar"><i class="cc-limit-fill" data-pct="' + usedPct + '" style="width:' + usedPct + '%"></i></div>' +
        '<div class="cc-debts"><div><b>' + A.money(cd.statementDebt) + '</b><span>' + (cd.cut ? "Hesap özeti borcu" : "Kalan hesap özeti borcu") + '</span></div><div><b>' + A.money(cd.periodDebt) + '</b><span>Güncel dönem borcu</span></div></div>' +
        rows((cd.cut ? [["Hesap kesim tarihi", guardDate(cd.cutDate)], ["Son ödeme tarihi", guardDate(cd.due)]].concat(c && c.minimumLeft > 0 ? [["Asgari ödeme", A.money(c.minimumLeft)]] : []).concat([["Sonraki hesap kesim", guardDate(cd.nextCut)]])
          : [["Sonraki hesap kesim", guardDate(cd.nextCut)], ["Sonraki son ödeme", guardDate(cd.nextDue)], ["Önceki hesap özeti", A.money(cd.previous.total) + " · " + guardDate(cd.previous.paidOn) + "’de ödendi"]])) +
        (open ? dueBarHtml(c) : '') + '</section>';
  }
  function cardMoreHtml(s) {
    var cd = s.card, list = function (items, pending) { return '<ul class="cc-tx">' + items.slice().reverse().map(function (x) {
      return '<li><span class="cc-tx-date"><b>' + new Date(x.date + "T12:00:00+03:00").getDate() + '</b>' + new Date(x.date + "T12:00:00+03:00").toLocaleDateString("tr-TR", { month: "short", timeZone: "Europe/Istanbul" }) + '</span><span class="cc-tx-body"><b>' + A.escape(x.merchant) + '</b><small>' + A.escape(x.category) + (pending ? ' · <em class="cc-pending">Bekleyen provizyon</em>' : '') + '</small></span><span class="cc-tx-amount">' + A.money(x.amount) + '</span></li>';
    }).join("") + '</ul>'; };
    // Hesap özeti dökümü: kategorilerin payı tek çubukta; en büyük kalem bir cümleyle.
    var byCat = {}; cd.items.forEach(function (x) { byCat[x.category] = (byCat[x.category] || 0) + x.amount; });
    var cats = Object.keys(byCat).map(function (k) { return { label: k, amount: byCat[k] }; }).sort(function (a, b) { return b.amount - a.amount; }), total = cats.reduce(function (n, x) { return n + x.amount; }, 0);
    var stmtTitle = cd.cut ? "Hesap özeti · " + guardDate(cd.cutDate) : "Bu dönemin harcamaları";
    var statement = '<section class="cc-section" id="cc-statement-section" aria-labelledby="cc-statement-title"><button type="button" class="cc-section-head" data-guard-action="cc-statement-toggle" aria-expanded="' + !!view.ccStatementOpen + '"><span id="cc-statement-title">' + stmtTitle + '</span><b>' + A.money(total) + '</b></button>' +
      (view.ccStatementOpen ? '<div class="cc-cats" aria-hidden="true">' + cats.map(function (x, i) { return '<i class="cc-cat-' + Math.min(i, 4) + '" style="width:' + (x.amount / total * 100).toFixed(1) + '%"></i>'; }).join("") + '</div>' +
        '<ul class="cc-cat-legend">' + cats.slice(0, 4).map(function (x, i) { return '<li><i class="cc-cat-' + i + '"></i>' + A.escape(x.label) + ' <b>' + A.money(x.amount) + '</b></li>'; }).join("") + '</ul>' + list(cd.items, false) : '') + '</section>';
    var autopay = '<section class="cc-section cc-autopay" id="cc-autopay-section"><div class="cc-autopay-row"><span><b>Her ay tamamını otomatik öde</b><small>Son ödeme günü hesap özeti borcu vadesizden ödenir.</small></span>' +
      '<button type="button" class="cc-switch" role="switch" aria-checked="' + cd.autopay + '" aria-label="Her ay tamamını otomatik öde" data-guard-action="cc-autopay-toggle"><i></i></button></div>' +
      (cd.autopay ? '<p class="agent-muted guard-fineprint">Vadesiz yetmeyecekse son ödeme gününden önce haber veririm. İstersen fondan tamamlarım.</p>' : '') + '</section>';
    return statement + autopay + '<h3 class="cc-h3">Son hareketler</h3>' + list(cd.provisions, true);
  }
  function liquidityGuardHtml(s, activeOp) {
    var lq = s.liquidity, cf = s.cashflow, reserve = lq.reserve, eco = A.RULES.ecosystem;
    var head = '<article class="guard-card liquidity-guard' + (lq.fragile ? '' : ' is-resolved') + '" aria-labelledby="liquidity-guard-title"><p class="eyebrow guard-eyebrow">Ay sonuna kadar</p>';
    if (!lq.fragile) {
      if (!reserve || view.liquidityDismissed === reserve.reference || s.forecast.liquidityReserve === 0) return "";
      var viaBank = reserve.source === "open-banking";
      return head + '<h3 id="liquidity-guard-title" tabindex="-1">' + guardDate(reserve.until) + ' artık güvende</h3><p class="guard-copy">' +
        (viaBank ? A.money(reserve.amount) + " diğer bankadan vadesiz hesabına geldi ve " + guardDate(reserve.until) + " için ayrıldı. Birikim önerin " + A.money(s.forecast.available) + " olarak kaldı."
          : "Ayırabileceğin tutardan " + A.money(reserve.amount) + ", " + guardDate(reserve.until) + " için ayrıldı. Birikim önerin " + A.money(s.forecast.available) + " oldu. Para hareket etmedi.") + '</p>' +
        '<div class="guard-actions">' + (viaBank ? '' : '<button type="button" class="btn line-dark pill small" data-guard-action="liquidity-clear">Payı kaldır</button>') + '<button type="button" class="btn line-dark pill small" data-guard-action="liquidity-dismiss" data-reference="' + A.escape(reserve.reference) + '">Tamam</button></div></article>';
    }
    var minDay = cf.days.find(function (x) { return x.date === lq.day; }) || { flows: [] };
    var outs = minDay.flows.filter(function (x) { return x.kind === "out"; });
    var recovery = cf.days.find(function (x) { return x.date > lq.day && x.flows.some(function (f) { return f.kind === "in"; }); });
    var cause = outs.length ? guardDate(lq.day) + "’deki " + outs.map(function (x) { return A.money(x.amount) + " " + x.label.toLocaleLowerCase("tr-TR"); }).join(", ") + " sonrası" : guardDate(lq.day) + " civarında";
    var after = Math.max(0, s.forecast.available - lq.deficit), busyNow = activeOp ? " disabled" : "", obPending = !!activeOp && OB_KINDS.includes(activeOp.kind);
    var timeline = cf.days.filter(function (x) { return !x.beyondHorizon && (x.flows.length || x.date === lq.day); }).map(function (x) {
      return '<li class="' + (x.date === lq.day ? "is-fragile" : "") + '"><span>' + guardDate(x.date) + '</span><span>' + A.escape(x.flows.map(function (f) { return (f.kind === "in" ? "+ " : "− ") + A.money(f.amount) + " " + f.label; }).join(" · ") || "Günlük harcamalar") + '</span><b>' + A.money(x.balance) + '</b></li>';
    }).join("");
    var src = lq.linkedAccount, canBalance = cf.assumedSaving >= lq.deficit, canRecover = !canBalance && s.balances.savings >= lq.deficit;
    return head + '<h3 id="liquidity-guard-title" tabindex="-1">' + guardDate(lq.day) + '’de hesabın güvenlik payının ' + A.money(lq.deficit) + ' altına inebilir</h3><p class="amount">' + A.money(lq.minBalance) + '</p>' +
      '<div class="cf-inline">' + cashflowChartSvg(s, false) + '</div>' +
      '<p class="guard-copy">' + (cf.assumedSaving > 0 ? 'Önerdiğim ' + A.money(cf.assumedSaving) + '’yi bugün ayırırsan, ' : 'Bugünkü bakiyenle, ') + cause + ' hesabın güvenlik payının ' + A.money(lq.deficit) + ' altına inebilir.' + (recovery ? " " + guardDate(recovery.date) + "’deki onaylı girişle yeniden toparlanıyor." : "") + '</p>' +
      '<details class="nudge-why" id="liquidity-why" data-step="liquidity-why"><summary>Gün gün nasıl hesapladın?</summary><ol class="cashflow-timeline">' + timeline + '</ol><p class="agent-muted">Gün sonu vadesiz bakiyesi: bugünkü para − önerilen birikim − günlük ortalama harcama (' + A.money(Math.round(cf.dailyVariable)) + ') − tarihli ödemeler + onaylı girişler. ' + A.escape(cf.note) + '</p>' + contrastTag("cashflow") + (src ? contrastTag("openBanking") : "") + '</details>' +
      (src ? '<div class="liquidity-source"><b>' + A.escape(src.label) + '</b><span>Diğer bankadaki hesabın · ' + A.escape(src.ibanMask) + ' · bakiye ' + A.money(src.balance) + '</span></div>' : '') +
      '<div class="guard-actions">' + (src ? '<button type="button" class="btn line-dark pill" data-guard-action="liquidity-ob"' + busyNow + '>Diğer bankadan ' + A.money(lq.deficit) + ' çek · onayla</button>' : '') +
      // SA-09: seçenekler eşit ağırlıkta. H-01: "dengele" yalnız ayrılacak öneri açığı kapatıyorsa gösterilir; yoksa birikimden aktarım.
        (canBalance ? '<button type="button" class="btn line-dark pill" data-guard-action="liquidity-safe"' + busyNow + '>Ayırabileceğin tutardan dengele</button>' : '') +
        (canRecover ? '<button type="button" class="btn line-dark pill" data-guard-action="liquidity-recover"' + busyNow + '>Birikimden ' + A.money(lq.deficit) + ' vadesize aktar</button>' : '') + '</div>' +
      '<p class="agent-muted guard-fineprint">' + (obPending ? "Aktarım gönderilmek üzere. Üstteki bildirimden geri alabilirsin." : (src ? "Diğer bankadan çekim birikim önerine dokunmaz: " + A.money(s.forecast.available) + " kalır. " : "") + (canBalance ? "Ayırabileceğin tutardan dengelersen öneri " + A.money(after) + " olur ve para hareket etmez. " : "") + (canRecover ? "Birikimden aktarım kendi hesapların arasındadır, hemen uygulanır. " : "") + A.escape(A.RULES.openBanking.note)) + '</p></article>';
  }
  // Ekosistem bilgisi ana sayfada itilmez; yalnız kullanıcı kendi hesap hareketindeki gri "i"ye basınca açılır (çekme, itme değil).
  // Stablex ayrı bir uygulamadır; Akbank'ın kendisi kripto satıyormuş gibi yönlendirme yapılmaz.
  var ECO_LEDGER = { "crypto-platform": { key: "crypto", label: "Bu transfer hakkında bilgi" }, pension: { key: "pension", label: "Devlet katkısı hakkında bilgi" } };
  function ecoLedgerInfoHtml(s, tx, cashAmount) {
    var kind = ECO_LEDGER[tx.category].key, open = !!(view.ecoOpen || {})[tx.id], eco = A.RULES.ecosystem, body;
    if (kind === "crypto") {
      var c = s.ecosystem.crypto, info = eco.crypto;
      body = '<p class="ledger-eco-hook"><b>Kripto için Akbank grubunda bir adres var:</b> Stablex.</p>' +
        '<p class="ledger-eco-copy">Son 90 günde yurt dışı kripto platformlarına ' + c.count + ' FAST/EFT transferin oldu (toplam ' + A.money(c.total) + '). ' + A.escape(info.name) + ', ' + A.escape(info.relation.replace(/ \(\d{4}\)$/, "")) + '. Kripto varlıklarda 7/24 işlem sunan ayrı bir uygulama.</p>' +
        '<button type="button" class="btn line-dark small pill" data-eco-open="crypto">Stablex\'i incele</button>' +
        '<p class="eco-disclaimer">Yatırım tavsiyesi değildir. Kripto varlıklar yüksek fiyat riski taşır.</p>';
    } else {
      var rule = A.RULES.bes, paid = -cashAmount, credit = Math.round(paid * rule.rateBps / 10000);
      body = '<p class="ledger-eco-hook"><b>Bu, kendi BES\'ine yaptığın ek katkı.</b></p>' +
        '<p class="ledger-eco-copy">' + A.money(paid) + ' kendi ' + A.escape(eco.pension.name) + ' hesabına gitti. Devlet bu ek katkı için yaklaşık ' + A.money(credit) + ' ekler (2026 tahmini, %' + rule.rateBps / 100 + ').</p>' +
        '<button type="button" class="btn line-dark small pill" data-eco-open="pension">BES katkımı gör</button>' +
        '<p class="eco-disclaimer">Tavsiye değildir. Devlet katkısı yıllık sınıra ve hak kazanma koşullarına bağlıdır. Çekebileceğin kısım sözleşmene ve sistemde kaldığın süreye göre değişir.</p>';
    }
    return '<div class="ledger-eco" id="eco-info-' + A.escape(tx.id) + '"' + (open ? '' : ' hidden') + '>' + body + contrastTag(kind) + '</div>';
  }
  function contrastTag(key) {
    var c = presentation.features.contrast && A.RULES.existingContrast[key];
    return c ? '<p class="contrast-tag" data-contrast="' + key + '"><span>Akbank\'ta:</span> ' + A.escape(c.akbank) + ' · <span>Burada:</span> ' + A.escape(c.here) + '</p>' : "";
  }
  function ecoTag(id, s) {
    var eco = A.RULES.ecosystem, t = s.ecosystem, p = s.plans.savings;
    if (id === "savings") return p && p.kind === "recover" ? "Kaynak: likit birikimin · " + s.fund.product.name + " · " + s.fund.product.facts + "." : "Örnek fon: " + s.fund.product.name;
    if (id === "bes") return t.pension.overflowEligible ? "Kısa vadeli likit birikimin (" + A.money(t.liquid.balance) + ") hedef seviyede (" + A.money(t.liquid.target) + "). Güvenli payının bir kısmını " + eco.pension.name + " katkına yönlendirirsen 2026 kuralına göre %" + t.pension.rateBps / 100 + " devlet katkısı alabilirsin. Acil ihtiyaçta likit birikimin korunur. " + eco.pension.name + ": " + eco.pension.relation + "."
      : "Önce kısa vadeli likit birikim hedefin (" + A.money(t.liquid.target) + ") tamamlanır. Taşan pay sonra BES'e yönlendirilebilir.";
    if (id === "gold") return "Altına fonla da erişebilirsin: " + eco.goldFund.name + " (" + eco.goldFund.code + ") · " + eco.goldFund.facts + ". Fon fiyatı dalgalanır. Geçmiş getiri gelecek için garanti değildir.";
    return "";
  }
  // Tutar yoksa ya da o yöne yetmiyorsa düğme soluk kalır; geçerli tutarla canlanır.
  function syncFundActions(s) {
    var amount = A.parseMoney(el("fund-amount").value) || 0, open = s.fund.window.open;
    el("fund-deposit-btn").disabled = !open || amount <= 0 || amount > s.balances.cash;
    el("fund-redeem-btn").disabled = !open || amount <= 0 || amount > s.balances.savings;
  }
  function fundClosedHint(w) {
    var next = new Date(w.nextDay + "T12:00:00+03:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long", timeZone: "Europe/Istanbul" });
    return "Şu an " + w.code + " işlem saati dışında. Fon bugün nakde çevrilemez. Bir sonraki işlem: " + next + ", saat " + w.cutoff + " öncesinde.";
  }
  function renderCardPage(s) {
    var bar = el("cc-top").querySelector(".cc-limit-fill"), before = bar ? bar.style.width : null;
    setGuardHtml("cc-top", cardTopHtml(s)); setGuardHtml("cc-more", presentation.features.cardMore ? cardMoreHtml(s) : "");
    // Limit çubuğu ödeme sonrası yumuşakça kısalır (yeniden çizimde eski genişlikten başlar).
    var fill = el("cc-top").querySelector(".cc-limit-fill");
    if (fill && before && before !== fill.style.width) { var to = fill.style.width; fill.style.width = before; void fill.offsetWidth; fill.style.width = to; }
  }
  // 22 Ekim (evre-1, PLAN_GELECEK_EVRELERI.md): "Yakın gelecek" ve "Ajanlar çağı" sahneleri. Desen aynı: 1/2 → 2/2 → 0,7 sn'de kırmızıdan açık yeşile "✓ ...".
  // 23 Ekim (sahip, UI turu 3): yakın gelecek tutarları motordan gelir ve onay gerçek fon aktarımıdır (deposit-savings; geri al = redeem-savings),
  // böylece ana sayfadaki bakiye ile "✓ ayrıldı" çelişmez. Ajan sahnesi kurgusal kalır; dil "ödeme izni"dir, bakiye değişmez.
  // Telefon içinde meta dil yok ("senaryo", "baştan göster"); sahne sıfırlama gizli çubukta.
  var NEAR_CAP = 5000000;
  function sentText(label, working) { return '<div class="approve-sent' + (working ? ' is-working' : '') + '" aria-hidden="true">' + (working ? '' : '✓ ') + A.escape(label) + '</div>'; }
  function eraSay(message) { era.status = message; var live = el("era-live"); if (live) live.textContent = message; }
  var ERA_ICONS = {
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>',
    fund: '<path d="M4 17l5-5 4 3 7-8"/><path d="M15 7h5v5"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/>',
    bag: '<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c5.5 0 9 7 9 7a16 16 0 0 1-2.4 3.3"/><path d="M6.5 6.6C4 8.3 3 12 3 12s3.5 7 9 7a9.6 9.6 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'
  };
  function eraIcon(name, tone) { return '<span class="era-icon' + (tone ? ' ' + tone : '') + '" aria-hidden="true"><svg viewBox="0 0 24 24">' + ERA_ICONS[name] + '</svg></span>'; }
  function eraSwitch(attr, key, on, label) { return '<button type="button" role="switch" class="era-switch" data-guard-action="' + attr + '-' + key + '" data-' + attr + '="' + key + '" aria-checked="' + String(on) + '" aria-label="' + A.escape(label) + '"><span class="era-knob"></span></button>'; }
  var NEAR_RULES = [
    { key: "ruleBuffer", icon: "shield", title: "Güvenlik payı sınırı", sub: "Payın her zaman vadesizde kalır", full: "Vadesizde güvenlik payımı her zaman koru" },
    { key: "ruleCardSweep", icon: "card", title: "Kart ekstresi güvencesi", sub: "Vadesiz yetmezse yalnız eksik kısım fondan", full: "Son ödeme günü vadesiz yetmezse yalnız eksik kısmı fondan tamamla" },
    { key: "ruleAutoSave", icon: "fund", title: "Boşta para kuralı", sub: "Kalanı ALE fonuna · ayda en fazla 50.000 TL", full: "Ödemelerden ve güvenlik payından kalanı aylık 50.000 TL sınırına kadar ALE fonuna ayır" }
  ];
  function nearActive(n) { return NEAR_RULES.filter(function (r) { return n[r.key]; }).length; }
  // Hesaptaki paranın yolu (motordan): ödemeler + güvenlik payı + fona ayrılan + vadesizde serbest = vadesiz bakiye.
  // Güvenlik payı kuralı kapalıysa pay da boşta sayılır; aylık 50.000 TL sınırı aşılmaz.
  function nearPlan(s, n) {
    var cash = s.balances.cash, payments = Math.min(cash, s.forecast.expected), pay = Math.min(Math.max(0, cash - payments), s.forecast.buffer);
    var free = Math.max(0, cash - payments - (n.ruleBuffer ? pay : 0)), save = n.ruleAutoSave ? Math.min(NEAR_CAP, free) : 0;
    return { cash: cash, payments: payments, pay: pay, save: save, rest: Math.max(0, cash - payments - (n.ruleBuffer ? pay : 0) - save), rules: { ruleBuffer: n.ruleBuffer, ruleCardSweep: n.ruleCardSweep, ruleAutoSave: n.ruleAutoSave } };
  }
  function allocationHtml(p, n, done) {
    n = p.rules || n;
    var parts = [
      { key: "payments", label: "Ödemelerin", sub: n.ruleCardSweep ? "kart ekstresi dahil · faiz 0 TL" : "ekstre ödemesi sana sorulur", amount: p.payments, tone: n.ruleCardSweep ? "ink" : "ink is-manual" },
      { key: "pay", label: "Güvenlik payı", sub: n.ruleBuffer ? "vadesizde korunur" : "kural kapalı · korunmaz", amount: n.ruleBuffer ? p.pay : 0, tone: "blue" },
      { key: "save", label: "ALE fonuna", sub: n.ruleAutoSave ? (p.save ? "aylık 50.000 TL sınırının içinde" : "bu ay boşta para yok") : "kural kapalı · ayrılmaz", amount: p.save, tone: "green", plus: true },
      { key: "rest", label: "Vadesizde serbest", sub: "", amount: p.rest, tone: "free" }
    ], total = Math.max(1, p.cash);
    return '<div class="era-alloc' + (done ? ' is-done' : '') + '"><div class="era-alloc-bar" aria-hidden="true">' + parts.map(function (x) {
        return '<i class="tone-' + x.tone + '" data-seg="' + x.key + '" data-grow="' + Math.round(x.amount / total * 1000) + '" style="flex-grow:' + Math.round(x.amount / total * 1000) + '"></i>';
      }).join("") + '</div><dl class="era-alloc-legend">' + parts.filter(function (x) { return x.amount > 0 || x.key !== "rest"; }).map(function (x) {
        return '<div class="' + (x.amount > 0 ? '' : 'is-off') + '"><dt><span class="era-dot tone-' + (x.amount > 0 ? x.tone : 'off') + '" aria-hidden="true"></span><span><b>' + x.label + '</b>' + (x.sub ? '<small>' + x.sub + '</small>' : '') + '</span></dt><dd>' + (x.amount > 0 ? (x.plus ? "+" : "") + A.money(x.amount) : "—") + '</dd></div>';
      }).join("") + '<div class="era-alloc-total"><dt>' + (done ? "Döngüden önce hesabındaki para" : "Hesabındaki para") + '</dt><dd>' + A.money(p.cash) + '</dd></div></dl></div>';
  }
  function miniBarHtml(p, n) {
    var total = Math.max(1, p.cash);
    n = p.rules || n;
    return '<span class="era-minibar" aria-hidden="true"><i class="tone-ink" style="flex-grow:' + Math.round(p.payments / total * 100) + '"></i><i class="tone-blue" style="flex-grow:' + Math.round((n.ruleBuffer ? p.pay : 0) / total * 100) + '"></i><i class="tone-green" style="flex-grow:' + Math.round(p.save / total * 100) + '"></i><i class="tone-free" style="flex-grow:' + Math.round(p.rest / total * 100) + '"></i></span>';
  }
  // Evre 2 · ay içi an: beklenmedik giderle güvenlik payı delinince pay kuralı fondan eksik kısmı hazırlar.
  // Tutarlar motordan: eksik = forecast.shortfall, vadesizde kalan pay = vadesiz − beklenen ödemeler.
  function nearSweepState(s) {
    var n = era.near, w = n.sweep;
    if (!n.ruleBuffer) return null;
    if (w.sent) return { sent: w.sent };
    var need = s.forecast.shortfall;
    if (!(need > 0) || w.skipped || s.balances.savings < need) return null;
    return { need: need, left: Math.max(0, s.balances.cash - s.forecast.expected), buffer: s.forecast.buffer };
  }
  function nearSweepHtml(s) {
    var st = nearSweepState(s), w = era.near.sweep;
    if (!st) return "";
    var head = '<div class="era-sweep" id="near-sweep"><p class="era-section-title">Ay içi · güvenlik payı kuralın</p>';
    if (st.sent) return head + sentText(A.money(st.sent) + " vadesize aktarıldı · pay korundu") + '<button type="button" class="nudge-link era-undo" id="near-sweep-undo" data-guard-action="near-sweep-undo"' + (w.busy ? ' disabled' : '') + '>Geri al</button></div>';
    var cta = progressBtn(w.busy ? "working" : "", "Fondan " + A.money(st.need) + " tamamla · uygula");
    return head + '<h4 class="era-sweep-title">Güvenlik payı kuralın tetiklendi · Vadesizin ' + A.money(st.left) + '\'ye indi</h4>' +
      '<p class="agent-muted era-fine">Eksik ' + A.money(st.need) + ' ALE fonundan vadesize aktarılır · İşlemden sonra vadesizde payın ' + A.money(st.buffer) + ' olur.</p>' +
      (era.near.error ? '<p class="guard-alert era-note" role="alert">' + A.escape(era.near.error) + '</p>' : '') +
      '<div class="guard-actions era-equal"><button type="button" class="btn line-dark pill' + cta.cls + '" id="near-sweep-confirm" data-guard-action="near-sweep-confirm"' + cta.attrs + '>' + cta.label + '</button>' +
      '<button type="button" class="btn line-dark pill" id="near-sweep-skip" data-guard-action="near-sweep-skip">Bu kez atla (düşük bakiyeyle devam et)</button></div></div>';
  }
  function nearTeaserHtml(s) {
    var n = era.near, p = n.cycleSent ? n.plan : nearPlan(s, n);
    var sweep = nearSweepState(s);
    var pendingSweep = !!sweep && !sweep.sent;
    var sub = pendingSweep ? "Ay içi tamamlama hazır" : n.cycleSent ? "✓ " + (n.amount ? A.money(n.amount) + " kurallarınla ayrıldı" : "Döngü tamamlandı") : n.cycleStep === 1 ? "Döngü onayını bekliyor" : p.save ? "Bu ay " + A.money(p.save) + " fona ayrılabilir" : "Kuralların seni koruyor";
    return '<button type="button" class="era-teaser" data-guard-action="near-open">' + eraIcon("shield", "tone-blue") +
      '<span class="era-teaser-text"><b id="near-era-title">' + nearActive(n) + ' kuralın aktif</b><span class="' + (pendingSweep ? 'is-warn' : n.cycleSent ? 'is-done' : '') + '">' + A.escape(sub) + '</span>' + miniBarHtml(p, n) + '</span><span class="era-teaser-go" aria-hidden="true">›</span></button>' + nearSweepHtml(s);
  }
  function nearEraHtml(s) {
    if (view.page === "home") return nearTeaserHtml(s);
    var n = era.near, active = nearActive(n), p = n.cycleSent ? n.plan : nearPlan(s, n);
    var html = '<p class="eyebrow era-eyebrow">Sana önerdiğim kurallar</p><h3 id="near-era-title" tabindex="-1">' + active + ' kuralın aktif</h3>' +
      '<p class="agent-muted era-lead">Harcamana göre önerdim. Hangisi açık kalacak, sen seçersin.</p>' +
      '<ul class="era-rules" aria-label="Yetki kuralların">' + NEAR_RULES.map(function (r) {
        var on = !!n[r.key];
        return '<li class="era-rule' + (on ? '' : ' is-off') + '">' + eraIcon(r.icon, on ? "tone-blue" : "") + '<div><b>' + r.title + '</b><span>' + r.sub + '</span></div>' + eraSwitch("near-rule", r.key, on, r.title + ": " + r.full) + '</li>';
      }).join("") + '</ul><div class="era-section"><p class="era-section-title">Bu ay paranın yolu</p>' + allocationHtml(p, n, n.cycleSent);
    if (n.cycleSent) return html + stepDots(2, 2, true) + sentText(n.amount ? A.money(n.amount) + " kurallarınla ayrıldı" : "Döngü kurallarınla tamamlandı") +
      '<p class="agent-muted era-fine">Fon bakiyende ve hesap hareketlerinde görünür.</p><button type="button" class="nudge-link era-undo" id="near-cycle-undo" data-guard-action="near-undo"' + (n.busy ? ' disabled' : '') + '>Son döngüyü geri al</button></div>' + nearSweepHtml(s);
    if (n.cycleStep === 1) return html + '<ol class="era-timeline" aria-label="Ne zaman ne olur">' +
        '<li><b>Şimdi</b><span>' + (p.save ? A.money(p.save) + " ALE fonuna geçer" : "Fona para ayrılmaz") + '</span></li>' +
        '<li><b>Ödeme günleri</b><span>' + A.money(p.payments) + ' ödemelerin vadesizden' + (n.ruleCardSweep ? ' · ekstreye yetmezse eksik kısım fondan' : '') + '</span></li>' +
        '<li><b>Her gün</b><span>' + (n.ruleBuffer ? A.money(p.pay) + " güvenlik payı vadesizde kalır" : "Güvenlik payı ayrıca korunmaz") + '</span></li></ol>' +
      (n.error ? '<p class="guard-alert era-note" role="alert">' + A.escape(n.error) + '</p>' : '') + stepDots(2, 2) +
      (function (g) { return '<div class="guard-actions"><button type="button" class="btn primary pill' + g.cls + '" id="near-cycle-confirm" data-guard-action="near-confirm"' + g.attrs + '>' + g.label + '</button>'; })(progressBtn(n.busy ? "working" : "", "Kurallarım içinde uygula · onayla")) +
      '<button type="button" class="btn line-dark small pill" id="near-cycle-cancel" data-guard-action="near-cancel">Vazgeç</button></div></div>';
    return html + (n.undone ? '<p class="agent-muted era-note">Son döngü geri alındı. Para vadesizine döndü.</p>' : '') + stepDots(1, 2) +
      '<button type="button" class="btn line-dark pill" id="near-cycle-prepare" data-guard-action="near-prepare"' + (active ? '' : ' disabled') + '>Döngüyü önizle</button></div>';
  }
  var AGENTS = {
    budget: { key: "travel", icon: "plane", name: "Seyahat Ajanı", amount: "28.000 TL", limit: 3000000 },
    kya: { key: "shop", icon: "bag", name: "Alışveriş Ajanı", amount: "130.000 TL", limit: 1000000 },
    spoof: { key: "shop", icon: "shield", name: "Satıcı Ajanı", amount: "8.400 TL", limit: 1000000 }
  };
  var FUTURE_MODES = ["budget", "kya", "spoof"];
  function agentStatus(mode) {
    var f = era.future;
    if (mode === "spoof") return f.spoof.stopped ? ["✓ Engellendi · para çıkmadı", "tone-green"] : ["Kalkan bekletiyor · karar sende", "tone-red"];
    if (mode === "kya") return f.kya.stopped ? [f.agents.shop ? "Durduruldu · izin yeniden açık" : "Durduruldu · izin askıda", "tone-green"] : ["Kalkan bekletiyor · karar sende", "tone-red"];
    if (f.budget.sent) return f.budget.choice === "travel" ? ["✓ Bilete öncelik verildi", "tone-green"] : ["✓ Birikimin korundu · bilet alınmadı", "tone-green"];
    return f.agents.travel ? ["İki hedefin çatışıyor · karar sende", "tone-amber"] : ["Ajan yetkin kapalı", "tone-grey"];
  }
  function limitMeterHtml(amount, limit, over) {
    return '<div class="era-limit' + (over ? ' is-over' : '') + '" aria-hidden="true"><div class="era-limit-bar"><i style="width:' + Math.min(100, Math.round(amount / limit * 100)) + '%"></i></div></div>';
  }
  // İki yolun etkisi, hedef çizgisine göre. Pay kuralı açıksa çatışma birikim hedefinde, kapalıysa güvenlik payında.
  function bar(label, value, kurus, max, mark, tone) { return '<div class="era-impact-row"><span>' + label + '</span><div class="era-impact-track"><i class="' + tone + '" style="width:' + Math.round(kurus / max * 100) + '%"></i><em style="left:' + mark + '%"></em></div><b class="' + tone + '">' + value + '</b></div>'; }
  function impactHtml(ruleOn) {
    // feyz-2 (9 Kasım, stres testi): bilet aylık giderin üstüne ek harcamadır. 92.000 − 42.000 gider − 6.000 pay = 44.000 hedef, bilet 28.000 → 16.000.
    // 44.000 ayrıldıysa nakit akışında 24 Ekim vadesizi 20.000 TL (kalan gider 14.000 + pay 6.000). Kural açıkken bilet fondan, kapalıyken önce vadesizden ödenir.
    if (!ruleOn) return '<div class="era-impact"><p class="era-impact-title">24 Ekim\'de vadesizin<span class="era-impact-key"><em aria-hidden="true"></em>Güvenlik payı 6.000 TL</span></p>' +
      bar("Bilete öncelik", "0 TL", 0, 800000, 75, "tone-amber") + bar("Bileti almazsan", "20.000 TL", 800000, 800000, 75, "tone-green") + '</div>';
    return '<div class="era-impact"><p class="era-impact-title">Bu ayki birikimin<span class="era-impact-key"><em aria-hidden="true"></em>Hedef 44.000 TL</span></p>' +
      bar("Bilete öncelik", "16.000 TL", 1600000, 5000000, 88, "tone-amber") + bar("Birikimi korursan", "44.000 TL", 4400000, 5000000, 88, "tone-green") + '</div>';
  }
  // 29 Ekim · fiyat kalkanı (sahip: "söylemeden fark etmezler"). Ajan aynı bileti iki kez sordu: seni tanıyan sorgu tavanının hemen altını,
  // kimliksiz sorgu 28.000 TL'yi gördü. Ekstre kartındaki dil: önceki tutar üstü çizili + nedeni gösteren renkli çip. Tutarlar sabit, 29.900 yalnız karşılaştırma.
  // Çizgi ilk açılışta bir kez, yumuşakça çizilir; sonraki yeniden çizimlerde aynı son hâl gelir (her dokunuşta tekrar oynamaz).
  function eraFreshMs() { return Math.max(0, Number(A.CONFIG.eraFreshMs === undefined ? 1800 : A.CONFIG.eraFreshMs)); }
  function priceWasHtml(b) {
    if (!b.priceAt) b.priceAt = Date.now();
    var fresh = Date.now() - b.priceAt < eraFreshMs() ? ' is-fresh' : '';
    return '<p class="nudge-was era-price-was"><span class="sr-only">Seni tanıyan sorguda </span><s class="era-strike' + fresh + '">29.900 TL</s>' +
      '<button type="button" class="was-chip era-price-chip' + fresh + '" id="future-price" data-guard-action="future-price" aria-expanded="' + String(!!b.priceOpen) + '" aria-controls="future-price-panel">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' + ERA_ICONS.eyeoff + '</svg>Fiyat kalkanı · −1.900 TL</button></p>';
  }
  function priceHtml() {
    return '<div class="era-impact era-price" id="future-price-panel"><p class="era-impact-title">Aynı bilet, iki sorgu<span class="era-impact-key"><em aria-hidden="true"></em>Tavanın 30.000 TL</span></p>' +
      bar("Seni tanıyınca", "29.900 TL", 2990000, 3200000, 93.75, "tone-amber") + bar("Kimliksiz sorgu", "28.000 TL", 2800000, 3200000, 93.75, "tone-green") +
      '<ul class="era-price-why"><li>Satıcı kart türünü, geçmişini ve tavanını görmedi</li><li>Fiyat kimliksiz kilitlendi · adın ve kartın ödemede gider</li></ul></div>';
  }
  // KYA denetimi: aynı dört satır iki istekte de. Ana fikir: doğrulanmış kimlik tek başına güvenli işlem demek değildir.
  function checksHtml(title, list, after) {
    var marks = { ok: "✓", warn: "!", bad: "×" };
    return '<div class="era-checks"><p class="era-section-title">' + title + '</p><ul>' + list.map(function (c) {
      return '<li class="is-' + c[0] + '"><span class="era-check-mark" aria-hidden="true">' + marks[c[0]] + '</span><div><b><span class="sr-only">' + { ok: "Uygun", warn: "Dikkat", bad: "Uygun değil" }[c[0]] + ': </span>' + c[1] + '</b><span class="era-check-value">' + A.escape(c[2]) + (c[3] || '') + '</span></div></li>';
    }).join("") + '</ul>' + (after || '') + '</div>';
  }
  function futureTeaserHtml() {
    var f = era.future, open = (f.budget.sent ? 0 : 1) + (f.kya.stopped ? 0 : 1) + (f.spoof.stopped ? 0 : 1);
    return '<div class="era-inbox-head"><p class="eyebrow era-eyebrow" id="future-era-title">Ajan istekleri</p>' + (open ? '<span class="era-count" aria-label="' + open + ' istek kararını bekliyor">' + open + '</span>' : '') + '</div><ul class="era-inbox">' + FUTURE_MODES.map(function (mode) {
      var a = AGENTS[mode], st = agentStatus(mode);
      return '<li><button type="button" class="era-inbox-row" data-guard-action="future-open-' + mode + '">' + eraIcon(a.icon, mode === "budget" ? "tone-teal" : "tone-red") +
        '<span class="era-teaser-text"><b>' + a.name + ' · ' + a.amount + '</b><span class="era-status ' + st[1] + '">' + A.escape(st[0]) + '</span>' +
        (mode === "budget" && !presentation.kisa && !(f.budget.sent && f.budget.choice !== "travel") ? '<span class="era-inbox-price"><svg viewBox="0 0 24 24" aria-hidden="true">' + ERA_ICONS.eyeoff + '</svg>Fiyat kalkanı · −1.900 TL</span>' : '') + '</span><span class="era-teaser-go" aria-hidden="true">›</span></button></li>';
    }).join("") + '</ul>';
  }
  function agentsPanelHtml() {
    var f = era.future;
    return '<details class="nudge-why era-agents"' + (f.agentsOpen ? ' open' : '') + '><summary data-era-agents>Ajan yetkilerin</summary><ul class="era-rules">' + ["budget", "kya"].map(function (mode) {
      var a = AGENTS[mode], on = !!f.agents[a.key];
      return '<li class="era-rule' + (on ? '' : ' is-off') + '">' + eraIcon(a.icon, on ? (mode === "kya" ? "tone-red" : "tone-teal") : "") + '<div><b>' + a.name + '</b><span>' + (on ? "İşlem başına en fazla " + A.money(a.limit) : "Askıda · ödeme isteyemez") + '</span></div>' + eraSwitch("agent", a.key, on, a.name + " ödeme yetkisi") + '</li>';
    }).join("") + [["askFirst", "shield", "Geri alınamayan ödemede önce sor", "Ajan, IBAN'a sana sormadan para göndermez"], ["antiProfiling", "eyeoff", "Gözetim fiyatlaması kalkanı", "Ödemede bütçen, kart türün ve geçmişin satıcıya gitmez"], ["saveFirst", "fund", "Çatışmada birikimi öncele", "Bütçe çatışmasında birikim hedefin otomatik korunur"]].map(function (x) {
      var on = !!f.agents[x[0]];
      return '<li class="era-rule' + (on ? '' : ' is-off') + '">' + eraIcon(x[1], on ? "tone-teal" : "") + '<div><b>' + x[2] + '</b><span>' + (on ? x[3] : "Kapalı") + '</span></div>' + eraSwitch("agent", x[0], on, x[2]) + '</li>';
    }).join("") + '</ul><p class="agent-muted era-fine">Yetki kendiliğinden artmaz. Sınırı yalnız sen değiştirirsin.</p></details>';
  }
  // Ana sayfada ajan istekleri listesi. Kısa sürümde kart yalnız başlatılan istekle çizilir (renderEra: era.future.picked).
  function futureInbox() { return view.page === "home"; }
  function futureEraHtml(s) {
    if (futureInbox()) return futureTeaserHtml();
    var f = era.future, b = f.budget, k = f.kya;
    function chip(mode) {
      var a = AGENTS[mode], st = agentStatus(mode);
      return '<button type="button" class="btn line-dark small pill era-mode" data-guard-action="future-mode-' + mode + '" data-future-mode="' + mode + '" aria-pressed="' + String(f.mode === mode) + '"><span class="era-status-dot ' + st[1] + '" aria-hidden="true"></span>' + a.name + '<small>' + a.amount + '</small></button>';
    }
    // Kısa sürümde her istek ayrı başlatılır: kartta yalnız başlatılan istek var, diğerlerine geçiş çipi yok.
    var html = '<p class="eyebrow era-eyebrow">Ajan istekleri</p>' + (presentation.kisa ? '' : '<div class="era-modes" role="group" aria-label="Ajan istekleri">' + FUTURE_MODES.map(chip).join("") + '</div>');
    if (f.mode === "spoof") {
      var sp = f.spoof, stop = progressBtn(sp.working ? "working" : "", "İptal et");
      html += '<div class="era-agent">' + eraIcon("bag", "tone-red") + '<div><b>Alışveriş Ajanı · kulaklık siparişi</b><span>' + (sp.stopped ? "Ödeme engellendi" : "Kalkan bekletiyor · para çıkmadı") + '</span></div></div>' +
        '<p class="eyebrow guard-eyebrow">Güvenlik kalkanı · Karşı taraf KYA denetimi</p><p class="amount era-amount">8.400 TL</p><h3 id="future-era-title" tabindex="-1">Karşı satıcı ajanının kimliği doğrulanamadı</h3>' +
        checksHtml("Senin ajanın doğrulandı, karşı taraf doğrulanamadı", [
          ["ok", "Ajanın kimliği", "Alışveriş Ajanı · imzalı istek"],
          ["ok", "Yetki sınırı", "8.400 / 10.000 TL · limitin içinde", limitMeterHtml(840000, 1000000, false)],
          ["bad", "Karşı taraf", "Satıcı ajanı · sertifika uyuşmazlığı · 2 saat önce açılmış uç nokta"],
          ["bad", "Risk türü", "Ajan kimliği taklidi şüphesi"]]) +
        "";
      var spSum = '<button type="button" class="btn line-dark pill" id="future-spoof-summary" data-guard-action="future-spoof-summary" aria-expanded="' + String(sp.summaryOpen) + '">' + (sp.summaryOpen ? "KYA kaydını gizle" : "Kilitli KYA denetim kaydı göster") + '</button>';
      html += sp.stopped ? sentText("8.400 TL engellendi") + '<div class="guard-actions">' + spSum + '</div>'
        : '<div class="guard-actions era-equal"><button type="button" class="btn line-dark pill' + stop.cls + '" id="future-spoof-stop" data-guard-action="future-spoof-stop"' + stop.attrs + '>' + stop.label + '</button>' + spSum + '</div>';
      if (sp.summaryOpen) html += '<div class="era-kya-summary"><p class="era-section-title">Temsilcinin göreceği KYA kaydı</p>' + rows([["İşlem", "8.400 TL · Alışveriş Ajanı · kulaklık siparişi"], ["Durum", sp.stopped ? "Engellendi · hesaptan para çıkmadı" : "Bekletiliyor · hesaptan para çıkmadı"], ["Karşı taraf denetimi", "Satıcı ajanı sertifikası uyuşmuyor · uç nokta 2 saatlik"], ["Profilleme kalkanı", f.agents.antiProfiling ? "Nötr BIN · izole PAR · gerçek kart gizli" : "Kapalı"]]) + '<p class="agent-muted review-locked-note">Kayıt banka tarafından tutulur ve değiştirilemez. İnsan temsilci ve asistan aynı kaydı görür.</p></div>';
      return html + agentsPanelHtml();
    }
    if (f.mode === "kya") {
      html += '<div class="era-agent">' + eraIcon("bag", "tone-red") + '<div><b>Alışveriş Ajanı · yeni alıcıya transfer</b><span>' + (k.stopped ? "Ödeme izni askıda" : "Kalkan bekletiyor · para çıkmadı") + '</span></div></div>' +
        '<p class="eyebrow guard-eyebrow">Güvenlik kalkanı · KYA denetimi</p><h3 id="future-era-title" tabindex="-1">130.000 TL transfer isteği durduruldu</h3>' +
        checksHtml("Kimlik doğru, yetki değil", [
          ["ok", "Kimlik", "Kayıtlı Alışveriş Ajanı · imza geçerli"],
          ["bad", "Yetki sınırı", "130.000 / 10.000 TL · 13 katı", limitMeterHtml(13000000, 1000000, true)],
          f.agents.askFirst ? ["bad", "Alıcı", "İlk kez görülen IBAN · geri alınamaz · sana sormadan gitmez"] : ["warn", "Alıcı", "İlk kez görülen IBAN · geri alınamaz · önce sor kuralın kapalı"],
          ["bad", "Komut kaynağı", "Web sayfası komutu · yönlendirme (prompt) şüphesi"]]) +
        "";
      var summaryBtn = '<button type="button" class="btn line-dark pill" id="future-kya-summary" data-guard-action="future-kya-summary" aria-expanded="' + String(k.summaryOpen) + '">' + (k.summaryOpen ? "KYA özetini gizle" : "Temsilci için kilitli KYA özeti göster") + '</button>';
      html += k.stopped ? sentText("130.000 TL durduruldu · Ajan izni askıya alındı") + '<p class="guard-copy">Paran hesabında güvende. Dış ajanın ödeme yetkisi sen yeniden açana kadar kapatıldı.</p><div class="guard-actions">' + summaryBtn + '</div>'
        : '<div class="guard-actions era-equal"><button type="button" class="btn line-dark pill" id="future-kya-stop" data-guard-action="future-kya-stop">Ajan yetkisini askıya al ve işlemi durdur</button>' + summaryBtn + '</div>';
      if (k.summaryOpen) html += '<div class="era-kya-summary"><p class="era-section-title">Temsilcinin göreceği KYA kaydı</p>' + rows([["İşlem", "130.000 TL · yeni alıcı IBAN · Alışveriş Ajanı isteği"], ["Durum", k.stopped ? "Durduruldu · ajan izni askıya alındı" : "Bekletiliyor · hesaptan para çıkmadı"], ["Yetki denetimi", "Ajan limiti 10.000 TL · istek 13 katı"], ["Bağlam işaretleri", "İlk kez görülen IBAN · web sayfası komutu şüphesi"], ["Kural", f.agents.askFirst ? "Geri alınamayan ödemede önce sor · açık" : "Geri alınamayan ödemede önce sor · kapalı"]]) + '<p class="agent-muted review-locked-note">Kayıt banka tarafından tutulur ve değiştirilemez. İnsan temsilci ve asistan aynı kaydı görür.</p></div>';
      return html + agentsPanelHtml();
    }
    // Rutin pay tamamlamayı Evre 2 kuralı zaten yapar; insana kalan soru iki hedefin hangisinin öncelikli olduğu.
    var travelOn = !!f.agents.travel, ruleOn = !!era.near.ruleBuffer, travel = b.choice === "travel";
    var titles = { "": "Bilet mi, bu ayki birikimin mi?", travel: ruleOn ? "Bilet alınır, bu ay 16.000 TL biriktirirsin" : "Bilet alınır, vadesizin 0 TL'ye iner", save: "Bilet alınmaz, birikim hedefin korunur" };
    html += '<div class="era-agent">' + eraIcon("plane", "tone-teal") + '<div><b>Seyahat Ajanı · uçak bileti</b><span>Ödeme günü 24 Ekim</span></div></div>' +
      (b.sent && !travel || presentation.kisa ? '' : priceWasHtml(b)) + '<p class="amount era-amount">28.000 TL</p><h3 id="future-era-title" tabindex="-1">' + titles[b.step === 2 || b.sent ? b.choice : ""] + '</h3>' +
      (b.priceOpen && !presentation.kisa && !(b.sent && !travel) ? priceHtml() : '');
    var summary = travel ? rows(ruleOn ? [["Ödeme gününde nereden", "ALE Fonu 28.000 TL"], ["Bu ay birikimin", "16.000 TL · hedef 28.000 TL düşer"], ["24 Ekim'de vadesiz", "20.000 TL · ödemelerin ve payın yerinde"]] : [["Ödeme gününde nereden", "Vadesiz 20.000 TL + ALE Fonu 8.000 TL"], ["Bu ay birikimin", "36.000 TL · hedef 8.000 TL düşer"], ["24 Ekim'de vadesiz", "0 TL · kalan ödemelerin ve payın karşılanmaz"]])
      : rows([["Seyahat Ajanı", "Bu bileti almaz · yeni bir seçenek bulursa yeniden sorar"], ["Bu ay birikimin", "44.000 TL · hedefin korunur"]]);
    if (b.sent) return html + summary + stepDots(2, 2, true) + sentText(travel ? "Bilete öncelik verildi · 28.000 TL" : "Birikimin korundu · bilet alınmadı") +
      (travel ? '<p class="agent-muted era-fine">Bu karar yalnız bu bilet için. Sonraki çatışmada yine sana sorarım.</p>'
        : '<button type="button" class="era-pref" id="future-pref-save" role="checkbox" data-guard-action="future-pref-save" aria-checked="' + String(!!f.agents.saveFirst) + '"><span class="era-pref-box" aria-hidden="true">' + (f.agents.saveFirst ? "✓" : "") + '</span><span>Gelecekteki benzer bütçe çatışmalarında birikim hedefimi otomatik koru</span></button>' +
          (f.agents.saveFirst ? '<p class="era-pref-done" role="status">✓ Tercihin kaydedildi · Ajan yetkilerinden dilediğinde değiştirebilirsin</p>' : '')) + agentsPanelHtml();
    if (b.step === 2) return html + summary + stepDots(2, 2) +
      '<div class="guard-actions"><button type="button" class="btn primary pill" id="future-budget-confirm" data-guard-action="future-budget-confirm">' + (travel ? "Bilete öncelik ver · onayla" : "Birikimimi koru · onayla") + '</button><button type="button" class="btn line-dark small pill" id="future-budget-back" data-guard-action="future-budget-back">Vazgeç</button></div>';
    return html + checksHtml(ruleOn ? "Kimlik, yetki ve pay uygun · hedeflerin çatışıyor" : "Kimlik ve yetki uygun · payın delinir", [
        ["ok", "Kimlik", "İmzalı istek", '<small class="era-verified">Visa Trusted Agent Protocol simülasyonu</small>'],
        f.agents.antiProfiling ? ["ok", "Fiyat kalkanı", "Bütçe tavanın ve kart türün paylaşılmadı", '<small class="era-verified">Kimliksiz sorgu · nötr BIN</small>'] : ["warn", "Fiyat kalkanı", "Kapalı · sonraki isteklerde satıcı profilini görür"],
        [travelOn ? "ok" : "bad", "Yetki sınırı", travelOn ? "28.000 / 30.000 TL" : "Ajan yetkin kapalı", travelOn ? limitMeterHtml(2800000, 3000000, false) : ""],
        ruleOn ? ["ok", "Güvenlik payı", "Kuralın korur · bilet fondan ödenir"] : ["warn", "Güvenlik payı", "Kuralın kapalı · 24 Ekim'de 0 TL kalır"],
        ["warn", "Birikim hedefi", "Bu ay 44.000 TL · bilet " + (ruleOn ? "16.000" : "36.000") + " TL'ye indirir"]], impactHtml(ruleOn)) +
      stepDots(1, 2) + '<div class="guard-actions era-equal"><button type="button" class="btn line-dark pill" id="future-budget-travel" data-guard-action="future-budget-travel"' + (travelOn ? '' : ' disabled') + '>Bilete öncelik ver</button><button type="button" class="btn line-dark pill" id="future-budget-save" data-guard-action="future-budget-save">Birikimimi koru</button></div>' + agentsPanelHtml();
  }
  // Tek düğüm, iki ekran: sekmede en üstte tam kart, ana sayfada bakiyenin altında kısa şerit. Kimlikler tekil kalır.
  function placeEraCard(id, pages) {
    var node = el(id), on = pages.includes(view.page);
    if (on) {
      var host = el(view.page + "-view"), anchor = view.page === "home" ? host.querySelector(".balance-card") : null;
      if (anchor ? anchor.nextElementSibling !== node : host.firstElementChild !== node) { if (anchor) anchor.after(node); else host.insertBefore(node, host.firstElementChild); }
    }
    return on;
  }
  // innerHTML yenilenince geçişler kaybolur: anahtar ve çubuk parçaları önceki hâliyle eklenir, bir kare sonra yeni hâline yumuşakça geçer.
  // Önceki değer HTML'e yazılır; eklendikten sonra yazılsaydı odak geri yükleme stili erken hesaplatıp ters yönde geçiş başlatıyordu.
  function setEraHtml(id, html) {
    var node = el(id), before = {};
    if (guardHtml[id] === html) return;
    node.querySelectorAll("[data-seg]").forEach(function (x) { before["seg:" + x.dataset.seg] = x.style.flexGrow; });
    node.querySelectorAll('[role="switch"]').forEach(function (x) { before["sw:" + x.dataset.guardAction] = x.getAttribute("aria-checked"); });
    var tpl = document.createElement("template"), moved = 0;
    tpl.innerHTML = html;
    tpl.content.querySelectorAll("[data-seg]").forEach(function (x) { var old = before["seg:" + x.dataset.seg]; if (old === undefined) return; x.classList.add("no-grow"); if (old !== x.dataset.grow) { x.style.flexGrow = old; moved++; } });
    tpl.content.querySelectorAll('[role="switch"]').forEach(function (x) { var old = before["sw:" + x.dataset.guardAction]; if (old !== undefined && old !== x.getAttribute("aria-checked")) { x.setAttribute("data-from", old); moved++; } });
    setGuardHtml(id, tpl.innerHTML); guardHtml[id] = html;
    if (!moved) return;
    var apply = function () {
      node.querySelectorAll("[data-seg]").forEach(function (x) { x.style.flexGrow = x.dataset.grow; });
      node.querySelectorAll("[data-from]").forEach(function (x) { x.removeAttribute("data-from"); });
    };
    if (window.requestAnimationFrame) requestAnimationFrame(function () { requestAnimationFrame(apply); }); else setTimeout(apply, 0);
  }
  function renderEra(s) {
    var nearOn = (era.era === "near" && placeEraCard("near-era-card", ["home", "savings"])) || (era.era === "future" && placeEraCard("near-era-card", ["savings"]));
    var futureOn = era.era === "future" && (!presentation.kisa || era.future.picked) && placeEraCard("future-era-card", ["home", "transfer"]);
    visible("near-era-card", nearOn); visible("future-era-card", futureOn);
    el("near-era-card").classList.toggle("is-teaser", view.page === "home"); el("future-era-card").classList.toggle("is-teaser", futureInbox());
    if (nearOn) setEraHtml("near-era-card", nearEraHtml(s));
    if (futureOn) setEraHtml("future-era-card", futureEraHtml(s));
    visible("era-dev-bar", era.barOpen);
    visible("era-dev-cooldown", era.era === "today" && !!s.shieldActive && !!s.shield.coolingUntil && s.now < s.shield.coolingUntil);
    // 26 Ekim · portföy sepeti: bugünkü evrede 5 yatırımlı senaryo; senaryodayken yarınki büyük ödeme bir kez eklenir. ↺ ana hikâyeye döner.
    visible("era-dev-portfolio", era.era === "today" && s.preset !== "portfolio");
    visible("era-dev-portfolio-need", era.era === "today" && s.preset === "portfolio" && !s.bank.payments.some(function (x) { return x.id === A.RULES.portfolio.needPayment.id; }));
    visible("era-dev-expense", era.era === "near" && era.near.cycleSent && era.near.ruleBuffer && !(s.forecast.shortfall > 0) && !era.near.sweep.sent && s.balances.cash - s.forecast.expected > 100000);
    document.querySelectorAll("[data-era-select]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.eraSelect === era.era)); });
    var avatar = document.querySelector(".top-nav .agent-avatar");
    if (era.era === "today") avatar.removeAttribute("data-era-active"); else avatar.dataset.eraActive = era.era;
    // Bugünkü öneri kartları gelecek evrelerde kuralın yerine geçmesin: aynı para iki yerde önerilmez.
    var offer = document.querySelector("#savings-view .card.offer"); if (offer) offer.hidden = era.era !== "today";
    // 27 Ekim · jüri canlı kısa: gelecek evrede o evrenin dokunmadığı her şey (deneme üyeliği, ay sonuna kadar grafiği, hızlı işlemler, boş sekmeler) CSS ile gizlenir.
    if (!presentation.kisa) return;
    if (era.era !== "today") document.documentElement.dataset.eraFocus = era.era; else delete document.documentElement.dataset.eraFocus;
    document.querySelectorAll("[data-kisa-scene]").forEach(function (b) { var on = String(b.dataset.kisaScene === kisaScene); if (b.getAttribute("aria-pressed") !== on) b.setAttribute("aria-pressed", on); });
    document.querySelectorAll("[data-kisa-group]").forEach(function (g) { g.classList.toggle("is-on", g.dataset.kisaGroup === era.era); });
    var box = el("kisa-start"), cfg = KISA_START[kisaScene], show = !!cfg && !kisaStarted;
    // 29 Ekim (sahip): başlatmadan önce eski ekran görünmesin. Uygulama ekranı boş kalır, yalnız yukarıyı gösteren ipucu.
    if (document.documentElement.dataset.kisaWait !== String(show)) document.documentElement.dataset.kisaWait = String(show);
    if (tour) { tourSnap = s; setTimeout(tourTick, 0); }
    if (box.hidden !== !show) box.hidden = !show;
    var key = kisaScene + ":" + Object.keys(kisaDone).sort().join(",") + ":" + kisaStartError;
    if (show && box.dataset.key !== key) { box.dataset.key = key; box.dataset.era = era.era; box.innerHTML = kisaStartHtml(cfg); }
    if (!show) box.dataset.key = "";
    document.querySelectorAll("[data-kisa-scene]").forEach(function (b) { b.classList.toggle("is-done", !!kisaDone[b.dataset.kisaScene]); });
  }
  var ERA_STORY = {
    near: { eyebrow: "Evre 2 · Yakın gelecek", title: "Onaylayan müşteriden yetkilendiren müşteriye", copy: "Kullanıcı her işlem türünün sınırını kendisi çizer. Kural kendiliğinden genişlemez. Her biri ayrı açılıp kapanır. Döngüyü onaylayınca tutar demo motorunda gerçekten ALE fonuna geçer, geri al ile döner.",
      steps: ["Ana sayfadaki şeride dokun: Birikim'de kuralların açılır.", "Bir kuralı kapat. Paranın yolu çubuğunun değiştiğini göster.", "Döngüyü önizle, onayla, sonra geri alınabildiğini göster.", "Gizli çubukta ₺↓ ile ay içi gider: pay kuralı eksik kısmı fondan tamamlamayı hazırlar. Uygula ya da bu kez atla."] },
    future: { eyebrow: "Evre 3 · Ajanlar çağı (vizyon)", title: "Yetkilendiren müşteriden hedef ve yetki yöneten müşteriye", copy: "Rutin işleri (güvenlik payını fondan tamamlamak gibi) Evre 2 kuralları kendisi yapar. İnsana yalnız iki soru kalır: iki hedef çatışınca hangisi öncelikli ve bir ajanın yetkisi sürmeli mi. Doğrulanmış kimlik tek başına güvenli işlem demek değildir.",
      steps: ["Ana sayfada üç ajan isteğini göster.", "Seyahat ajanı: tutarın üstündeki çizili 29.900 TL, satıcının seni tanıyınca verdiği fiyat. Fiyat kalkanı kimliksiz sorguyla 28.000 TL'yi kilitledi (çipe dokun: aynı bilet, iki sorgu). Sonra asıl soru: bilet mi, bu ayki birikim mi?", "Alışveriş ajanı: kimlik doğru, yetki 13 kat aşılmış. Kalkan durdurur, temsilci kilitli kaydı görür.", "Satıcı ajanı: senin ajanın ve yetkin doğru, karşı tarafın sertifikası uyuşmuyor. Kalkan engeller, para çıkmaz."] }
  };
  function renderEraStory() {
    var story = el("era-story"), base = document.querySelector("#trace .demo-story:not(.era-story)");
    if (!story || !base) return;
    base.hidden = era.era !== "today"; story.hidden = era.era === "today";
    if (era.era === "today" || story.dataset.era === era.era) return;
    var d = ERA_STORY[era.era], ev = A.EVIDENCE.kontrol;
    story.dataset.era = era.era;
    story.innerHTML = '<p class="eyebrow">' + d.eyebrow + '</p><h3>' + d.title + '</h3><p>' + d.copy + '</p><ol class="demo-story-steps">' + d.steps.map(function (x) { return '<li>' + A.escape(x) + '</li>'; }).join("") + '</ol>' +
      (era.era === "near" ? '<p class="agent-muted">Dayanak: ' + ev.n + '/' + A.N + ' görüşmede "karar ve kontrol bende kalsın". Accenture Consumer Pulse 2026: tam otonom alışverişe açık olduğunu beyan edenler %9. Bu bir beyan, gerçekleşmiş banka yetkisi değil.</p>' + sourceLink("https://www.accenture.com/en/insights/consulting/talk-my-ai-agent", "Accenture · Consumer Pulse 2026")
        : '<p class="agent-muted">Kurgusal simülasyon: gerçek ajan, kart ağı veya yapay zekâ modeli bağlantısı yok. Teknik dayanak Visa Trusted Agent Protocol (imza, geçerlilik süresi, tekrar kullanım kontrolü). Bütçe kapısı bu dokümandan türetilen tasarım önerisidir. Örnek pilot: Santander ve Mastercard, Mart 2026, kontrollü canlı ajan ödemesi (ticari yayılım değil).</p>' +
          '<p class="agent-muted">Fiyat kalkanı da tasarım önerisidir: banka satıcıya giden sinyali (bütçe tavanı, kart türü, PAR) azaltır, satıcının fiyatı nasıl kurduğunu doğrulayamaz. Dayanak: FTC ara bulguları, Ocak 2025 (kişisel veriyle kişiye özel fiyat). Consumer Reports ve Groundwork, Aralık 2025: Instacart\'ta aynı mağazada ürünlerin %74\'ü farklı kullanıcılara farklı fiyatla gösterildi (şirkete göre rastgele test).</p>' +
          sourceLink("https://developer.visa.com/docs/trusted-agent-protocol", "Visa · Trusted Agent Protocol") + ' ' + sourceLink("https://www.santander.com/en/press-room/press-releases/2026/03/santander-and-mastercard-complete-europes-first-live-end-to-end-payment-executed-by-an-ai-agent", "Santander · Mart 2026 pilotu") + ' ' +
          sourceLink("https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-surveillance-pricing-study-indicates-wide-range-personal-data-used-set-individualized-consumer", "FTC · Ocak 2025") + ' ' + sourceLink("https://groundworkcollaborative.org/work/instacart", "Groundwork · Aralık 2025"));
  }
  function setEra(next) {
    if (!["today", "near", "future"].includes(next)) return;
    // Kısa sürümde Alt+1/2/3 evrenin ilk sahnesini açar; seçici ile sunucu aynı yerde kalır.
    if (presentation.kisa) { openScene({ today: "birikim", near: "kurallar", future: "ajanlar" }[next]); return; }
    era.era = next; era.barOpen = false; eraSay("");
    // Seçilen evrenin kartı bu sayfada yoksa ana sayfaya dön; şerit orada bakiyenin altında.
    var pages = { today: null, near: ["home", "savings"], future: ["home", "transfer", "savings"] }[next];
    if (pages && !pages.includes(view.page)) go("home"); else render(A.agent.getSnapshot());
    el("screen").scrollTop = 0;
  }
  // Sahne her açılışta (aynı sahneye yeniden dokununca da) baştan başlar: jüri sunucuyla aynı ekranı görür.
  // Hata olursa sahnenin sayfası yine açılır ve neden üst mesajda söylenir; seçici ile ekran ayrışmaz, söz yakalanmamış kalmaz.
  async function openScene(id, auto) {
    var sc = KISA_SCENES.find(function (x) { return x.id === id; }) || KISA_SCENES[0];
    ++sceneSerial; kisaScene = sc.id; era.era = sc.era; kisaStarted = false; kisaStartError = ""; tourEnd();
    el("screen").classList.remove("is-shock");
    reset(SCENARIO_PRESET[sc.scenario]);
    go(KISA_START[sc.id].page); el("screen").scrollTop = 0;
    eraSplash(sc.era);
    if (auto) await startCase(auto);
  }
  // Başlatılınca vaka uygulamanın kendi akışıyla gelir: ekstre kesilir, dolandırıcı arar (form dolu, kalkan "Devam et"le), ajan isteği gelir.
  async function startCase(caseId) {
    var sc = KISA_SCENES.find(function (x) { return x.id === kisaScene; }), token = sceneSerial, made = { ok: true };
    if (!sc || kisaStarted) return;
    kisaStarted = true; kisaStartError = ""; hideSplash();
    if (sc.era === "future") { era.future.mode = caseId; era.future.picked = true; openEraCard("transfer", "future-era-title"); tourStart(caseId); return; }
    // Motor olayı olmayan sahneler (Birikim, Kurallar): ekran açılır, tur başlar.
    if (!sc.scenario) { render(A.agent.getSnapshot()); tourStart(sc.id); return; }
    try { made = await command(sc.amount ? { type: "event", event: sc.scenario, amount: sc.amount } : { type: "event", event: sc.before || sc.scenario, device: sc.device }); }
    catch (e) { made = { ok: false, reason: e && e.message }; }
    if (token !== sceneSerial) return;
    go(SCENARIO_PAGE[sc.scenario]);
    // Başlamazsa ekran yine boş bekler; neden başlatma kartında ve üst mesajda görünür (boş ekran mesajı gizlemesin).
    if (!made.ok) { kisaStarted = false; kisaStartError = plainReason(made.reason) || "Bu sahne şu an açılamadı. Sahneye yeniden dokun."; formError(kisaStartError); render(A.agent.getSnapshot()); return; }
    // 5 Kasım (sahip): Kalkan da bir şok anıyla açılır (Birikim'deki beklenmedik masraf gibi): ekran sarsılır, sonra turun ünlemli balonu "112 arıyor".
    if (sc.before) { prefillScam(made.scam); await kisaShock(); if (token !== sceneSerial) return; tourStart(sc.id); return; }
    // Jüri sunucuyla aynı ekranı görür: sayfa en üstten açılır, karar kartının başlığı kaydırmadan odak alır.
    focusScenario(sc.scenario, false); tourStart(sc.id);
  }
  // 29 Ekim (sahip): "kullanıcıyı çok özgür bırakıyoruz". Vaka başlayınca yeni uygulama turu gibi rehber: uygulama ekranı kararır, yalnız sıradaki öğe açık,
  // balon ne olduğunu söyler. Dokununca sonraki adım belirir. "Hepsini geç" turu kapatır. Sahne seçici kararmaz, sunucu her an sahne değiştirebilir.
  // Adım: sel (bir ya da birkaç öğe; birkaç öğede kapsayan alan), text, next (İleri düğmesi), until (koşul sağlanınca kendiliğinden ilerler).
  // after: koşul sağlanınca ilerlemez. Dokunuşun sonucu aydınlık alanda kalır, balonda `after` yazar, İleri ile devam edilir (sahip, 5 Kasım: "dokununca ne olduğunu göremiyor").
  var tour = null, tourTimer = 0, tourSnap = null;
  var ctxBusy = false, ctxShownAt = 0;
  function answerGuardMs() { return Math.max(0, Number(A.CONFIG.answerGuardMs === undefined ? 500 : A.CONFIG.answerGuardMs)); }
  function q(sel) { return document.querySelector(sel); }
  function stackLvl(prefix) { var m = 0, r = view.riskLevel || {}; Object.keys(r).forEach(function (k) { if (k.indexOf(prefix) === 0) m = Math.max(m, r[k] || 0); }); return m; }
  function cardFormOpen() { return !el("card-savings-form").hidden; }
  // Kişi payı çok yükseltince ayrılacak tutar kalmayabilir: tur onay adımlarını atlar, kilitlenmez.
  function noSaveOffer() { return !(A.agent.getSnapshot().forecast.available > 0); }
  function ruleRow(attr) { var sw = q('#future-era-card [data-agent="' + attr + '"]'); return sw ? [sw.closest(".era-rule")] : []; }
  // Sonraki sahne adımı: uygulama ekranı tamamen kararır, üstteki sahne düğmesi halkayla parlar. Ajanlarda sıradaki ajan senaryosu.
  function nextStep(scene, say) {
    if (scene in AGENT_CASES) return { nav: function () { return agentNext() ? '[data-kisa-scene="ajanlar"]' : null; }, contact: function () { return !agentNext(); }, next: true,
      text: function () { var n = agentNext(); return n ? "Sıradaki ajan senaryosu: " + AGENT_CASES[n].title + ". Üstte Ajanlar'a dokun." : "Üç ajan senaryosunu da gördün. Tebrikler, tur bitti."; } };
    var to = KISA_NEXT[scene], sc = KISA_SCENES.find(function (x) { return x.id === to; });
    return { nav: '[data-kisa-scene="' + to + '"]', next: true, text: say || "Sıradaki: " + sc.label + ({ kurallar: " · yakın gelecek", ajanlar: " · ajanlar çağı" }[to] || "") + ". Üstte " + { kalkan: "Kalkan'a", kurallar: "Kurallar'a", ajanlar: "Ajanlar'a" }[to] + " dokun." };
  }
  function agentNext() { return ["budget", "kya", "spoof"].find(function (m) { return !kisaDone[m]; }) || null; }
  function shieldAnswers() { var sh = (tourSnap || A.agent.getSnapshot()).shield; return sh && sh.answers || {}; }
  // 5 Kasım (kod incelemesi): tutar değiştirilip kalkan açılmazsa tur "transfer gönderilmedi" demez. Gerçek durumu söyler, kalkan adımları atlanır.
  function ctxShieldOn() { var s = A.agent.getSnapshot(); return !!(s.shield && s.shield.flow === "context" && (s.shieldActive || s.shield.status === "cancelled")); }
  function noCtxShield() { return !ctxShieldOn(); }
  function plainDraft() { var p = A.agent.getSnapshot().plans.transfer; return !!(p && p.kind === "payee-transfer") && !ctxShieldOn(); }
  var TOURS = {
    // 5 Kasım (sahip): kısa ve slogan gibi. Kart ekstresi baştan hesapta (faiz adımı başta). Şok anı dışarıdan gelen hastane masrafı:
    // ekran sarsılır, kırmızı ünlemli uyarı, öneri güncellenir, 7/24 güvencesi, ayır, son karar, onay.
    birikim: [
      { sel: ".balance-card", text: "Hesabın tek bakışta. Renkler paranın yolunu gösterir.", next: true },
      { sel: "#card-due-guard article", text: "Senin için faiz hesaplandı. Farkı tek bakışta gör.", next: true },
      { sel: "#home-nudge", tap: "#home-nudge-open", text: "Sana bir önerim var.", until: function () { return view.page === "savings"; } },
      { sel: "#card-note-savings .money-stack", tap: "#card-note-savings .money-stack [data-risk-stack]", text: "Paranın yolu. Dokun, tutarlar açılsın.", until: function () { return stackLvl("savings-why") >= 1; } },
      { sel: "#card-note-savings .money-stack", tap: "#card-note-savings .money-stack [data-risk-stack]", text: "Bir daha dokun, nedenini kısaca okusun.", until: function () { return stackLvl("savings-why") >= 2; } },
      { sel: "#card-note-savings .money-stack", text: "Kısa, öz, anlaşılır.", next: true, run: function () { return tourShock(); } },
      // Şok anı meta uyarı olarak turun balonunda: kırmızı ünlem, başlık ve slogan. Uygulamada yalnız bakiye kartı aydınlık (para hesaptan çıktı).
      { sel: ".balance-card", shock: true, head: function () { var k = view.kisaShock; return "Beklenmedik " + (k ? k.label.toLocaleLowerCase("tr-TR") + ": " + A.money(k.amount) : "masraf"); }, text: "Panik yok, plan var.", next: true },
      { sel: "#home-nudge", tap: "#home-nudge-open", text: "Senin için birikimin güncellendi.", until: function () { return view.page === "savings"; } },
      { sel: "#card-redeem-savings", text: "Paniğe gerek yok. Acil bir durumda birikimini 7/24 anında geri alırsın.", next: true },
      // 9 Kasım (görüşme + sahip): öneri nedeniyle görüldükten sonra kişi tutarı ve payı tur içinde değiştirebilir. Tur seçtiği sayıyla sürer.
      { sel: function () { return cardFormOpen() ? [q("#card-savings-form")] : [q("#card-note-savings .money-stack"), q("#edit-savings")]; },
        free: function () { return [q(cardFormOpen() ? "#card-savings-form" : "#edit-savings")]; }, text: "Nedenini gördün. İstersen değiştir.", next: true,
        run: async function () { if (cardFormOpen()) { await saveCardEdit(); el("card-savings-form").hidden = true; fitCard(); } } },
      { skip: noSaveOffer, sel: '[data-open="0"]', text: "Birikimini ayır, keyfini çıkar.", until: function () { return view.page === "detail"; } },
      { skip: noSaveOffer, sel: "#current-plan", text: "Son karar sende. Basit, anlaşılır.", next: true },
      { skip: noSaveOffer, sel: "#approve-plan", text: "Onayla.", until: function () { return !el("task-receipt").hidden; } },
      nextStep("birikim", "Sıradaki işlem: Kalkan.")
    ],
    kalkan: [
      // 5 Kasım (sahip): Kalkan turu kısa ve slogan gibi; 1. adım meta şok sahnesi (turun balonu, uygulama içi uyarı değil).
      // 5 Kasım (fraud uzmanı): arama başka telefonda, uygulama aramayı görmez. Puan öğretilmez: zorunlu üç dokunuş ve "Puan eşiği" adımı yok.
      // Yol: şüpheli transfer → bir anda tek soru (ikincisi yalnız "Evet"te) → sonuç → kısa gerekçe → bu transferi iptal et → özet → not → sıradaki. Adım sayısı koddan.
      { sel: "#nt-amount", shock: true, head: "“112'den arıyoruz. Acil para göndermen lazım!”", text: "Arama başka telefonda. Dolandırıcılık ağındasın, panik hakim.", next: true },
      { sel: '#new-transfer-form button[type="submit"]', text: "Arayan bu parayı göndermeni bekliyor. Devam et'e bas.", until: function () { return !!q("#scam-shield article") || plainDraft(); } },
      { sel: function () { return ctxShieldOn() ? [q("#scam-shield .guard-eyebrow"), q("#scam-shield .guard-state")] : [q("article.payee-review") || q("#agent-message")]; },
        text: function () { if (ctxShieldOn()) return "Kalkan devrede. Para hesabında, transfer gönderilmedi."; var p = A.agent.getSnapshot().plans.transfer; return p && p.status === "succeeded" ? "Para gönderildi. Kalkan bu tutarda açılmadı." : "Bu tutarda kalkan açılmadı. Karar sende."; }, next: true },
      { skip: noCtxShield, sel: "#scam-shield .guard-question", tap: "#scam-shield .guard-answer-row", text: "Tek bir soru, bir nefes. Panik dağılır.", until: function () { return !!shieldAnswers().directed; } },
      { skip: function () { return noCtxShield() || shieldAnswers().directed !== "yes"; }, sel: "#scam-shield .guard-question", tap: "#scam-shield .guard-answer-row", text: "Bir soru daha, o kadar.", until: function () { return !!shieldAnswers().secrecy; } },
      // 19 Kasım: üçüncü soru (his) yalnız şüphe sürerse: telefon "Evet" ve gizlilik "Evet" değilse ya da telefon "Emin değilim".
      { skip: function () { var x = shieldAnswers(); return noCtxShield() || !((x.directed === "yes" && x.secrecy && x.secrecy !== "yes") || x.directed === "unsure"); }, sel: "#scam-shield .guard-question", tap: "#scam-shield .guard-answer-row", text: "Son bir soru: nasıl hissediyorsun?", until: function () { return !!shieldAnswers().feeling; } },
      { skip: noCtxShield, sel: ["#scam-shield .guard-state", "#shield-outcome"], text: function () { return { stop: shieldAnswers().secrecy === "yes" ? "Gizlilik isteği var. Transfer durdu." : "Kontrolün dışında hissediyorsun. Transfer durdu.", verify: "Doğrulama gerekiyor. Uygulamadan gitmez.", approve: "Cevabın kaydedildi. Karar yine sende." }[(tourSnap || A.agent.getSnapshot()).shieldOutcome] || "Cevabın kaydedildi."; }, next: true },
      { skip: noCtxShield, sel: "#scam-shield .shield-why", tap: "#scam-shield [data-risk-stack]", text: "Belirsizlik yok. Dokun, nedenini gör.", until: function () { return stackLvl("shield:") >= 1; } },
      { skip: noCtxShield, sel: "#scam-shield .shield-why", tap: "#scam-shield [data-risk-stack]", text: "Hüküm değil, bağlam. İstersen bir daha dokun.", after: "Hüküm değil, bağlam.", next: true, until: function () { return stackLvl("shield:") >= 2; } },
      { skip: noCtxShield, sel: '[data-guard-action="shield-cancel"]', text: "Kontrol sende. Bu transferi iptal et.", until: function () { var sh = (tourSnap || A.agent.getSnapshot()).shield; return !!sh && sh.status === "cancelled"; } },
      { skip: noCtxShield, sel: '[data-guard-action="shield-review"]', text: "Döngüde hep bir insan var. Temsilci özetini aç.", until: function () { return !el("shield-review-panel").hidden; } },
      { skip: noCtxShield, sel: "#shield-review-edit > summary", text: "İstersen kendi notunu da ekle. Temsilci onu senin notun olarak görür.", next: true, until: function () { return el("shield-review-edit").open; } },
      nextStep("kalkan")
    ],
    kurallar: [
      { sel: "#near-era-card .era-rules", text: "Kuralları ajan önerir, sen açarsın. Her biri tek dokunuşla açılır, kapanır.", next: true },
      { sel: "#near-cycle-prepare", text: "Ay hazır. Önizle.", until: function () { return !!q("#near-cycle-confirm"); } },
      { sel: "#near-era-card .era-timeline", text: "Birikim fona, ödemeler vadesizden, pay hep yerinde.", next: true },
      { sel: "#near-cycle-confirm", text: "Kuralın içinde, tek onay.", until: function () { return era.near.cycleSent; } },
      // Ay içi gider eskiden yalnız gizli ₺↓ düğmesindeydi; turda hikâyenin parçası.
      // 5 Kasım (sahip: diğer rehberler de aynı şekilde): ay içi gider Birikim'deki gibi meta şok anı. Döngü kurulunca İleri, ekran sarsılır,
      // turun ünlemli balonu masrafı adıyla söyler, slogan "Panik yok, kuralın var.". Uygulamada pay kuralının tamamlama kartı aydınlık.
      { sel: "#near-era-card", text: "Döngü kuruldu. Ay yolunda.", next: true,
        run: function () { var before = A.agent.getSnapshot().balances.cash; return nearExpense().then(function (r) { if (!r.ok) return r; era.near.shock = before - A.agent.getSnapshot().balances.cash; return kisaShock(); }); } },
      { sel: "#near-sweep", shock: true, head: function () { return "Beklenmedik araç tamiri" + (era.near.shock ? ": " + A.money(era.near.shock) : ""); }, text: "Panik yok, kuralın var.", next: true },
      { sel: "#near-sweep-confirm", text: "Payını fondan tamamla.", until: function () { return !!era.near.sweep.sent; } },
      nextStep("kurallar")
    ],
    // 5 Kasım (sahip): balon uygulamanın ne yaptığını anlatır (meta), vakanın rakamlarını değil. Hikâye tek yönde: ajan bilet buldu →
    // fiyat kalkanı fiyatı korudu → ajan birikim planına da bakar → karar sende → önce sonucu gör, sonra onayla.
    budget: [
      { sel: ["#future-era-card .era-agent", "#future-era-card .era-amount"], text: "Ajanın senin için bilet buldu. Sana sormadan ödemez.", next: true },
      // 18 Kasım (sahip): kısa akışta fiyat farkı rakamı yok (ölçülmemiş tasarruf gibi okunuyordu); ilke KYA satırında "paylaşılmadı" olarak kalır.
      { sel: "#future-era-card .era-checks .era-impact", text: "Ajan fiyata da bakar, birikim planına da.", next: true },
      { sel: "#future-era-card .guard-actions.era-equal", text: "Bilet mi, birikim mi? Karar sende.", until: function () { return era.future.budget.step === 2; } },
      { sel: ["#future-era-card .rows", "#future-era-card .guard-actions"], tap: "#future-budget-confirm", text: "Önce sonucu gör, sonra onayla.", until: function () { return era.future.budget.sent; } },
      { sel: "#future-era-card .era-agents > summary", text: "Kontrol sende. Yetkilere bak.", until: function () { return era.future.agentsOpen; } },
      { sel: function () { return ruleRow("antiProfiling"); }, text: "Fiyat kalkanı hep açık. Anahtar sende.", next: true },
      nextStep("budget")
    ],
    kya: [
      { sel: "#future-era-card .era-checks", text: "Kimlik doğru, yetki aşılmış. Kalkan durdurdu.", next: true },
      { sel: "#future-kya-stop", text: "Şüphe varsa dur. Ajanı askıya al.", until: function () { return era.future.kya.stopped; } },
      { sel: ["#future-era-card .approve-sent", "#future-kya-summary", "#future-era-card .era-kya-summary"], tap: "#future-kya-summary", text: "Döngüde hep bir insan var. Kaydı aç.", after: "Döngüde hep bir insan var.", until: function () { return era.future.kya.summaryOpen; } },
      { sel: "#future-era-card .era-agents > summary", text: "Kontrol sende. Yetkilere bak.", until: function () { return era.future.agentsOpen; } },
      { sel: function () { return ruleRow("shop"); }, text: "İzin askıda. Açmak yalnız senin elinde.", next: true },
      // feyz-2: "önce sor" kuralı IBAN'lı sahnenin kuralıdır. Satıcı sahnesi kartla ödemedir ve kimlik uyuşmazlığında durur.
      { sel: function () { return ruleRow("askFirst"); }, text: "Geri gelmeyecek para sana sormadan gitmez.", next: true },
      nextStep("kya")
    ],
    spoof: [
      // 5 Kasım (fraud uzmanı): doğrulanabilen durum anlatılır, kesin "sahte" hükmü verilmez.
      { sel: "#future-era-card .era-checks", text: "Senin ajanın doğrulandı. Satıcının kimliği doğrulanamadı.", next: true },
      { sel: "#future-spoof-stop", text: "Satıcı doğrulanamadı. Ödeme yapılmadı. İptal et.", until: function () { return era.future.spoof.stopped; } },
      { sel: ["#future-era-card .approve-sent", "#future-spoof-summary", "#future-era-card .era-kya-summary"], tap: "#future-spoof-summary", text: "Her adım kayıtlı. Kaydı aç.", after: "Her adım kayıtlı.", until: function () { return era.future.spoof.summaryOpen; } },
      { sel: "#future-era-card .era-agents > summary", text: "Kontrol sende. Yetkilere bak.", until: function () { return era.future.agentsOpen; } },
      { sel: function () { return ruleRow("shop"); }, text: "İptal ajanını kapatmadı. Yetki yine sende.", next: true },
      nextStep("spoof")
    ]
  };
  function tourEls(step) {
    if (typeof step.sel === "function") return step.sel().filter(Boolean);
    return [].concat(step.sel || []).map(q).filter(Boolean);
  }
  // 18 Kasım (sahip): jüri canlı kısa sürümünde birikim ürünü genel adla, "birikim hesabı". Sunum varsayılanı günlük faizli
  // mevduat diyor, ekranda belirli bir fon (ALE) görünmesin. Yalnız metin; motor, tutarlar ve varsayılan jüri görünümü aynı.
  var KISA_COPY = [
    [/^Örnek fon: .+$/, "Birikim hesabın"],
    [/Kalanı ALE fonuna/g, "Kalanı birikim hesabına"], [/sınırına kadar ALE fonuna ayır/g, "sınırına kadar birikim hesabına ayır"],
    [/kurallarınla ALE fonuna ayrıldı/g, "kurallarınla birikim hesabına ayrıldı"], [/ ALE fonuna geçer/g, " birikim hesabına geçer"],
    [/ALE fonundan vadesize/g, "birikim hesabından vadesize"], [/^ALE fonuna$/, "Birikim hesabına"], [/ALE Fonu /g, "Birikim hesabı "],
    [/Birikim fonuna aktarıldı/g, "Birikim hesabına aktarıldı"], [/Birikim fonundan vadesize/g, "Birikim hesabından vadesize"],
    [/Birikim fonun\b/g, "Birikim hesabın"], [/ fonuna eklendi\./g, " birikim hesabına eklendi."], [/^Fonunda şimdi/, "Birikim hesabında şimdi"],
    [/Birikim \(fon\):/g, "Birikim:"], [/Birikim fona, /g, "Kalan birikime, "], [/Fon bakiyende/g, "Birikim bakiyende"],
    [/eksik kısım fondan/g, "eksik kısım birikimden"], [/eksik kısmı fondan/g, "eksik kısmı birikimden"], [/^Fondan /, "Birikimden "],
    [/Payını fondan/g, "Payını birikimden"], [/bilet fondan ödenir/g, "bilet birikimden ödenir"], [/İstersen fondan/g, "İstersen birikimden"],
    [/(’s[iı]|’y[iı]) fonundan/g, "$1 birikiminden"], [/Fona para ayrılmaz/g, "Birikime para ayrılmaz"], [/ fona ekle/g, " birikime ekle"]
  ];
  function kisaCopy() {
    if (!presentation.kisa) return;
    var fix = function (v) { return KISA_COPY.reduce(function (t, r) { return t.replace(r[0], r[1]); }, v); };
    [el("phone"), el("tour")].forEach(function (root) {
      if (!root) return;
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) { var t = fix(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
      root.querySelectorAll("[aria-label]").forEach(function (e) { var a = e.getAttribute("aria-label"), b = fix(a); if (b !== a) e.setAttribute("aria-label", b); });
    });
  }
  function tourStart(key) {
    if (!TOURS[key] || !el("tour")) return;
    tour = { key: key, i: 0, scrolled: -1, fit: -1, missing: 0 }; el("tour").hidden = false; headInert(true); tourShow();
    clearInterval(tourTimer); tourTimer = setInterval(tourTick, 1000);
  }
  function tourEnd() { tour = null; clearInterval(tourTimer); if (el("tour")) el("tour").hidden = true; headInert(false); tourNav(null); }
  // Tur sürerken başlığın düğmeleri (geri, asistan) turu yoldan çıkarmasın; aynı yüzeydeki sahne seçici her an kullanılabilir kalır.
  function headInert(on) { var tn = document.querySelector("#kisa-head .top-nav"); if (tn) { tn.inert = on; if (on) tn.setAttribute("inert", ""); else tn.removeAttribute("inert"); } }
  function tourNav(sel) { document.querySelectorAll(".is-tour-next").forEach(function (x) { x.classList.remove("is-tour-next"); }); var b = sel && q(sel); if (b) b.classList.add("is-tour-next"); }
  async function tourNext() {
    if (!tour) return;
    var steps = TOURS[tour.key], step = steps[tour.i], key = tour.key;
    if (step.run) { await step.run(); if (!tour || tour.key !== key) return; }
    if (tour.i >= steps.length - 1) { tourEnd(); return; }
    tour.i++; tour.scrolled = -1; tour.fit = -1; tour.missing = 0; tour.held = false;
    // Koşullu adım (Kalkan'daki ikinci soru yalnız "Evet"te): koşul tutmuyorsa atlanır, sayaç toplamı değişmez.
    while (steps[tour.i].skip && steps[tour.i].skip() && tour.i < steps.length - 1) tour.i++;
    // Sonraki-sahne adımına gelindiyse bu sahne (ya da ajan senaryosu) bitti sayılır.
    if (steps[tour.i].nav) { kisaDone[key] = true; if (key in AGENT_CASES && !agentNext()) kisaDone.ajanlar = true; render(A.agent.getSnapshot()); }
    tourShow();
  }
  function tourShow() {
    var steps = TOURS[tour.key], step = steps[tour.i], last = tour.i === steps.length - 1, tip = el("tour-tip");
    el("tour-count").textContent = (tour.i + 1) + " / " + steps.length;
    var say = tour.held && step.after ? step.after : step.text;
    el("tour-text").textContent = typeof say === "function" ? say() : say;
    var head = typeof step.head === "function" ? step.head() : step.head || "";
    el("tour-head").textContent = head; el("tour-head").hidden = !head; tip.classList.toggle("is-shock", !!step.shock);
    var contact = !!(step.contact && step.contact());
    el("tour-contact").hidden = !contact;
    el("tour-skip").hidden = contact;
    tip.classList.toggle("has-contact", contact);
    kisaCopy();
    if (A.applyIndependentBrand) A.applyIndependentBrand();
    el("tour-next").hidden = !(step.next || tour.held); el("tour-next").textContent = last ? "Bitir" : "İleri";
    tip.classList.remove("is-in"); void tip.offsetWidth; tip.classList.add("is-in");
    el("tour-spot").classList.toggle("is-tap", !!step.free || !!step.until && !tour.held);
    tourNav(step.nav ? (typeof step.nav === "function" ? step.nav() : step.nav) : null);
    tourPlace(); setTimeout(tourPlace, 160); setTimeout(tourPlace, 480);
    if (contact) el("tour-contact-link").focus({ preventScroll: true });
    else if (step.next || tour.held) el("tour-next").focus({ preventScroll: true });
    else { var tg = tourFocusables()[0]; if (tg) tg.focus({ preventScroll: true }); }
  }
  // Bilgi adımında (İleri) aydınlık alan da dokunmaya kapalı; dokunma adımında yalnız `tap` öğesi (yoksa aydınlık öğe) açık.
  function tourTap(step) { if (step.free) return step.free().filter(Boolean); return !step.until || step.nav || tour.held ? [] : step.tap ? [q(step.tap)].filter(Boolean) : tourEls(step); }
  function shown(x) { return !!x && !x.closest("[hidden]"); }
  function tourFocusables() {
    var step = TOURS[tour.key][tour.i], pick = "button:not([disabled]),[href],input,summary,textarea,[tabindex]:not([tabindex='-1'])";
    var inHole = tourTap(step).map(function (x) { return x.matches(pick) ? [x] : [].slice.call(x.querySelectorAll(pick)); }).reduce(function (a, b) { return a.concat(b); }, []);
    var tipButtons = ["tour-contact-link", "tour-next", "tour-skip"].map(el).filter(function (x) { return x && shown(x); });
    return inHole.filter(shown).concat(tipButtons, [].slice.call(document.querySelectorAll("[data-kisa-scene]")));
  }
  function tourTick() {
    if (!tour) return;
    var step = TOURS[tour.key][tour.i];
    if (step.until && step.until()) {
      if (!step.after) { tourNext(); return; }
      if (!tour.held) { tour.held = true; tour.scrolled = -1; tour.fit = -1; tourShow(); return; }
    }
    // Dokunma adımının hedefi 2 sn ortada yoksa (beklenmedik yol) tur kilitlenmesin: İleri belirir.
    if (step.until && !step.nav) {
      if (tourEls(step).some(shown)) tour.missing = 0; else if (!tour.missing) { tour.missing = Date.now(); setTimeout(tourTick, 2050); }
      if (tour.missing && Date.now() - tour.missing >= 2000 && el("tour-next").hidden) { el("tour-next").hidden = false; el("tour-next").textContent = "İleri"; }
    }
    // Durumdan okunan balon metni adım içinde de güncel kalır (ör. para gönderildiyse "gönderilmedi" yazmaz).
    var say = tour.held && step.after ? step.after : step.text;
    if (typeof say === "function") { var now = say(); if (el("tour-text").textContent !== now) el("tour-text").textContent = now; }
    tourPlace();
  }
  function tourPlace() {
    if (!tour) return;
    var box = el("tour"), scr = el("screen").getBoundingClientRect(), step = TOURS[tour.key][tour.i];
    box.style.top = scr.top + "px"; box.style.left = scr.left + "px"; box.style.width = scr.width + "px"; box.style.height = scr.height + "px";
    var rs = step.nav ? [] : tourEls(step).filter(function (x) { return x.getClientRects().length; }).map(function (x) { return x.getBoundingClientRect(); });
    var spot = el("tour-spot"), tip = el("tour-tip"), W = scr.width, H = scr.height, tipH = tip.offsetHeight || 120;
    box.classList.toggle("is-wait", !rs.length);
    var r = rs.length ? { top: Math.min.apply(null, rs.map(function (x) { return x.top; })) - scr.top - 6, left: Math.min.apply(null, rs.map(function (x) { return x.left; })) - scr.left - 6,
      bottom: Math.max.apply(null, rs.map(function (x) { return x.bottom; })) - scr.top + 6, right: Math.max.apply(null, rs.map(function (x) { return x.right; })) - scr.left + 6 } : { top: H, left: 0, bottom: H, right: 0 };
    // Hedef görünmüyorsa adım başına bir kez ortaya kaydır; kaydırma bitince sonraki tıkta yerleşir.
    // 5 Kasım: yapışkan arama şeridi hedefin üstünü örtüyorsa hedef görünmüyor sayılır (Kalkan 9. adımda "İşlemi durdur" şeridin altında kalıp dokunulamıyordu).
    var cb = el("call-banner"), cover = cb && cb.getClientRects().length && !tourEls(step).some(function (x) { return x === cb || cb.contains(x); }) ? Math.max(0, cb.getBoundingClientRect().bottom - scr.top) : 0;
    if (rs.length && tour.scrolled !== tour.i && (r.top < cover || r.bottom > H)) {
      tour.scrolled = tour.i; var first = tourEls(step)[0];
      if (first && first.scrollIntoView) first.scrollIntoView({ block: "center", behavior: window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    r.left = Math.max(4, r.left); r.right = Math.min(W - 4, r.right);
    spot.style.top = r.top + "px"; spot.style.left = r.left + "px"; spot.style.width = Math.max(0, r.right - r.left) + "px"; spot.style.height = Math.max(0, r.bottom - r.top) + "px";
    // Engeller: delik yalnız dokunulacak öğenin çevresinde. Bilgi adımında delik yok (aydınlık alandaki düğme ve alanlar da kapalı).
    var hs = tourTap(step).filter(function (x) { return x.getClientRects().length; }).map(function (x) { return x.getBoundingClientRect(); });
    var h = hs.length ? { top: Math.min.apply(null, hs.map(function (x) { return x.top; })) - scr.top - 4, left: Math.max(0, Math.min.apply(null, hs.map(function (x) { return x.left; })) - scr.left - 4),
      bottom: Math.max.apply(null, hs.map(function (x) { return x.bottom; })) - scr.top + 4, right: Math.min(W, Math.max.apply(null, hs.map(function (x) { return x.right; })) - scr.left + 4) } : null;
    var b = h ? { top: [0, 0, W, Math.max(0, h.top)], bottom: [h.bottom, 0, W, Math.max(0, H - h.bottom)], left: [h.top, 0, Math.max(0, h.left), h.bottom - h.top], right: [h.top, h.right, Math.max(0, W - h.right), h.bottom - h.top] } : null;
    box.querySelectorAll("[data-tour-block]").forEach(function (d) { var v = b ? b[d.dataset.tourBlock] : (d.dataset.tourBlock === "top" ? [0, 0, W, H] : [0, 0, 0, 0]); d.style.top = v[0] + "px"; d.style.left = v[1] + "px"; d.style.width = v[2] + "px"; d.style.height = Math.max(0, v[3]) + "px"; });
    var fitsBelow = r.bottom + 12 + tipH <= H, fitsAbove = r.top - 12 - tipH >= 8, top;
    if (step.nav) top = 12;
    else if (!rs.length) top = H - tipH - 16;
    else if (fitsBelow) top = r.bottom + 12;
    else if (fitsAbove) top = r.top - tipH - 12;
    else {
      // İki yana da sığmıyor: hedef ve balon birlikte sığıyorsa adım başına bir kez kaydır; sığmıyorsa balon dokunulacak öğeden uzak kenara.
      if (tour.fit !== tour.i && r.bottom - r.top + tipH + 32 <= H) { tour.fit = tour.i; el("screen").scrollTop += r.bottom + 12 + tipH - (H - 8); return; }
      var far = h || r; top = (far.top + far.bottom) / 2 > H / 2 ? 8 : H - tipH - 8;
    }
    tip.style.top = Math.min(Math.max(8, top), H - tipH - 8) + "px";
  }
  function kisaStartHtml(cfg) {
    var nxt = agentNext();
    return (kisaStartError ? '<p class="kisa-start-error" role="alert">' + A.escape(kisaStartError) + '</p>' : '') + '<div class="kisa-start-head">' + (cfg.badge ? '<span class="kisa-start-badge">' + cfg.badge + '</span>' : '') + '<b>' + cfg.title + '</b><span>' + A.escape(cfg.copy) + '</span></div><div class="kisa-start-actions">' + cfg.cases.map(function (c) {
      var ac = AGENT_CASES[c[0]], icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
      if (!ac) return '<button type="button" class="btn line-dark pill kisa-start-btn" data-kisa-start="' + c[0] + '">' + icon + c[1] + '</button>';
      var done = !!kisaDone[c[0]], isNext = !done && c[0] === nxt;
      return '<button type="button" class="kisa-start-case' + (done ? ' is-done' : '') + (isNext ? ' is-next' : '') + '" data-kisa-start="' + c[0] + '">' +
        '<span class="kisa-start-mark" aria-hidden="true">' + (done ? '✓' : icon) + '</span><span class="kisa-start-text"><b>' + ac.title + '</b><small>' + ac.sub + '</small></span>' +
        (isNext ? '<span class="kisa-start-tag">Sıradaki</span>' : done ? '<span class="sr-only">tamamlandı</span>' : '') + '</button>';
    }).join("") + '</div>';
  }
  // 29 Ekim (sahip): Evre 2 ve 3 "bugün" sanılmasın. Sahne açılınca kısa süre evrenin adı ekranda belirir, sonra yumuşakça kaybolur. Dokununca hemen kapanır.
  var splashTimer = 0;
  function placeOver(node) { var scr = el("screen").getBoundingClientRect(); node.style.top = scr.top + "px"; node.style.left = scr.left + "px"; node.style.width = scr.width + "px"; node.style.height = scr.height + "px"; }
  function hideSplash() { clearTimeout(splashTimer); var sp = el("era-splash"); if (sp) { sp.hidden = true; sp.classList.remove("is-out"); } }
  function eraSplash(eraId) {
    var sp = el("era-splash"); if (!sp) return;
    clearTimeout(splashTimer); sp.classList.remove("is-out");
    if (eraId === "today") { sp.hidden = true; return; }
    placeOver(sp);
    sp.dataset.era = eraId;
    sp.innerHTML = eraId === "near" ? '<b>Yakın gelecek · Demo</b><span>Bu bir yakın gelecek senaryosu. Bugünkü uygulamada yok.</span>'
      : '<b>Ajanlar çağı · Vizyon demosu</b><span>Bu bir ajanlar çağı senaryosu. Ajanlar senin adına ödeme ister.</span>';
    sp.hidden = false;
    splashTimer = setTimeout(function () { sp.classList.add("is-out"); splashTimer = setTimeout(function () { sp.hidden = true; sp.classList.remove("is-out"); }, 600); }, Math.max(0, Number(A.CONFIG.eraSplashMs === undefined ? 1800 : A.CONFIG.eraSplashMs)));
  }
  // 29 Ekim (sahip): vaka hazır gelmesin, jüri kendisi tetiklesin. Görüşme sürüyor, birikim bozulmuş; dolandırıcının söylediği alıcı formda yazılı.
  // "Devam et"e basınca kalkan uygulamanın kendi akışıyla açılır. Ekranda senaryo dili yok.
  function prefillScam(sc) {
    if (!sc) return;
    view.transferLabOpen = true; view.incomingCall = false;
    el("nt-payee").value = sc.payee; el("nt-iban").value = "TR " + sc.ibanMask.slice(-4); el("nt-amount").value = A.money(sc.amount).replace(/\s*TL$/, "");
    render(A.agent.getSnapshot()); renderTransferLab(A.agent.getSnapshot());
    el("screen").scrollTop = 0; el("new-transfer-title").focus({ preventScroll: true });
  }
  function initialScene() {
    var q = new URLSearchParams(location.search), scenario = q.get("scenario");
    var hit = KISA_SCENES.find(function (x) { return x.scenario && x.scenario === scenario; });
    return hit ? hit.id : { near: "kurallar", future: "ajanlar" }[presentation.initialEra] || "birikim";
  }
  function openEraCard(page, titleId) {
    go(page); el("screen").scrollTop = 0;
    var t = el(titleId); if (t) t.focus({ preventScroll: true });
  }
  // Döngü onayı ve geri alma gerçek motor komutlarıdır; üst mesaj gösterilmez (sonuç kartın içinde, P1: aynı bilgi iki kez çıkmaz).
  async function nearMoney(type, amount) {
    var n = era.near; n.busy = true; n.error = ""; render(A.agent.getSnapshot());
    var result = await command({ type: type, amount: amount });
    n.busy = false; view.message = "";
    if (!result.ok) n.error = plainReason(result.reason) || "İşlem tamamlanamadı.";
    return result.ok;
  }
  // Evre 2 ay içi gider: vadesizde güvenlik payının altına inecek kadar gider eklenir; pay kuralı eksik kısmı fondan tamamlamayı hazırlar.
  // Sunucu çubuğundaki ₺↓ ve Kurallar turu aynı yolu kullanır; sonuç döner, sessizce geçilmez.
  // 5 Kasım (sahip): kart borcu "beklenmedik" olamaz (son 12 ayın harcamasından tahmin edilir). Şok anı dışarıdan gelen bir masraf: hastane.
  // Motorda gerçek "expense" olayı: para hesaptan çıkar, öneri yeniden hesaplanır.
  var KISA_SHOCK = { amount: 1200000, label: "Hastane masrafı" };
  async function tourShock() {
    var before = A.agent.getSnapshot().forecast.available, made;
    try { made = await command({ type: "event", event: "expense", amount: KISA_SHOCK.amount }); } catch (e) { made = { ok: false, reason: e && e.message }; }
    if (!made.ok) { formError(plainReason(made.reason) || "Masraf şu an eklenemedi."); return made; }
    view.kisaShock = { amount: KISA_SHOCK.amount, label: KISA_SHOCK.label, before: before };
    go("home"); el("screen").scrollTop = 0;
    await kisaShock();
    return made;
  }
  // 5 Kasım (sahip): beklenmedik masraf bir "şok anı". Tur bir an çekilir, uygulama ekranı bir kez sarsılır ve kenarları kırmızı parlar.
  // Uyarı uygulamanın içinde değil, turun kendi balonunda (meta): kırmızı ünlem + "Panik yok, plan var" sloganı. Azaltılmış harekette sarsıntı ve parlama yok.
  function kisaShock() {
    var ms = A.CONFIG.shockMs === undefined ? 900 : Math.max(0, Number(A.CONFIG.shockMs)), box = el("tour"), scr = el("screen");
    if (box) box.hidden = true;
    scr.classList.remove("is-shock"); void scr.offsetWidth; scr.classList.add("is-shock");
    return new Promise(function (done) { setTimeout(function () { scr.classList.remove("is-shock"); if (box && tour) box.hidden = false; done(); }, ms); });
  }
  async function nearExpense() {
    var s = A.agent.getSnapshot(), amount = s.balances.cash - s.forecast.expected - 200000;
    if (amount <= 0) return { ok: false, reason: "Vadesizde güvenlik payının üstünde boşta para yok." };
    era.barOpen = false; era.near.sweep = { busy: false, sent: 0, skipped: false };
    var made = await command({ type: "event", event: "expense", amount: amount }); view.message = "";
    if (!made.ok) { eraSay(plainReason(made.reason) || "Gider eklenemedi"); render(A.agent.getSnapshot()); return made; }
    if (view.page !== "savings") go("savings"); else render(A.agent.getSnapshot());
    el("screen").scrollTop = 0;
    return { ok: true };
  }
  // Motor işlemi olmayan kurgusal ajan kararlarında da halka kısa süre döner (sunumda görünür olsun); testlerde 0.
  function eraWorkMs() { return Math.max(0, Number(A.CONFIG.eraWorkMs === undefined ? 700 : A.CONFIG.eraWorkMs)); }
  async function eraAction(action, button) {
    var n = era.near, f = era.future, s = A.agent.getSnapshot();
    if (button && button.dataset.nearRule) { n[button.dataset.nearRule] = !n[button.dataset.nearRule]; n.cycleStep = 0; n.undone = false; n.error = ""; eraSay(button.getAttribute("aria-label").split(":")[0] + (n[button.dataset.nearRule] ? " açıldı" : " kapatıldı")); }
    else if (button && button.dataset.agent) { f.agents[button.dataset.agent] = !f.agents[button.dataset.agent]; eraSay(button.getAttribute("aria-label") + (f.agents[button.dataset.agent] ? " açıldı" : " askıya alındı")); }
    else if (action === "near-prepare") { n.cycleStep = 1; n.undone = false; n.error = ""; }
    else if (action === "near-confirm") {
      if (n.busy) return;
      var plan = nearPlan(s, n);
      if (plan.save > 0 && !(await nearMoney("deposit-savings", plan.save))) { render(A.agent.getSnapshot()); return; }
      n.plan = plan; n.amount = plan.save; n.cycleSent = true; eraSay(plan.save ? A.money(plan.save) + " kurallarınla ALE fonuna ayrıldı" : "Döngü kurallarınla tamamlandı");
    }
    else if (action === "near-cancel") { n.cycleStep = 0; n.error = ""; }
    else if (action === "near-undo") {
      if (n.amount > 0 && !(await nearMoney("redeem-savings", n.amount))) { render(A.agent.getSnapshot()); return; }
      n.cycleStep = 0; n.cycleSent = false; n.undone = true; n.amount = 0; n.plan = null; eraSay("Son döngü geri alındı");
    }
    else if (button && button.dataset.futureMode) f.mode = button.dataset.futureMode;
    else if (action === "future-budget-travel" || action === "future-budget-save") { f.budget.choice = action.slice(14); f.budget.step = 2; }
    else if (action === "future-budget-confirm") { f.budget.sent = true; eraSay(f.budget.choice === "travel" ? "Bilete öncelik verildi" : "Birikim hedefin korundu · bilet alınmadı"); }
    else if (action === "future-budget-back") f.budget.step = 1;
    else if (action === "future-price") f.budget.priceOpen = !f.budget.priceOpen;
    else if (action === "future-kya-stop") { f.kya.stopped = true; f.agents.shop = false; eraSay("130.000 TL durduruldu · Alışveriş Ajanı izni askıya alındı"); }
    else if (action === "future-kya-summary") f.kya.summaryOpen = !f.kya.summaryOpen;
    else if (action === "future-spoof-summary") f.spoof.summaryOpen = !f.spoof.summaryOpen;
    else if (action === "future-spoof-stop") {
      if (f.spoof.working || f.spoof.stopped) return;
      f.spoof.working = true; render(A.agent.getSnapshot());
      await new Promise(function (r) { setTimeout(r, eraWorkMs()); });
      f.spoof.working = false; f.spoof.stopped = true; eraSay("8.400 TL engellendi");
    }
    else if (action === "future-pref-save") { f.agents.saveFirst = !f.agents.saveFirst; eraSay(f.agents.saveFirst ? "Tercihin kaydedildi" : "Tercih kapatıldı"); }
    else if (action === "near-sweep-confirm") {
      var sw = nearSweepState(s); if (!sw || sw.sent || n.sweep.busy) return;
      n.sweep.busy = true; n.error = ""; render(A.agent.getSnapshot());
      var moved = await command({ type: "redeem-savings", amount: sw.need });
      n.sweep.busy = false; view.message = "";
      if (moved.ok) { n.sweep.sent = sw.need; eraSay(A.money(sw.need) + " vadesize aktarıldı · güvenlik payın korundu"); } else n.error = plainReason(moved.reason) || "İşlem tamamlanamadı.";
    }
    else if (action === "near-sweep-skip") { n.sweep.skipped = true; n.error = ""; eraSay("Bu kez atlandı"); }
    else if (action === "near-sweep-undo") {
      if (n.sweep.busy || !n.sweep.sent) return;
      n.sweep.busy = true; render(A.agent.getSnapshot());
      var back = await command({ type: "deposit-savings", amount: n.sweep.sent });
      n.sweep.busy = false; view.message = "";
      if (back.ok) { n.sweep.sent = 0; eraSay("Tamamlama geri alındı"); }
    }
    // Ana sayfa şeridi: dokununca ilgili sekmede tam kart en üstte açılır.
    else if (action === "near-open") { openEraCard("savings", "near-era-title"); return; }
    else if (/^future-open-(budget|kya|spoof)$/.test(action)) { f.mode = action.slice(12); f.picked = true; openEraCard("transfer", "future-era-title"); return; }
    else return;
    render(A.agent.getSnapshot());
  }
  function bindEra() {
    // 18 Kasım (sahip): persona Deniz, avatar "D". Avatar görünümünü korur; tek dokunuş hiçbir şey yapmaz, 1,2 sn içinde üç dokunuş gizli çubuğu açar/kapatır.
    document.querySelector(".top-nav .agent-avatar").addEventListener("click", function () {
      var now = Date.now();
      era.taps = era.taps.filter(function (t) { return now - t < 1200; }).concat(now);
      if (era.taps.length < 3) return;
      era.taps = []; era.barOpen = !era.barOpen; render(A.agent.getSnapshot());
    });
    document.querySelectorAll("[data-era-select]").forEach(function (b) { b.onclick = function () { setEra(b.dataset.eraSelect); }; });
    el("era-dev-close").onclick = function () { era.barOpen = false; render(A.agent.getSnapshot()); };
    // Sunum provası: motoru ve evre sahnelerini baştan başlatır; seçili evre korunur.
    el("era-dev-reset").onclick = function () { if (presentation.kisa) { openScene(kisaScene); return; } reset(); el("screen").scrollTop = 0; };
    document.querySelectorAll("[data-kisa-scene]").forEach(function (b) { b.onclick = function () { openScene(b.dataset.kisaScene); }; });
    if (el("kisa-start")) el("kisa-start").onclick = function (e) { var b = e.target.closest("[data-kisa-start]"); if (b && !b.disabled) startCase(b.dataset.kisaStart); };
    if (el("tour")) {
      el("tour-skip").onclick = tourEnd; el("tour-next").onclick = function () { tourNext(); };
      el("tour-contact-link").onclick = function (event) {
        // Keep the landing page, campaign source and any typed email intact.
        // A standalone preview follows the ordinary anchor to the landing form.
        if (window.parent !== window && /^https?:$/.test(location.protocol)) {
          event.preventDefault();
          tourEnd();
          window.parent.postMessage({ type: "arti:early-access" }, location.origin);
        }
      };
      el("era-splash").onclick = hideSplash;
      el("screen").addEventListener("scroll", function () { if (tour && window.requestAnimationFrame) requestAnimationFrame(tourPlace); });
      window.addEventListener("resize", function () { if (tour) tourPlace(); if (!el("era-splash").hidden) placeOver(el("era-splash")); });
      // Tur olaylarla denetlenir: çizim (renderEra), aç/kapa, kaydırma, animasyon sonu. Saniyede bir yedek denetim.
      document.addEventListener("toggle", function () { if (tour) setTimeout(tourTick, 0); }, true);
      ["transitionend", "animationend"].forEach(function (ev) { el("screen").addEventListener(ev, function () { if (tour && window.requestAnimationFrame) requestAnimationFrame(tourPlace); }); });
      // Klavye: tur açıkken Tab yalnız dokunulacak öğe, balon düğmeleri ve sahne seçici arasında döner (karartmanın altına gitmez).
      document.addEventListener("keydown", function (e) {
        if (!tour || e.key !== "Tab") return;
        var list = tourFocusables(); if (!list.length) return;
        var i = list.indexOf(document.activeElement), n = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
        e.preventDefault(); list[n].focus({ preventScroll: true });
      });
    }
    el("era-dev-portfolio").onclick = function () { reset("portfolio"); go("accounts"); focusPortfolio(); };
    el("era-dev-portfolio-need").onclick = async function () {
      era.barOpen = false;
      var made = await command({ type: "event", event: "portfolio-need" });
      if (!made.ok) { eraSay(plainReason(made.reason) || "Ödeme eklenemedi"); render(A.agent.getSnapshot()); return; }
      if (view.page !== "accounts") go("accounts"); else render(A.agent.getSnapshot());
      focusPortfolio();
    };
    // Sunum: ay içi beklenmedik gider; vadesizde payın 1.000 TL'si kalır, pay kuralı Birikim'de tamamlamayı hazırlar.
    el("era-dev-cooldown").onclick = async function () {
      era.barOpen = false;
      var made = await command({ type: "event", event: "shield-time" });
      if (!made.ok) { eraSay(plainReason(made.reason) || "Bekleme ileri alınamadı"); render(A.agent.getSnapshot()); return; }
      if (view.page !== "transfer") go("transfer"); else render(A.agent.getSnapshot());
    };
    el("era-dev-expense").onclick = function () { return nearExpense(); };
    ["near-era-card", "future-era-card"].forEach(function (id) {
      el(id).addEventListener("click", function (e) {
        var sum = e.target.closest("[data-era-agents]");
        if (sum) { era.future.agentsOpen = !sum.parentElement.open; return; }
        var b = e.target.closest("[data-guard-action]"); if (b && !b.disabled) eraAction(b.dataset.guardAction, b);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      // Mac'te Alt+1 "¡" yazar; tuş konumu (code) okunur.
      var next = { Digit1: "today", Digit2: "near", Digit3: "future" }[e.code];
      if (typing || !next) return;
      e.preventDefault(); setEra(next);
    });
  }
  function renderGuards(s) {
    var allowed = presentation.features.guards, activeOp = s.operations.find(function (op) { return ["pending", "running", "unknown"].includes(op.status); });
    // Yeni bir kalkan olayı önceki özetin açık/kapalı durumunu devralmaz (düğme "gizle" diye açılmasın).
    if (s.shield && view.shieldReviewFor !== s.shield.id) { view.shieldReviewFor = s.shield.id; view.shieldReviewOpen = false; }
    var shieldHtml = allowed ? scamShieldHtml(s, activeOp) : "", trialHtml = allowed && presentation.features.trialGuard ? trialGuardHtml(s, activeOp) : "";
    var liquidityHtml = allowed ? liquidityGuardHtml(s, activeOp) : "", cryptoHtml = "", payeeHtml = allowed ? payeeReviewHtml(s, activeOp) : "";
    var stmtHtml = allowed ? cardStatementHtml(s, activeOp) : "", dueHtml = allowed ? cardDueHtml(s) : "";
    // Ekstrenin yol açtığı açık ekstre kartında fondan tamamlanır; aynı açık için ikinci bir kart gösterilmez.
    if (dueHtml && s.cardStatement.full.topUp > 0 && s.liquidity.fragile) liquidityHtml = "";
    // Gelecek evrelerde ay içi açık pay kuralının kartında; bugünkü "Ay sonuna kadar" uyarısı aynı açığı ikinci kez göstermez.
    if (era.era !== "today") liquidityHtml = "";
    setGuardHtml("payee-review", payeeHtml); renderTransferLab(s);
    var scanOpen = allowed && !!view.scanOpen;
    visible("scan-panel", scanOpen); visible("home-scan-payment", allowed);
    if (scanOpen) { setGuardHtml("scan-body", scanPanelHtml()); if (el("scan-form")) el("scan-form").onsubmit = function (e) { e.preventDefault(); submitScan(); }; }
    var callActive = !!(s.device.call && s.device.call.active);
    visible("call-banner", allowed && callActive);
    el("agent-message").classList.toggle("below-call", allowed && callActive);
    // Transfer sayfası açılınca "112" görünen bir arama gelir; açılırsa arama sinyali risk puanına girer, reddedilirse girmez.
    visible("incoming-call", allowed && !!view.incomingCall && !callActive);
    // Sprint 2: kalkan açıkken fon işlemi gösterilmez; öncelik kalkandadır.
    // 16 Ekim görüşmesi: korumaya alındıktan sonra (ve koruma kalksa bile) "Fonunu yönet" fon kartını açamıyordu.
    // Koruma yalnız yeni alıcıya transferi kilitler; kendi hesapların arasındaki fon işlemi açık kalır.
    var fundShown = allowed && presentation.features.fundCard && !view.fundCardDismissed && !s.shieldActive;
    var fundCardEl = el("fund-card"), savingsViewEl = el("savings-view"), comparisonCardEl = savingsViewEl.querySelector(".savings-comparison-card");
    if (view.fundFirst && savingsViewEl.firstElementChild !== fundCardEl) savingsViewEl.insertBefore(fundCardEl, savingsViewEl.firstElementChild);
    else if (!view.fundFirst && comparisonCardEl && comparisonCardEl.nextElementSibling !== fundCardEl) comparisonCardEl.after(fundCardEl);
    visible("fund-card", fundShown);
    if (fundShown) {
      var ecoActive = !!(presentation.features && presentation.features.ecosystem);
      var fp = s.fund.product, fw = s.fund.window, fundClosed = !fw.open;
      text("fund-eyebrow", ecoActive ? ("Fonum · " + fp.name) : "Birikim fonun");
      document.querySelectorAll("[data-fund-choice]").forEach(function (b) { var on = b.dataset.fundChoice === fp.code; b.setAttribute("aria-pressed", String(on)); b.classList.toggle("is-on", on); b.disabled = !!activeOp; });
      var pendingChoice = view.fundChoicePending && view.fundChoicePending !== fp.code ? view.fundChoicePending : null;
      visible("fund-choice-confirm", !!pendingChoice);
      // 16 Ekim (sahip kararı b): fon değişince güvenlik payının varsayılanı da değişir; onayda açıkça söylenir.
      var nextBuffer = pendingChoice ? s.forecast.bufferFor[pendingChoice] : null;
      var bufferNote = s.permissions.bufferAuto && pendingChoice && nextBuffer !== s.permissions.buffer ? " Güvenlik payın " + A.money(s.permissions.buffer) + "'den " + A.money(nextBuffer) + "'ye " + (nextBuffer > s.permissions.buffer ? "çıkar" : "iner") + (s.portfolio && s.portfolio.basket ? " (yatırımlarına ulaşma süresiyle birlikte)." : " (ortalama " + Math.max(1, Math.round(nextBuffer / Math.max(1, s.forecast.dailyAverage))) + " günlük harcaman).") : "";
      if (pendingChoice) {
        var toAis = pendingChoice === "AIS", bal = A.money(s.balances.savings);
        text("fund-choice-confirm-title", toAis ? "Birikimin katılım fonuna (AIS) geçsin mi?" : "Birikimin para piyasası fonuna (ALE) geçsin mi?");
        var held = s.balances.savings > 0, wFrom = s.fund.windows[fp.code], wTo = s.fund.windows[pendingChoice], closedW = held && (!wFrom.open ? wFrom : !wTo.open ? wTo : null);
        text("fund-choice-confirm-body", (held ? "Tek onayla iki işlem yaparım: " + fundIn(fp.code) + "ki " + bal + " satılır, aynı anda " + pendingChoice + " alınır. Satışta, fondaki kazancından yasal stopaj kesilir. " : "") +
          (closedW ? "Şu an yapılamaz: " + closedW.code + " alım ve satımı iş günlerinde saat " + closedW.cutoff + "’e kadar. Bir sonraki işlem günü: " + guardDate(closedW.nextDay) + "." : toAis
          ? "Dikkat: AIS’ten paranı yalnız iş günlerinde saat 13:00’e kadar geri alabilirsin. Akşam, hafta sonu ve resmi tatilde alamazsın."
          : "ALE faizli para piyasası araçlarına yatırım yapar. Paranı 7/24 geri alabilirsin, anında vadesizine geçer.") + bufferNote);
        el("fund-choice-yes").disabled = !!closedW || !!activeOp;
        text("fund-choice-yes", fundTo(pendingChoice) + " geç"); text("fund-choice-no", fundIn(fp.code) + " kal");
      }
      // 18 Ekim: gerçekte fon değişimi satış + alımdır; asistan ikisini tek onayla yapar (önceki "satış gerekmez" metni yanlıştı).
      text("fund-choice-help", s.balances.savings > 0 ? "Fon türünü değiştirirsen fondaki " + A.money(s.balances.savings) + "’yi senin için satar, yeni fonu alırım. Tek onay yeter." : "Fona ekleyeceğin para seçtiğin fon türüne gider.");
      // Varsayılan ALE; kutu kapalıyken değiştirmeye yönlendiren açıklama gösterilmez (sahip kararı, 16 Ekim).
      text("fund-pref-note", fp.code === "AIS"
        ? "Acil nakit: " + fp.code + " saat " + fw.cutoff + " sonrasında, hafta sonu ve resmi tatilde nakde çevrilemez. O saatlerde vadesiz hesabındaki paranın tamamını (şu an " + A.money(s.balances.cash) + ") kullanabilirsin. Fon o saatlerde nakde dönmediği için katılım fonunda güvenlik payını " + A.money(s.forecast.buffer) + " tutuyorum."
        : "");
      text("fund-balance", A.money(s.balances.savings));
      // SA-06: %51,5 kurgusal varsayım yalnız ALE içindir; AIS için oran uydurulmaz.
      var dailyKurus = Math.round((s.balances.savings * 0.515) / 365);
      text("fund-daily-return", fp.code === "AIS" ? "Değişken" : "~" + Math.round(dailyKurus / 100).toLocaleString("tr-TR") + " TL / gün");
      var pillsEl = el("fund-pills");
      if (pillsEl) {
        // 18 Ekim: bilgiler çip gibi basılabilir görünüyordu; düz metin satırları. Erişim kısıtı varsa vurgulanır.
        pillsEl.innerHTML =
          '<li>' + (ecoActive ? "Ak Portföy " : "Likit Fon ") + fp.code + '</li>' +
          (fw.limited ? '<li class="is-limit">Geri alma yalnız iş günleri saat ' + fw.cutoff + ' öncesinde · para aynı gün vadesizde</li>' : '<li>7/24 geri alabilirsin · para anında vadesizde</li>') +
          '<li>' + (fp.code === "AIS" ? "Getiri katılım araçlarına göre değişir" : "Getiri varsayımı %51,5 (garanti değil)") + '</li>';
      }
      // 21 Ekim (sahip): önce tutar, sonra yön. Sekme seçmeden tutar kutusu görünür; iki yön de gerçek düğme ve tutar yazılınca yumuşakça canlanır.
      // 17 Ekim katılımcısının sorunu (seçili kalan "vadesize aktar" modu) böylece oluşmaz: yön, dokunulan düğmeyle o an seçilir.
      text("fund-switched", view.fundSwitched || ""); visible("fund-switched", !!view.fundSwitched);
      text("fund-balances", "Vadesiz " + A.money(s.balances.cash) + " · Fonda " + A.money(s.balances.savings));
      var hintText = fundClosed ? fundClosedHint(fw) : fw.limited ? "Alım ve satım iş günlerinde saat " + fw.cutoff + " öncesinde yapılır." : "";
      text("fund-hint", hintText); visible("fund-hint", !!hintText);
      // H-03: eski bakiye kutuda takılı kalmaz. 17 Ekim: kutu fonun tamamıyla önceden dolmaz; "Tamamı" çipi güncel bakiyeyi taşır.
      if (document.activeElement !== el("fund-amount") && !view.fundAmountDirty) el("fund-amount").value = "";
      var safeAvail = Math.max(0, s.forecast.available), chips = [{ label: "1.000 TL", val: 1000 }, { label: "5.000 TL", val: 5000 }];
      if (safeAvail > 0) chips.push({ label: "Güvenli (" + A.money(safeAvail) + ")", val: Math.round(safeAvail / 100) });
      if (s.balances.savings > 0) chips.push({ label: "Tamamı (" + A.money(s.balances.savings) + ")", val: Math.round(s.balances.savings / 100) });
      el("fund-chips").innerHTML = chips.map(function (c) { return '<button type="button" class="fund-chip" data-fund-val="' + c.val + '">' + A.escape(c.label) + '</button>'; }).join("");
      syncFundActions(s);
      // 21 Ekim (sahip): fon işlemi de iki adımlı. Yön seçilince kısa özet ve onay (2/2); onaydan sonra yeşil "✓ tutar".
      var fpend = view.fundPending, fsent = !fpend && view.fundSent, dots = el("fund-steps").children;
      visible("fund-actions", !fpend && !fsent); visible("fund-confirm", !!fpend); visible("fund-sent", !!fsent);
      dots[0].classList.toggle("now", !fpend && !fsent); dots[1].classList.toggle("next", !fpend && !fsent); dots[1].classList.toggle("now", !!fpend);
      el("fund-steps").classList.toggle("done", !!fsent);
      if (fsent) text("fund-sent", "✓ " + A.money(fsent.amount));
      if (fpend) {
        var dep = fpend.dir === "deposit";
        el("fund-confirm-facts").innerHTML = rows([["Nereden", dep ? "Vadesiz hesabın" : "Birikim fonun"], ["Nereye", dep ? "Birikim fonun" : "Vadesiz hesabın"], ["İşlemden sonra vadesiz", A.money(s.balances.cash + (dep ? -fpend.amount : fpend.amount))]]);
        text("fund-confirm-btn", A.money(fpend.amount) + (dep ? " fona ekle · onayla" : " vadesizine al · onayla"));
        el("fund-confirm-btn").disabled = fundClosed;
      }
    }
    setGuardHtml("scam-shield", shieldHtml); setGuardHtml("card-statement-guard", stmtHtml); setGuardHtml("card-due-guard", dueHtml);
    if (view.page === "card") renderCardPage(s); setGuardHtml("liquidity-guard", liquidityHtml); setGuardHtml("trial-guard", trialHtml); setGuardHtml("ecosystem-crypto", cryptoHtml);
    var review = s.tasks.transfer && s.tasks.transfer.humanReview, reviewOpen = allowed && !!view.shieldReviewOpen && !!review && !!s.shield && review.operationRef === s.shield.id &&
      (s.shield.flow === "context" ? s.shieldActive || s.shield.status === "cancelled" : s.shield.status === "protected" && s.protection.newPayeeLocked);
    visible("shield-review-panel", reviewOpen);
    if (reviewOpen) renderInlineReview("shield-review", "transfer", review, review);
    // Sprint 2: acil kart (kalkan, transfer onayı/formu, fon) yoksa yalnız en öncelikli bilgi kartı önerinin üstünde kalır; diğerleri "Diğer uyarılar"a taşınır.
    // Para gönderme ve kalkan kartları "Para gönder" sayfasında; ana sayfada kalkan için yalnız kısa bir bağlantı kalır.
    var urgent = !!(shieldHtml || reviewOpen);
    visible("transfer-cards", !!(shieldHtml || payeeHtml || reviewOpen || allowed && view.transferLabOpen || scanOpen));
    visible("home-shield-link", urgent);
    // Ek bağlam akışında satır kartın gerçek durumunu söyler (kartla aynı kısa cümleler).
    var hsh = s.shield, ho = hsh && hsh.flow === "context" ? s.shieldOutcome : null;
    if (urgent) text("home-shield-copy", hsh && hsh.status === "protected" ? "Yeni alıcılara transfer koruma altında." : hsh && hsh.status === "cancelled" ? "Şüpheli transfer iptal edildi. Para gönderilmedi."
      : ho === "approve" ? "Cevabın kaydedildi. Göndermek senin onayında." : ho === "verify" || ho === "hold" ? "Doğrulama gerekiyor. Uygulamadan gönderilemez." : ho === "stop" ? "Transfer durduruldu. Paran hesabında."
      : "Bir transferin güvenlik kontrolünde. Sorulara yanıt vermeden para gitmez.");
    var infoCards = [["card-due-guard", dueHtml], ["liquidity-guard", liquidityHtml], ["trial-guard", trialHtml], ["ecosystem-crypto", cryptoHtml]].filter(function (x) { return x[1]; }).map(function (x) { return x[0]; });
    var primaryInfo = urgent ? null : infoCards[0] || null, deferred = infoCards.filter(function (id) { return id !== primaryInfo; });
    ["card-due-guard", "liquidity-guard", "trial-guard", "ecosystem-crypto"].forEach(function (id) {
      var node = el(id), target = deferred.includes(id) ? el("other-alerts-body") : el("guard-cards");
      if (node.parentElement !== target) target.appendChild(node);
    });
    visible("other-alerts", deferred.length > 0);
    text("other-alerts-summary", "Diğer uyarılar (" + deferred.length + ")");
    visible("guard-cards", urgent || !!primaryInfo);
    visible("home-new-transfer", allowed); visible("transfer-new", allowed); visible("transfer-scan", allowed);
  }
  function render(s) {
    renderTransferNotice(s);
    renderGuards(s);
    renderEra(s);
    renderRefundNotice(s);
    if (el("assistant-chat-view")) {
      visible("assistant-chat-view", !!view.chatOpen);
      // Jüride sohbet yalnız Aday 15 düğmesiyle açılır; serbest yazı alanı yoktur.
      visible("chat-form", !!presentation.features.chat);
      if (view.chatOpen) renderChat();
    }
    updateBudgetPreview("card-savings-amount", "card-savings-impact");
    updateBudgetPreview("savings-amount", "savings-impact");
    // C1-06: telefonun saat çubuğu kontrollü motor saatini gösterir (ör. AIS 13:30 senaryosu).
    var clock = document.querySelector("#phone .statusbar span"); if (clock) clock.textContent = new Date(s.now).toLocaleTimeString("tr-TR", { hour: "numeric", minute: "2-digit", timeZone: "Europe/Istanbul" });
    text("home-date", new Date(s.now).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }));
    text("home-balance", A.money(s.balances.cash));
    text("home-forecast", s.forecast.horizonExpired ? "Bu örnek dönemi sona erdi. Güncel gider tahmini için yeni dönem verisi gerekiyor." : "Son 12 ayki harcamalarına göre bu ay kalan ödemelerin: yaklaşık " + A.money(s.forecast.expected) + ".");
    renderHomeAlloc(s);
    var summary = s.summary;
    if (el("asistan-context")) {
      if (summary && summary.priorityClass === 1) text("asistan-context", "İşlemin sonucu henüz belli değil. Tekrar göndermeden kontrol edelim.");
      else if (summary && summary.priorityClass === 2) text("asistan-context", TRIAL_KINDS.includes(summary.primary.facts.kind) ? "Kararın uygulanmak üzere. Uygulanmadan önce geri alabilirsin." : "Gönderilmeden önce geri alabilirsin.");
      else if (statementHold(s)) text("asistan-context", "Önce kart ekstren. Eksik kalanı ödemede fonundan tamamlarım.");
      else if (s.forecast.shortfall > 0) text("asistan-context", "Ödemelerin ve güvenlik payın için " + A.money(s.forecast.shortfall) + " eksik kalıyor. Birikiminden hesabına alabilirsin.");
      else text("asistan-context", "Karar sende.");
    }
    if (el("effects-savings") && el("effects-content-savings")) {
      var hasEffects = !!summary && !!summary.secondary && summary.secondary.length > 0;
      visible("effects-savings", hasEffects);
      if (hasEffects) {
        var effHtml = '<ul class="other-effects-list">' + summary.secondary.map(function (sec) { return '<li>' + A.escape(sec.copy) + '</li>'; }).join("") + '</ul>';
        if (summary.conflict && summary.conflict.hasConflict) effHtml += '<p class="agent-muted">' + A.escape(summary.conflict.note) + '</p>';
        el("effects-content-savings").innerHTML = effHtml;
      }
    }
    var savingsWas = "";
    A.TASKS.forEach(function (d, i) {
      var t = s.tasks[d.id], o = offer(d.id, s);
      text("card-title-" + d.id, o.title); text("card-amount-" + d.id, o.amount);
      if (d.id === "savings") { savingsWas = wasHtml(s, o); setGuardHtml("card-was-savings", savingsWas); visible("card-was-savings", !!savingsWas); }
      if (o.stack) setGuardHtml("card-note-" + d.id, moneyStackHtml(s, o.noteLines, o.offered)); else { guardHtml["card-note-" + d.id] = null; text("card-note-" + d.id, o.note); } if (el("card-redeem-" + d.id)) { text("card-redeem-" + d.id, o.redeem || ""); visible("card-redeem-" + d.id, !!o.redeem); }
      el("card-status-" + d.id).innerHTML = badge(t.status);
      visible("card-status-" + d.id, ["cancelled", "unknown", "failed", "paused", "succeeded"].includes(t.status));
      var button = document.querySelector('[data-open="' + i + '"]'); button.textContent = o.action; button.disabled = !!o.disabled || !!o.working;
      button.classList.toggle("btn-progress", !!o.working); button.classList.toggle("is-working", !!o.working);
      el("why-content-" + d.id).innerHTML = (d.id === "savings" ? withExpenseRow(explanation(d.id, s), s) : explanation(d.id, s)) + (d.id === "savings" || d.id === "bes" ? contrastTag(d.id) : "");
      var held = d.id === "savings" && shieldHold(s);
      // Askıdaki öneride hesap ayrıntısı, ürün örneği ve erteleme gösterilmez; yalnız kalkanın önceliği anlatılır.
      el("why-" + d.id).hidden = held; document.querySelector('[data-skip="' + i + '"]').hidden = held;
      var tag = presentation.features.ecosystem && !held ? ecoTag(d.id, s) : "";
      if (el("eco-" + d.id).textContent !== tag) text("eco-" + d.id, tag);
      visible("eco-" + d.id, !!tag);
      // 18 Ekim katılımcısı: "Akbank'ta / Burada" notu karar anında reklam gibi okundu; jüri için "Neden bu tutar?" içinde kalır.
      visible("edit-" + d.id, !(d.id === "savings" && shieldHold(s)) && (d.id === "subscription" || !t.paused && !["pending", "running"].includes(t.status) && !(d.id === "savings" && s.plans[d.id] && s.plans[d.id].kind === "recover")));
      var slide = el("slide-" + d.id), allowed = presentation.development || d.id === "savings";
      slide.hidden = !allowed; slide.inert = !allowed || i !== view.active; slide.setAttribute("aria-hidden", allowed && i === view.active ? "false" : "true");
      slide.setAttribute("aria-label", presentation.development ? (i + 1) + " / 4" : "Birikim önerisi");
    });
    var savingsEyebrow = el("slide-savings") && el("slide-savings").querySelector(".eyebrow");
    if (savingsEyebrow) savingsEyebrow.textContent = s.forecast.shortfall > 0 ? "Öncelikli öneri" : "Sana bir önerim var";
    // Ana sayfadaki tek öneri, Birikim sayfasındaki birikim kartının özetidir; işlem oradan yapılır.
    // H-04: ana sayfa önerisi birikimin gerçek durumunu söyler; ayrıldıysa "ayrıldı", açık varsa çözüm kartı (nakit akışı) öne çıkar.
    var sv = s.tasks.savings, svDone = sv.status === "succeeded" && sv.lastReceipt && sv.lastReceipt.kind === "save" && sv.lastReceipt.amount > 0;
    var lqShown = !!(presentation.features.guards && s.liquidity && s.liquidity.fragile);
    // evre-1: gelecek evrelerde ana sayfadaki öneri yerine evre şeridi durur.
    visible("home-nudge", !(s.forecast.shortfall > 0 && lqShown) && !statementHold(s) && era.era === "today");
    text("home-nudge-eyebrow", svDone ? "Bu ayın birikimi" : s.forecast.shortfall > 0 ? "Öncelikli öneri" : "Sana bir önerim var");
    text("home-nudge-title", svDone ? "Bu ay birikimine ayrıldı" : el("card-title-savings").textContent);
    text("home-nudge-amount", svDone ? A.money(sv.lastReceipt.amount) : el("card-amount-savings").textContent);
    setGuardHtml("home-nudge-was", svDone ? "" : savingsWas); visible("home-nudge-was", !svDone && !!savingsWas);
    el("home-nudge-open").innerHTML = (svDone ? "Birikimi gör" : "Birikime git") + "&nbsp;<span aria-hidden=\"true\">→</span>";
    text("return-home", view.detailFrom === "savings" ? "Birikime dön" : view.detailFrom === "accounts" ? "Hesaplarıma dön" : view.detailFrom === "transfer" ? "Para gönder'e dön" : "Ana sayfaya dön");
    el("agent-track").style.transform = "translateX(-" + (presentation.development ? view.active : 0) * 100 + "%)";
    text("card-index", (view.active + 1) + " / 4");
    document.querySelectorAll("[data-card]").forEach(function (b) { b.classList.toggle("on", Number(b.dataset.card) === view.active); b.setAttribute("aria-pressed", String(Number(b.dataset.card) === view.active)); });
    ["home", "savings", "transfer", "detail", "accounts", "activity", "comparison", "card"].forEach(function (key) { visible(key + "-view", view.page === key); });
    fitCard();
    visible("detail-back", view.page === "detail" || view.page === "comparison" || view.page === "card");
    text("screen-title", view.page === "detail" ? { savings: "Birikimin", subscription: "Otomatik ödemelerim", bes: "BES katkın", gold: "Altın takibin" }[activeId()] : { home: "Akbank Mobil", savings: "Birikim", transfer: "Para gönder", accounts: "Hesaplarım", activity: "Son adımlar", comparison: "Getiri karşılaştırması", card: "Kredi kartım" }[view.page]);
    document.querySelectorAll("[data-page]").forEach(function (b) { var on = b.dataset.page === (view.page === "detail" ? view.detailFrom || "savings" : view.page === "comparison" ? "savings" : view.page === "card" ? "accounts" : view.page); b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    var taskId = activeId(), t = s.tasks[taskId], p = s.plans[taskId], o = offer(taskId, s);
    var pending = !!p && ["awaiting", "blocked", "pending", "running", "unknown"].includes(p.status);
    var sameReview = !!p && !!reviewedPlan && reviewedPlan.taskId === taskId && reviewedPlan.id === p.id && reviewedPlan.version === p.version;
    var activeOp = s.operations.find(function (op) { return ["pending", "running", "unknown"].includes(op.status); });
    var unknown = s.operations.find(function (op) { return op.taskId === taskId && op.status === "unknown"; });
    var reason = pending && p.status === "awaiting" && !sameReview ? "Bütçen veya koşulların değişti. Onaylamadan önce yeni öneriye bakalım." : t.status === "succeeded" || taskId === "savings" ? "" : o.note;
    text("detail-reason", reason); visible("detail-reason", !!reason);
    el("detail-status").innerHTML = badge(t.status);
    visible("detail-status", ["pending", "cancelled", "running", "unknown", "failed", "paused"].includes(t.status));
    el("card-savings-form").querySelector("button").disabled = !!activeOp;
    el("savings-form").querySelector("button").disabled = !!activeOp;
    visible("savings-form", taskId === "savings" && (!p || p.kind !== "recover"));
    visible("bes-form", taskId === "bes");
    visible("amount-editor", ["savings", "bes"].includes(taskId) && (!p || p.kind !== "recover") && !t.paused);
    visible("gold-setup", taskId === "gold" && !t.paused && !["pending", "running", "unknown"].includes(t.status) && !(p && p.status === "awaiting"));
    visible("subscription-view", taskId === "subscription");
    visible("mandate-note", taskId === "subscription" || taskId === "bes");
    visible("panel-plan", taskId !== "subscription");
    text("price-alert-status", s.tasks.subscription.paused ? "Asistan takibi kapalı. Haber almak için aşağıdaki ayarlardan takibi açabilirsin." : s.bank.priceAlerts.enabled ? "Ücret artışlarında haber alma açık." : "Ücret artışlarında haber alma kapalı.");
    text("price-alert-toggle", s.bank.priceAlerts.enabled ? "Haber almayı kapat" : "Ücret artarsa haber alayım");
    el("price-alert-toggle").setAttribute("aria-pressed", String(s.bank.priceAlerts.enabled));
    el("price-alert-toggle").disabled = s.tasks.subscription.paused;
    el("automatic-payments-list").innerHTML = paymentList(s.automaticPayments);
    // 16 Ekim görüşmeleri: katılımcılar deneme yenilemesini önce ödemelerinde aradı; karar kartına buradan da gidilir.
    var trialDue = presentation.features.guards && (s.trialGuards || []).find(function (x) { return x.due; });
    visible("trial-payments-notice", !!trialDue);
    if (trialDue) el("trial-payments-notice").innerHTML = '<b>' + A.escape(trialDue.merchant) + ' denemen ' + (trialDue.daysLeft === 0 ? "bugün" : trialDue.daysLeft + " gün sonra") + ' bitiyor</b><p>Yenilenirse kartından ' + A.money(trialDue.renewalAmount) + ' / ay çekilir (' + guardDate(trialDue.renewalDue) + ').</p><button type="button" class="nudge-link" id="trial-payments-go">Yenilemeyi engelle veya devam et&nbsp;<span aria-hidden="true">→</span></button>';
    var notice = s.bank.notifications[s.bank.notifications.length - 1];
    visible("subscription-notice", !!notice);
    if (notice) el("subscription-notice").innerHTML = '<b>' + A.escape(notice.label) + ' ödemen yükseldi</b><p>' + A.money(notice.previous) + ' → ' + A.money(notice.current) + ' · %' + (notice.changeBps / 100).toLocaleString("tr-TR") + ' artış</p><p class="agent-muted">Ödeme talimatın devam ediyor.</p>';
    el("calculation-details").querySelector("summary").textContent = taskId === "subscription" ? "Ücret artışını nasıl fark ettin?" : "Neye göre hesapladın?";
    el("plan-description").innerHTML = explanation(taskId, s);
    visible("current-plan", pending);
    if (pending) {
      text("plan-kind", kindNames[p.kind]); el("current-plan").dataset.kind = p.kind;
      text("plan-amount", A.money(p.amount) + (p.kind === "bes-change" ? " / ay" : p.kind === "gold-buy" ? " · " + goldQuantity(p.quantityMg) : ""));
      var facts, note;
      if (p.kind === "save" || p.kind === "recover") {
        var saving = p.kind === "save";
        facts = [["Nereden", saving ? "Vadesiz hesabın" : "Birikim fonun"], ["Nereye", saving ? "Birikim fonun" : "Vadesiz hesabın"], ["İşlemden sonra vadesiz", A.money(p.facts.balances.cash + (saving ? -p.amount : p.amount))]].concat(saving ? [["Geri almak istersen", s.fund.window.limited ? "İş günleri " + s.fund.window.cutoff + "'e kadar, aynı gün" : "7/24, anında vadesizine"]] : []);
        note = saving ? "" : "Birikiminden hesabına ayrı bir aktarım yapılır. Önceki işlemin silinmez.";
      } else if (p.kind === "bes-change") {
        facts = [["Mevcut aylık katkın", A.money(s.bank.bes.monthly)], ["Yeni aylık katkın", A.money(p.amount)]];
        note = "Gelecek katkı ödemelerin değişir. Şimdi hesabından para çekilmez. Fon dağılımın değişmez.";
      } else if (p.kind === "gold-buy") {
        facts = [["Nereden", "Vadesiz hesabın"], ["Altın satış fiyatı", A.money(p.facts.quote.ask) + "/gram"], ["İşlemden sonra vadesiz", A.money(p.facts.balances.cash - p.amount)]];
        note = "Bu alım için onay verirsin. Fiyat " + new Date(p.expiresAt).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }) + "’a kadar geçerli. Onayında yeniden kontrol edilir.";
      }
      el("plan-facts").innerHTML = rows(facts);
      var decision = p.status === "blocked" ? plainReason(p.permissionDecision.reason) : note;
      text("plan-decision", decision); visible("plan-decision", !!decision);
    }
    visible("approve-plan", !!p && p.status === "awaiting" && sameReview && !t.paused);
    el("approve-plan").disabled = !!activeOp;
    // 20 Ekim katılımcısı ikinci onayı atlayıp gönderildi sandı. Metin yerine görsel işaret: iki nokta "bir adım daha var" der, onaydan sonra düğmenin yerini yumuşak bir geçişle yeşil onay alır.
    var sent = !!p && sentNow(p);
    visible("approve-sent", sent);
    el("approve-sent").classList.toggle("is-working", sent && opWorking(p));
    if (sent) text("approve-sent", (opWorking(p) ? "" : "✓ ") + A.money(p.amount));
    visible("approve-steps", !el("approve-plan").hidden || sent);
    el("approve-steps").classList.toggle("done", sent && !opWorking(p));
    if (p) text("approve-plan", p.kind === "save" ? A.money(p.amount) + " ayır · onayla" : p.kind === "recover" ? A.money(p.amount) + " hesabıma al · onayla" : p.kind === "bes-change" ? "Yeni katkımı onayla" : "Altın alımını onayla");
    visible("refresh-review", !!p && p.status === "awaiting" && !sameReview && !t.paused);
    el("refresh-review").disabled = !!activeOp;
    visible("reconcile-operation", !!unknown); el("reconcile-operation").disabled = !!unknown && unknown.reconciling;
    visible("task-receipt", !!t.lastReceipt && t.status === "succeeded" && !pending);
    // 18 Ekim katılımcısı: sonuç yalnız eklenen tutarı söylüyordu; fondaki toplamı (önceden 56.000 TL vardı) ve fona dönüş yolunu göstermiyordu.
    var fundReceipt = t.lastReceipt && ["save", "recover"].includes(t.lastReceipt.kind);
    if (t.lastReceipt) el("task-receipt").innerHTML = '<b>Tamamlandı</b><p>' + A.escape(receiptCopy(t.lastReceipt)) + '</p>' +
      (fundReceipt ? '<p class="receipt-totals">Fonunda şimdi <b>' + A.money(s.balances.savings) + '</b> · vadesizde <b>' + A.money(s.balances.cash) + '</b></p>' + (presentation.features.fundCard ? '<button type="button" class="btn line-dark small pill" id="receipt-fund-btn">Fonuna git</button>' : '') : '') +
      '<details class="nudge-disclosure"><summary>İşlem numarası</summary><p>' + A.escape(t.lastReceipt.reference) + '</p></details>';
    el("task-log").innerHTML = activity(s.events.filter(function (e) { return e.taskId === taskId; }));
    text("task-authority", taskId === "savings" ? "Her para ayırmada onayını sorarım. İstersen yalnızca kendi hesapların arasında, belirlediğin sınırlarda otomatik para ayırmayı açabilirsin." : taskId === "gold" ? "Fiyat farkını izlerim. Her altın alımında güncel fiyat üzerinden onayını isterim." : taskId === "bes" ? "BES katkında değişiklik için her defasında onayını isterim." : "Ücret artışlarında haber alma tercihini değiştirebilirsin. Bu tercih ödeme talimatlarını ve hesaplarını değiştirmez.");
    visible("permissions-form", taskId === "savings"); visible("revoke-permission", taskId === "savings" && s.permissions.autoSave);
    text("pause-task", t.paused ? "Asistan takibini aç" : "Asistan takibini kapat");
    text("human-review-note", t.humanReview ? "İsteğin hazırlandı. " + t.humanReview.reference : "İşlem veya öneri için bir inceleme isteği hazırlayabilirsin.");
    if (el("human-review-panel")) {
      var isHROpen = !!view.humanReviewOpen;
      visible("human-review-panel", isHROpen);
      if (isHROpen) {
        var currentReview = A.agent.buildHumanReviewSummary(taskId);
        var savedReview = t && t.humanReview && t.humanReview.operationId === currentReview.operationId ? t.humanReview : null;
        renderInlineReview("review-input", taskId, savedReview || currentReview, savedReview);

      }
    }
    var pfHow = el("portfolio-how"), pfHowOpen = !!(pfHow && pfHow.open);
    el("accounts-summary").innerHTML = '<div class="agent-box">' + rows([["Vadesiz hesabın", A.money(s.balances.cash)], ["Birikim fonun", A.money(s.balances.savings)], ["Altın hesabın", goldQuantity(s.bank.gold.quantityMg)]]) + '' + (presentation.features.fundCard ? '<div class="accounts-fund-actions"><button type="button" class="btn line-dark small pill" id="manage-fund-btn">Fonunu Birikim\'de aç</button></div>' : '') + '</div>' +
      '<button type="button" class="cc-tile" id="accounts-card-open">' + cardVisualHtml(s.card, true) + '<span class="cc-tile-body"><b>Kredi kartım</b><small>' + (s.card.statementDebt ? "Hesap özeti borcu " + A.money(s.card.statementDebt) : "Güncel dönem borcu " + A.money(s.card.periodDebt)) + '</small><small>Kullanılabilir limit ' + A.money(s.card.available) + '</small></span><span class="cc-tile-go" aria-hidden="true">→</span></button>' + portfolioCardHtml(s);
    if (pfHowOpen && el("portfolio-how")) el("portfolio-how").open = true;
    visible("cashflow-30", true); setGuardHtml("cashflow-30", cashflowCardHtml(s));
    renderSavedTransfers(s);
    renderAccountsLedger(s);
    renderComparisonViews();
    el("payment-schedule").innerHTML = s.bank.payments.map(function (x) { return '<div class="agent-ledger-row"><b>' + (x.kind === "bes" ? "BES katkısı" : x.label || (x.kind === "card-subscription" ? "Kart aboneliği" : "Abonelik ödemesi")) + '</b><span>' + A.money(x.amount) + '</span><small>' + A.escape(x.due) + '</small></div>'; }).join("");
    el("all-log").innerHTML = activity(s.events);
    text("preset-note", A.PRESETS.find(function (x) { return x.id === s.preset; }).note);
    el("tool-mode").value = s.nextToolMode;
    el("demo-state").innerHTML = rows([["Veri sürümü", String(s.dataVersion)], ["Ayırabileceğin", A.money(s.forecast.available)], ["Eksik kalan", A.money(s.forecast.shortfall)], ["İşlem için ayrılan", A.money(s.forecast.reserved)], ["Bu ay birikime ayrılan", A.money(s.monthlySavingsSpent)]]);
    el("technical-log").innerHTML = journal(s.events);
    text("story-title", taskId === "savings" ? "Birikim, günlük hayatına uyum sağlasın." : taskId === "subscription" ? "Fiyat değişikliği gözden kaçmasın." : taskId === "bes" ? "Geleceğin için, bugünkü bütçene göre." : "Koşulunu sen seç, takibi asistana bırak.");
    text("story-copy", taskId === "savings" ? "Ödemelerine yer bırakan bir tutar önerilir. Beklenmedik bir gider olursa, asistan yeniden hesaplar ve birikiminden hesabına alabileceğin tutarı sana sorar." : taskId === "subscription" ? "Ücret artışlarında haber almayı seçersin. Otomatik ödemelerini alt alta görür, önceki ve sıradaki tutarları karşılaştırırsın. Ödemelerin devam eder." : taskId === "bes" ? "Aylık katkını bütçene göre düzenlersin. Asistan gelecek ödemeleri ve devlet katkısı koşullarını açıklar." : "Alış ve satış fiyatı arasındaki fark için kendi sınırını belirlersin. Koşul oluştuğunda alımı ayrıca onaylarsın.");
    el("story-steps").innerHTML = (taskId === "subscription" ? ["Ücret artışında haber almayı seç.", "Ödemelerini tek listede gör.", "Sinaptikş olunca önceki ve yeni tutarı karşılaştır."] : ["Tutarı gör.", "İstersen nedenini öğren, tutarı değiştir.", "İşlemi son ekranda onayla."]).map(function (step) { return "<li>" + A.escape(step) + "</li>"; }).join("");
    var def = A.TASKS[view.active];
    el("research-trace").innerHTML = '<h3>' + A.escape(def.title) + '</h3><p>' + A.escape(def.rationale) + '</p><ul class="evlist">' + def.evidence.map(function (key) { var e = A.EVIDENCE[key]; return '<li><div class="ev-top"><span>' + A.escape(e.label) + '</span><b>' + e.n + '/' + e.denominator + '</b></div></li>'; }).join("") +
      '</ul><p class="agent-muted">' + A.escape(A.RESEARCH.note) + '</p><p class="agent-muted">Kaynak: ' + A.escape(A.RESEARCH.source) + '.</p>';
    applyPresentation();
    renderEraStory();
    stepDisclosures();
    // 21 Ekim (sahip): transfer makbuzu iki kez görünüyordu. Aynı metin ×'li transfer bildiriminde varsa üstteki mesaj gizlenir.
    var noticeSays = !el("transfer-notice").hidden && el("transfer-notice-copy").textContent === view.message;
    text("agent-message", view.message); el("agent-message").hidden = !view.message || noticeSays;
    el("agent-message").classList.toggle("is-flash", !!view.message && !!view.messageFlash);
    kisaCopy();
    if (A.applyIndependentBrand) A.applyIndependentBrand();
    var announcement = def.title + ": " + statusNames[t.status];
    if (announcement !== lastStatus) { text("agent-live", announcement); lastStatus = announcement; }
  }
  async function command(c) {
    var generation = A.agent.getSnapshot().generation, request = ++commandSerial;
    if (!["approve", "cancel-transfer", "reconcile", "share-receipt", "human-review"].includes(c.type)) view.transferNoticeId = null;
    view.message = ""; A.telemetry.log("user-command", { type: c.type, taskId: c.taskId });
    var result = await A.agent.dispatch(c), s = A.agent.getSnapshot();
    if (s.generation !== generation || request !== commandSerial) return result;
    // Geri al beklemesi olmayan işlemler (kendi hesap, deneme, diğer bankadan çekim) doğrudan sonuçlanır; bildirim önceki işlemde kalmasın.
    if (["approve", "trial-decision", "liquidity-decision"].includes(c.type) && result.operationId) view.transferNoticeId = result.operationId;
    var prepared = { "set-savings-amount": "savings", "set-bes-target": "bes", "watch-gold": "gold" }[c.type];
    if (result.ok && prepared === activeId()) rememberPlan();
    var cancelledOp = result.cancelled && s.operations.find(function (op) { return op.id === result.operationId; });
    if (result.cancelled && result.operationId) view.message = cancelledOp && TRIAL_KINDS.includes(cancelledOp.kind) ? "Kararın geri alındı. Hiçbir ayar değişmedi." : "Transfer iptal edildi. Paran hesaplarında kaldı.";
    // C1-03: sonucu belli olmayan işlemde kesin başarısızlık söylenmez.
    else if (!result.ok && result.unknown) view.message = "İşlemin sonucu henüz belli değil. Tekrar göndermeden kontrol edelim.";
    else if (!result.ok) view.message = plainReason(result.reason) || "İşlem tamamlanamadı.";
    else if (c.type === "approve" || c.type === "reconcile") {
      var t = s.tasks[c.taskId || activeId()];
      view.message = t.lastReceipt && view.page !== "detail" ? receiptCopy(t.lastReceipt) : "";
    } else if (c.type === "liquidity-decision") view.message = c.decision === "safe-pay" ? "Ayırabileceğin tutardan " + A.money(s.forecast.liquidityReserve) + " kırılgan gün için ayrıldı. Para hareket etmedi." : s.tasks.liquidity.lastReceipt ? receiptCopy(s.tasks.liquidity.lastReceipt) : "";
    else if (c.type === "clear-liquidity-reserve") view.message = "Kırılganlık payı kaldırıldı. Birikim önerin yeniden hesaplandı.";
    else if (c.type === "trial-decision") view.message = s.tasks.trial.lastReceipt ? receiptCopy(s.tasks.trial.lastReceipt) : "";
    // 24 Ekim: kalkan kararları kartta yazıyor; üst bildirim aynı cümleyi tekrarlamaz ve görüşme çubuğunu ("Bitir") kapatmaz.
    // Kalkan kartı kararını ve iptali kendisi söyler; üst bildirim aynı cümleyi tekrarlamaz.
    else if (["shield-cooldown", "shield-stop", "shield-answer", "shield-summary", "shield-cancel"].includes(c.type)) view.message = "";
    else if (c.type === "shield-protect") view.message = result.unchanged ? "" : "Yeni alıcılara gönderimler korumada. Kayıtlı alıcıların açık.";
    else if (c.type === "shield-release") view.message = "Yeni alıcı koruması kaldırıldı.";
    else if (c.type === "share-receipt") view.message = "Paylaşım taslağı hazırlandı";
    else if (c.type === "set-refund-tracker") view.message = "İade takibi başlatıldı.";
    else if (c.type === "close-refund-tracker") view.message = "İade takibi kapatıldı. Satıcıdaki iade sürecin etkilenmez.";
    else if (c.type === "watch-gold") view.message = "Koşulun kaydedildi. Alım için ayrıca onayını isteyeceğim.";
    else if (c.type === "set-price-alert") view.message = s.bank.priceAlerts.enabled ? "Ücret artışlarında haber vereceğim. Otomatik ödemelerin devam ediyor." : "Ücret artışı haberlerini kapattın. Otomatik ödemelerin devam ediyor.";
    else if (c.type === "permissions") view.message = "Ayarların kaydedildi. Otomatik para ayırma " + (s.permissions.autoSave ? "açık." : "kapalı.");
    else if (c.type === "revoke") view.message = "Otomatik para ayırma kapatıldı.";
    else if (c.type === "redeem-savings" && result.ok) view.message = A.money(c.amount) + " birikimden vadesiz hesabına geçti.";
    else if (c.type === "card-autopay" && result.ok) view.message = c.enabled ? "Otomatik ödeme talimatın açıldı. Bu ay için şimdi para çekilmedi." : "Otomatik ödeme talimatın kapatıldı.";
    else if (c.type === "card-pay" && result.ok) view.message = s.tasks.card.lastReceipt ? receiptCopy(s.tasks.card.lastReceipt) : "";
    else if (c.type === "deposit-savings" && result.ok) view.message = A.money(c.amount) + " fona aktarıldı.";
    else if (prepared) view.message = "";
    else if (c.type === "human-review") view.message = "İnceleme isteğin hazırlandı.";
    else if (c.type === "pause" || c.type === "resume") view.message = c.type === "pause" ? "Asistan takibi kapatıldı. Bankadaki talimatın değişmedi." : "Asistan takibi yeniden açıldı.";
    render(s); return result;
  }
  // Kart üstündeki düzenleme. Pay değiştiyse önce o uygulanır. Tutara dokunulmadıysa öneri yeni paya göre yeniden hesaplanır.
  async function saveCardEdit() {
    var generation = A.agent.getSnapshot().generation, from = view.cardEditFrom || {}, amount = A.parseMoney(el("card-savings-amount").value);
    var bufferText = el("card-buffer-amount").value.trim(), buffer = bufferText ? A.parseMoney(bufferText) : from.buffer;
    if (buffer === null) { formError("Güvenlik payı için geçerli bir TL tutarı gir."); return { ok: false }; }
    var bufferChanged = from.buffer !== undefined && buffer !== from.buffer, result = { ok: true };
    if (bufferChanged) result = await command({ type: "permissions", changes: { buffer: buffer } });
    if (result.ok && (!bufferChanged || amount !== from.amount)) result = await command({ type: "set-savings-amount", amount: amount });
    if (result.ok && bufferChanged) { view.message = ""; render(A.agent.getSnapshot()); }
    if (result.ok && generation === A.agent.getSnapshot().generation) {
      el("card-savings-form").hidden = true;
      fitCard();
      if (tour) { tour.scrolled = -1; tourPlace(); el("tour-next").focus({ preventScroll: true }); }
      else document.querySelector('[data-open="0"]').focus({ preventScroll: true });
    }
    return result;
  }
  function openFundFirst() {
    view.fundCardOpen = true; view.fundCardDismissed = false; view.fundFirstNext = true;
    go("savings");
    el("fund-title").setAttribute("tabindex", "-1"); el("fund-title").focus({ preventScroll: true });
  }
  function go(page, index) {
    if (!presentation.allowsPage(page)) return false;
    view.sentPlan = null; view.fundPending = null; view.fundSent = null;
    var requested = index === undefined ? view.active : (index + 4) % 4;
    if (page === "detail" && !presentation.allowsTask(A.TASKS[requested].id)) return false;
    var backFrom = view.page, backTask = activeId(), wasBack = document.activeElement && ["detail-back", "return-home"].includes(document.activeElement.id);
    view.active = !presentation.development && page !== "detail" ? 0 : requested;
    if (page === "card" && backFrom !== "card") view.cardFrom = backFrom === "home" ? "home" : "accounts";
    if (page === "detail" && backFrom !== "detail") view.detailFrom = ["home", "accounts", "transfer"].includes(backFrom) ? backFrom : "savings";
    // 18 Ekim (iki katılımcı): Hesaplarım'dan gelince fon kartı en üstte açılır; Birikim sekmesine normal gelişte yerine döner.
    view.fundFirst = page === "savings" && !!view.fundFirstNext; view.fundFirstNext = false;
    view.page = page; view.message = ""; view.messageFlash = false; view.transferNoticeId = null; view.shareOpen = false; view.humanReviewOpen = false; view.transferReviewOpen = false; view.chatOpen = false;
    if (page === "detail") {
      syncForms(A.agent.getSnapshot()); rememberPlan();
      ["amount-editor", "settings-details", "calculation-details", "journey-details"].forEach(function (id) { el(id).open = false; });
    }
    render(A.agent.getSnapshot()); el("screen").scrollTop = 0;
    if (!wasBack) { if (page !== "home") el("screen-title").focus({ preventScroll: true }); }
    else (backFrom === "comparison" ? el("home-comparison") : page === "home" ? (backTask === "subscription" ? el("home-payments") : el("home-nudge-open")) : page === "savings" ? document.querySelector('[data-open="' + (presentation.development ? view.active : 0) + '"]') : el("screen-title")).focus({ preventScroll: true });
    A.telemetry.log("navigation", { page: page });
    return true;
  }
  async function openOffer(index, edit) {
    if (!go("detail", index)) return;
    A.telemetry.log("offer-open", { taskId: activeId() });
    var taskId = activeId(), s = A.agent.getSnapshot(), p = s.plans[taskId], t = s.tasks[taskId];
    if (t.paused) { el("settings-details").open = true; return; }
    if (["pending", "running", "unknown"].includes(t.status)) return;
    if (taskId === "savings" && t.status === "cancelled") {
      var amount = s.forecast.shortfall || (s.permissions.autoSave ? Math.min(s.forecast.available, Math.max(0, s.permissions.monthlyLimit - s.monthlySavingsSpent)) : s.forecast.available);
      if (amount > 0) await command({ type: "set-savings-amount", amount: amount });
    }
    if (taskId === "subscription") await command({ type: "read-automatic-payments" });
    if (taskId === "bes" && !(p && ["awaiting", "blocked"].includes(p.status)) && t.status !== "succeeded") {
      await command({ type: "set-bes-target", amount: s.goals.bes.target });
    }
    if (edit && ["bes", "savings"].includes(taskId)) { el("amount-editor").open = true; el(taskId === "bes" ? "bes-amount" : "savings-amount").focus(); }
  }
  function selectCard(i) {
    if (!presentation.development) return;
    view.active = (i + 4) % 4; view.message = "";
    render(A.agent.getSnapshot());
  }
  function reset(preset) {
    // SA-01: karşılaştırma referansı (ör. Katılım Hesabı) sıfırlamada hatırlanmaz; vekil sinyal saklanmaz.
    view = { page: "home", active: 0, message: "", transferNoticeId: null, dismissedTransferNoticeId: null, expandedDays: {}, ledgerSearch: "", selectedGoldRef: presentation.defaultReference, selectedGoldPoint: 6, shareOpen: false, shareCustomNote: undefined, refundFormOpen: null, dismissedRefundNoticeId: null, humanReviewOpen: false, transferReviewOpen: false, chatOpen: false, chatMessages: [], chatReviewTaskId: null, shieldReviewOpen: false, shieldDismissed: false, dismissedTrials: {}, liquidityDismissed: null, cryptoDismissed: false, transferLabOpen: false, fundCardOpen: false, fundCardDismissed: false, stmt: newStmt() }; reviewedPlan = null; commandSerial++;
    era.barOpen = false; era.taps = []; era.near = newNear(); era.future = newFuture(); eraSay("");
    var s = A.agent.reset(preset || "main");
    el("demo-preset").value = s.preset;
    document.querySelectorAll("#screen details").forEach(function (d) { d.open = false; });
    el("card-savings-form").hidden = true;
    if (el("saved-transfer-review")) el("saved-transfer-review").hidden = true;
    if (el("transfer-share-preview")) el("transfer-share-preview").hidden = true;
    if (el("transfer-review-preview")) el("transfer-review-preview").hidden = true;
    if (el("human-review-panel")) el("human-review-panel").hidden = true;
    if (el("shield-review-panel")) el("shield-review-panel").hidden = true;
    if (el("refund-notice")) el("refund-notice").hidden = true;
    if (el("assistant-chat-view")) el("assistant-chat-view").hidden = true;
    if (el("ledger-search")) el("ledger-search").value = "";
    if (el("ledger-search-clear")) el("ledger-search-clear").hidden = true;
    syncForms(s); render(s); el("screen").scrollTop = 0;
  }
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function formError(message) { view.message = message; view.messageFlash = false; render(A.agent.getSnapshot()); }
  // Kısa bilgi notu: birkaç saniye görünür, sonra (aynı not hâlâ duruyorsa) soner. Süre CONFIG.flashMs ile değişir (testler kısaltır).
  var flashSerial = 0;
  function flashMessage(message) {
    var token = ++flashSerial, ms = Math.max(0, Number(A.CONFIG.flashMs === undefined ? 4000 : A.CONFIG.flashMs));
    view.message = message; view.messageFlash = true; render(A.agent.getSnapshot());
    setTimeout(function () { if (token !== flashSerial || view.message !== message) return; view.message = ""; view.messageFlash = false; render(A.agent.getSnapshot()); }, ms);
  }
  // 24 Ekim (sahip: "bilgi birden gelmesin"): açıklama bölümleri iki kademe. Açınca önce rakamlar (ilk tablo/zaman çizelgesi);
  // paragraflar, kaynaklar ve karşılaştırma etiketi küçük bir "Nasıl hesapladım?" dokunuşunun arkasında. Seçim aynı bölüm için hatırlanır.
  function stepDisclosures() {
    document.querySelectorAll("#screen details[data-step]").forEach(function (d) {
      if (d.querySelector(".disc-more")) return;
      var first = d.querySelector(".rows, .cashflow-timeline"); if (!first) return;
      // Rakamlara bağlı eylemler (ör. "Ayın kalan giderleri · detay öğren") ilk kademede kalır; yalnız açıklama ikinciye geçer.
      var rest = []; for (var n = first.nextSibling; n; n = n.nextSibling) if ((n.nodeType === 1 && !n.matches("button")) || (n.nodeType === 3 && n.textContent.trim())) rest.push(n);
      if (!rest.length) return;
      var key = d.dataset.step, open = !!(view.more || {})[key], parent = first.parentElement;
      var btn = document.createElement("button"); btn.type = "button"; btn.className = "disc-more-btn"; btn.dataset.more = key;
      var box = document.createElement("div"); box.className = "disc-more"; box.hidden = !open; box.id = "more-" + key;
      btn.setAttribute("aria-expanded", String(open)); btn.setAttribute("aria-controls", box.id); btn.textContent = open ? "Daha az göster" : "Nasıl hesapladım?";
      rest.forEach(function (x) { box.appendChild(x); });
      parent.appendChild(btn); parent.appendChild(box);
    });
  }
  function bindRiskStack() {
    document.addEventListener("click", function (e) {
      var m = e.target.closest && e.target.closest("[data-more]"); if (!m) return;
      var more = view.more || (view.more = {}), key = m.dataset.more, open = !more[key];
      more[key] = open; m.setAttribute("aria-expanded", String(open)); m.textContent = open ? "Daha az göster" : "Nasıl hesapladım?";
      var box = el(m.getAttribute("aria-controls")); if (box) box.hidden = !open;
    });
    // Kademeli risk göstergesi: her dokunuş bir katman açar (0 → 1 → 2 → 3 → 0); seçilen derinlik aynı transfer için korunur.
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-risk-stack]"); if (!b) return;
      var ctx = b.dataset.riskStack, levels = view.riskLevel || (view.riskLevel = {});
      levels[ctx] = ((levels[ctx] || 0) + 1) % (Number(b.dataset.depth) || RISK_DEPTH);
      render(A.agent.getSnapshot());
      var again = document.querySelector('[data-risk-stack="' + ctx + '"]'); if (again) again.focus({ preventScroll: true });
    });
  }
  function bind() {
    bindRiskStack();
    bindEra();
    document.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () {
      var index = Number(b.dataset.open);
      if (!presentation.development && index !== 0) return;
      if (index === 0 && statementHold(A.agent.getSnapshot())) { openCardPay(); return; }
      if (index === 1 && !A.agent.getSnapshot().tasks.subscription.paused && !A.agent.getSnapshot().bank.priceAlerts.enabled) command({ type: "set-price-alert", enabled: true });
      else openOffer(index);
    }; });
    document.querySelectorAll("[data-edit]").forEach(function (b) { b.onclick = function () {
      var index = Number(b.dataset.edit);
      if (!presentation.development && index !== 0) return;
      A.telemetry.log("amount-edit", { taskId: A.TASKS[index].id });
      if (index === 0) {
        var s = A.agent.getSnapshot(), p = s.plans.savings;
        el("card-savings-amount").value = ((p && p.kind === "save" ? p.amount : s.forecast.available) / 100).toString();
        el("card-buffer-amount").value = (s.forecast.buffer / 100).toString();
        view.cardEditFrom = { amount: A.parseMoney(el("card-savings-amount").value), buffer: s.forecast.buffer };
        el("card-savings-form").hidden = false; el("card-savings-amount").focus();
        updateBudgetPreview("card-savings-amount", "card-savings-impact");
        fitCard();
        if (tour) { tour.scrolled = -1; setTimeout(tourPlace, 0); }
      } else openOffer(index, true);
    }; });
    document.querySelectorAll("[data-skip]").forEach(function (b) { b.onclick = function () {
      A.telemetry.log("skip-offer", { taskId: activeId() });
      if (!presentation.development) {
        visible("card-savings-form", false);
        // 28 Ekim (sahip): bu not sonsuza kadar kalıyordu. Kısa süre görünür, yumuşakça söner; öneri yerinde durur.
        flashMessage("Şimdilik ayırmadın. Öneri burada kalıyor.");
        b.focus({ preventScroll: true });
        return;
      }
      var next = (Number(b.dataset.skip) + 1) % 4;
      selectCard(next);
      view.message = "Şimdilik geçtin. Herhangi bir işlem veya ayar değişmedi.";
      render(A.agent.getSnapshot());
      document.querySelector('[data-open="' + next + '"]').focus({ preventScroll: true });
    }; });
    document.querySelectorAll("[data-card]").forEach(function (b) { b.onclick = function () { selectCard(Number(b.dataset.card)); }; });
    document.querySelectorAll("[data-page]").forEach(function (b) { b.onclick = function () { go(b.dataset.page); }; });
    el("home-comparison").onclick = function () { go("comparison"); };
    el("home-nudge-open").onclick = function () { go("savings"); };
    el("cashflow-30").addEventListener("click", function (e) { if (e.target.closest("#cf30-buffer-edit")) { el("home-settings").onclick(); var b = el("permission-buffer"); if (b && b.scrollIntoView) b.scrollIntoView({ block: "center" }); return; } if (!e.target.closest("#cf30-solve")) return; go("home"); var h = el("liquidity-guard-title"); if (h) { h.focus({ preventScroll: true }); if (h.scrollIntoView) h.scrollIntoView({ block: "start" }); } });
    el("home-cashflow").onclick = function () { go("accounts"); var h = el("cashflow-30-title"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); if (h.scrollIntoView) h.scrollIntoView({ block: "start" }); } };
    el("home-shield-open").onclick = function () { go("transfer"); var h = el("scam-shield-title"); if (h) h.focus({ preventScroll: true }); };
    el("home-payments").onclick = function () { openOffer(1, true); };
    el("accounts-payments").onclick = function () { openOffer(1, true); };
    // Görev 09 (16 Ekim, sahip): ödemeler "Para gönder" sekmesinde de aranıyor; aynı ekrana gider.
    el("transfer-payments").onclick = function () { openOffer(1, true); };
    el("trial-payments-notice").addEventListener("click", function (e) {
      if (!e.target.closest("#trial-payments-go")) return;
      go("home"); var t = el("trial-guard-title"); if (t) { if (t.scrollIntoView) t.scrollIntoView({ block: "start" }); t.focus({ preventScroll: true }); }
    });
    function clearLedgerSearch() {
      view.ledgerSearch = "";
      view.expandedDays = {};
      if (el("ledger-search")) el("ledger-search").value = "";
      visible("ledger-search-clear", false);
      render(A.agent.getSnapshot());
      if (el("ledger-search")) el("ledger-search").focus();
    }
    if (el("ledger-search")) {
      el("ledger-search").addEventListener("input", function (e) {
        var val = e.target.value.trim();
        if (val !== view.ledgerSearch) {
          view.expandedDays = {};
          view.ledgerSearch = val;
        }
        visible("ledger-search-clear", !!view.ledgerSearch);
        render(A.agent.getSnapshot());
      });
      el("ledger-search").addEventListener("search", function () {
        if (!el("ledger-search").value) clearLedgerSearch();
      });
      el("ledger-search").addEventListener("keydown", function (e) {
        if (e.key === "Escape" && (view.ledgerSearch || el("ledger-search").value)) {
          e.preventDefault();
          clearLedgerSearch();
        } else if (e.key === "ArrowDown") {
          var firstHeader = el("accounts-ledger").querySelector(".ledger-day-header");
          if (firstHeader) {
            e.preventDefault();
            firstHeader.focus();
          }
        }
      });
    }
    if (el("ledger-search-clear")) {
      el("ledger-search-clear").addEventListener("click", clearLedgerSearch);
    }
    // Nudge: bilgi taşıyan günleri açar ve ilk "i"ye odaklanır; bilgiyi kendiliğinden açmaz.
    el("ledger-info-chip").onclick = function () {
      var snapNow = A.agent.getSnapshot(), ecoTxs = snapNow.bank.transactions.filter(function (t) { return ECO_LEDGER[t.category]; });
      view.ecoChipUsed = true; ecoTxs.forEach(function (t) { view.expandedDays[A.simulationDay(t.at)] = true; }); render(snapNow);
      var firstInfo = document.querySelector("#accounts-ledger [data-eco-info]"); if (firstInfo) { firstInfo.focus({ preventScroll: true }); if (firstInfo.scrollIntoView) firstInfo.scrollIntoView({ block: "center" }); }
    };
    el("accounts-ledger").addEventListener("click", function (e) {
      var ecoBtn = e.target.closest("[data-eco-info]");
      if (ecoBtn) {
        var ecoId = ecoBtn.dataset.ecoInfo; view.ecoOpen = view.ecoOpen || {};
        view.ecoOpen[ecoId] = !view.ecoOpen[ecoId]; A.telemetry.log("eco-info", { open: view.ecoOpen[ecoId] }); render(A.agent.getSnapshot());
        var ecoAgain = document.querySelector('[data-eco-info="' + ecoId + '"]'); if (ecoAgain) ecoAgain.focus({ preventScroll: true });
        return;
      }
      var ecoCta = e.target.closest("[data-eco-open]");
      if (ecoCta) { var product = ecoCta.dataset.ecoOpen; A.telemetry.log("eco-open", { product: product }); view.message = product === "crypto" ? "Stablex ayrı bir uygulamadır. Tanıtım sayfası açılır." : "Akbank Mobil'de BES ekranı açılır."; render(A.agent.getSnapshot()); return; }

      var info = e.target.closest("[data-attention-info]");
      if (info) {
        var txId = info.dataset.attentionInfo; view.attentionOpen = view.attentionOpen || {};
        view.attentionOpen[txId] = !view.attentionOpen[txId]; render(A.agent.getSnapshot());
        var again = document.querySelector('[data-attention-info="' + txId + '"]'); if (again) again.focus({ preventScroll: true });
        return;
      }
      var emptyClear = e.target.closest("#ledger-empty-clear");
      if (emptyClear) {
        clearLedgerSearch();
        return;
      }
      var refundOpen = e.target.closest(".btn-refund-track");
      if (refundOpen) {
        var ref = refundOpen.dataset.refundRef;
        if (ref) {
          view.refundFormOpen = ref;
          render(A.agent.getSnapshot());
          var input = el("refund-input-" + ref);
          if (input) input.focus();
        }
        return;
      }
      var refundCancel = e.target.closest(".btn-refund-cancel");
      if (refundCancel) {
        view.refundFormOpen = null;
        render(A.agent.getSnapshot());
        return;
      }
      var refundStart = e.target.closest(".btn-refund-start");
      if (refundStart) {
        var ref = refundStart.dataset.refundRef;
        if (ref) {
          var input = el("refund-input-" + ref);
          var kurus = input ? A.parseMoney(input.value) : null;
          if (kurus === null || kurus <= 0) return formError("Geçerli bir TL tutarı gir.");
          view.refundFormOpen = null;
          command({ type: "set-refund-tracker", originalRef: ref, expectedAmount: kurus });
        }
        return;
      }
      var refundClose = e.target.closest(".btn-refund-close");
      if (refundClose) {
        var ref = refundClose.dataset.refundRef;
        if (ref) {
          command({ type: "close-refund-tracker", originalRef: ref });
        }
        return;
      }
      var header = e.target.closest("[data-toggle-day]");
      if (!header) return;
      var dayKey = header.dataset.toggleDay;
      if (!dayKey) return;
      var wasExpanded = header.getAttribute("aria-expanded") === "true";
      view.expandedDays[dayKey] = !wasExpanded;
      render(A.agent.getSnapshot());
      var newHeader = el("ledger-header-" + dayKey);
      if (newHeader) newHeader.focus({ preventScroll: true });
    });
    el("accounts-ledger").addEventListener("keydown", function (e) {
      var header = e.target.closest(".ledger-day-header");
      if (!header) return;
      var headers = Array.from(el("accounts-ledger").querySelectorAll(".ledger-day-header"));
      var idx = headers.indexOf(header);
      if (idx === -1) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        var next = headers[(idx + 1) % headers.length];
        if (next) next.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        var prev = headers[(idx - 1 + headers.length) % headers.length];
        if (prev) prev.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        if (headers[0]) headers[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        if (headers[headers.length - 1]) headers[headers.length - 1].focus();
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        header.click();
      }
    });
    el("detail-back").onclick = el("return-home").onclick = function () { go(view.page === "comparison" ? "savings" : view.page === "card" ? view.cardFrom || "accounts" : view.detailFrom || "home"); };
    el("home-settings").onclick = function () { go("detail", 0); el("settings-details").open = true; el("settings-details").querySelector("summary").focus(); };
    el("card-prev").onclick = function () { selectCard(view.active - 1); };
    el("card-next").onclick = function () { selectCard(view.active + 1); };
    el("refresh-review").onclick = function () { rememberPlan(); view.message = ""; render(A.agent.getSnapshot()); };
    el("approve-plan").onclick = function () {
      if (reviewedPlan && reviewedPlan.taskId === activeId()) {
        view.sentPlan = reviewedPlan.id;
        command({ type: "approve", taskId: activeId(), planId: reviewedPlan.id, version: reviewedPlan.version });
        if (!el("undo-transfer").hidden) el("undo-transfer").focus({ preventScroll: true });
      }
    };
    el("undo-transfer").onclick = function () { if (el("undo-transfer").dataset.operationId) command({ type: "cancel-transfer", operationId: el("undo-transfer").dataset.operationId }); };
    if (el("transfer-notice-reconcile")) {
      el("transfer-notice-reconcile").onclick = function () {
        var op = A.agent.getSnapshot().operations.find(function (o) { return o.id === view.transferNoticeId; });
        if (op && op.status === "unknown") command({ type: "reconcile", operationId: op.id });
      };
    }
    if (el("transfer-notice-share")) {
      el("transfer-notice-share").onclick = function () {
        view.shareOpen = !view.shareOpen;
        render(A.agent.getSnapshot());
        if (view.shareOpen && el("transfer-share-note")) {
          el("transfer-share-note").focus();
        }
      };
    }
    if (el("transfer-share-close")) {
      el("transfer-share-close").onclick = function () {
        view.shareOpen = false;
        render(A.agent.getSnapshot());
        if (el("transfer-notice-share")) el("transfer-notice-share").focus({ preventScroll: true });
      };
    }
    if (el("transfer-share-cancel")) {
      el("transfer-share-cancel").onclick = function () {
        view.shareOpen = false;
        render(A.agent.getSnapshot());
        if (el("transfer-notice-share")) el("transfer-notice-share").focus({ preventScroll: true });
      };
    }
    if (el("transfer-notice-close")) {
      el("transfer-notice-close").onclick = function () {
        if (view.transferNoticeId) view.dismissedTransferNoticeId = view.transferNoticeId;
        view.transferNoticeId = null;
        view.shareOpen = false;
        render(A.agent.getSnapshot());
      };
    }
    if (el("transfer-share-confirm")) {
      el("transfer-share-confirm").onclick = async function () {
        var s = A.agent.getSnapshot();
        var op = s.operations.find(function (o) { return o.id === view.transferNoticeId; });
        if (!op) return;
        if (op.shareDraft) {
          view.shareOpen = false;
          render(A.agent.getSnapshot());
          if (el("transfer-notice-share")) el("transfer-notice-share").focus({ preventScroll: true });
          return;
        }
        var noteVal = el("transfer-share-note") ? el("transfer-share-note").value : "";
        view.shareCustomNote = noteVal;
        var res = await command({
          type: "share-receipt",
          operationId: op.id,
          note: noteVal,
          message: A.money(op.amount) + " gönderdim."
        });
        if (res && res.ok) {
          setTimeout(function () {
            if (view.shareOpen) {
              view.shareOpen = false;
              render(A.agent.getSnapshot());
            }
          }, 1500);
        }
      };
    }
    if (el("transfer-share-note")) {
      el("transfer-share-note").addEventListener("input", function (e) {
        view.shareCustomNote = e.target.value;
      });
    }
    if (el("saved-transfers-list")) {
      el("saved-transfers-list").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-saved-transfer]");
        if (!btn) return;
        var savedId = btn.dataset.savedTransfer;
        if (!savedId) return;
        command({ type: "prepare-saved-transfer", savedId: savedId });
      });
    }
    if (el("approve-saved-transfer")) {
      el("approve-saved-transfer").onclick = function () {
        var p = A.agent.getSnapshot().plans.transfer;
        if (p && p.status === "awaiting") {
          view.sentPlan = p.id;
          command({ type: "approve", taskId: "transfer", planId: p.id, version: p.version });
          if (!el("undo-transfer").hidden) el("undo-transfer").focus({ preventScroll: true });
        }
      };
    }
    if (el("cancel-saved-review")) {
      el("cancel-saved-review").onclick = function () {
        var s = A.agent.getSnapshot();
        delete s.plans.transfer;
        if (s.tasks.transfer) s.tasks.transfer.status = "monitoring";
        render(s);
      };
    }
    if (el("home-saved-transfer")) {
      el("home-saved-transfer").onclick = function () {
        go("transfer");
        var sec = el("saved-transfers-section");
        if (sec) sec.scrollIntoView({ behavior: "smooth" });
      };
    }
    el("card-savings-amount").addEventListener("input", function () { updateBudgetPreview("card-savings-amount", "card-savings-impact"); fitCard(); });
    el("savings-amount").addEventListener("input", function () { updateBudgetPreview("savings-amount", "savings-impact"); });
    el("reconcile-operation").onclick = function () { var op = A.agent.getSnapshot().operations.find(function (o) { return o.taskId === activeId() && o.status === "unknown"; }); if (op) command({ type: "reconcile", operationId: op.id }); };
    el("check-all").onclick = function () { command({ type: "check" }); };
    el("price-alert-toggle").onclick = function () { command({ type: "set-price-alert", enabled: !A.agent.getSnapshot().bank.priceAlerts.enabled }); };
    el("card-savings-form").onsubmit = async function (e) { e.preventDefault(); await saveCardEdit(); };
    el("savings-form").onsubmit = function (e) { e.preventDefault(); command({ type: "set-savings-amount", amount: A.parseMoney(el("savings-amount").value) }); };
    el("bes-form").onsubmit = function (e) { e.preventDefault(); command({ type: "set-bes-target", amount: A.parseMoney(el("bes-amount").value) }); };
    el("gold-form").onsubmit = function (e) {
      e.preventDefault(); command({ type: "watch-gold", amount: A.parseMoney(el("gold-budget").value), thresholdBps: A.parseMoney(el("gold-threshold").value) });
    };
    el("permissions-form").onsubmit = function (e) {
      e.preventDefault(); var action = A.parseMoney(el("permission-action").value), month = A.parseMoney(el("permission-month").value), buffer = A.parseMoney(el("permission-buffer").value);
      if (action === null || month === null || buffer === null) return formError("Geçerli TL tutarları gir.");
      // Pay alanı değişmediyse gönderilmez; yoksa her kayıt otomatik (portföye göre) payı elle girilmiş gibi dondururdu.
      var changes = { autoSave: el("permission-auto").checked, perAction: action, monthlyLimit: month };
      if (buffer !== A.agent.getSnapshot().permissions.buffer) changes.buffer = buffer;
      command({ type: "permissions", changes: changes });
    };
    el("settings-details").addEventListener("toggle", function () { if (el("settings-details").open) syncPermissionForms(A.agent.getSnapshot()); });
    el("revoke-permission").onclick = async function () { await command({ type: "revoke" }); syncPermissionForms(A.agent.getSnapshot()); };
    el("pause-task").onclick = function () { command({ type: A.agent.getSnapshot().tasks[activeId()].paused ? "resume" : "pause", taskId: activeId() }); };
    el("human-review").onclick = function () {
      view.humanReviewOpen = !view.humanReviewOpen;
      if (view.humanReviewOpen) {
        command({ type: "human-review", taskId: activeId() });
      } else {
        render(A.agent.getSnapshot());
      }
    };
    if (el("human-review-close")) el("human-review-close").onclick = function () { view.humanReviewOpen = false; render(A.agent.getSnapshot()); };
    if (el("human-review-cancel")) el("human-review-cancel").onclick = function () { view.humanReviewOpen = false; render(A.agent.getSnapshot()); };
    if (el("human-review-save")) {
      el("human-review-save").onclick = function () { saveInlineReview("review-input"); };
    }

    if (el("transfer-notice-review")) {
      el("transfer-notice-review").onclick = function () {
        view.transferReviewOpen = !view.transferReviewOpen;
        if (view.transferReviewOpen) {
          var noticeOp = A.agent.getSnapshot().operations.find(function (op) { return op.id === view.transferNoticeId; });
          if (noticeOp) command({ type: "human-review", taskId: noticeOp.taskId });
        } else {
          render(A.agent.getSnapshot());
        }
      };
    }
    if (el("transfer-review-close")) el("transfer-review-close").onclick = function () { view.transferReviewOpen = false; render(A.agent.getSnapshot()); };
    if (el("transfer-review-cancel")) el("transfer-review-cancel").onclick = function () { view.transferReviewOpen = false; render(A.agent.getSnapshot()); };
    if (el("transfer-review-save")) {
      el("transfer-review-save").onclick = function () { saveInlineReview("transfer-review"); };
    }

    function wireReviewSync(prefix) {
      var q = el(prefix + "-question"), opInfo = el(prefix + "-operation"), ver = el(prefix + "-verified"), unc = el(prefix + "-uncertainty"), sum = el(prefix + "-summary");
      if (!sum) return;
      function changed(summaryEdited) {
        var draft = view.inlineReviewDrafts && view.inlineReviewDrafts[prefix]; if (!draft) return;
        if (summaryEdited) draft.userEdited = true;
        if (!draft.userEdited) {
          var parts = [];
          if (opInfo && opInfo.value.trim()) parts.push("İlgili işlem: " + opInfo.value.trim() + ".");
          if (ver && ver.value.trim()) parts.push(ver.value.trim());
          if (unc && unc.value.trim()) parts.push(unc.value.trim());
          if (q && q.value.trim()) parts.push(q.value.trim());
          sum.value = parts.join(" ");
        }
        draft.values = { question: q.value, operation: opInfo.value, verified: ver.value, uncertainty: unc.value, summary: sum.value };
        draft.dirty = true; sum.dataset.userEdited = draft.userEdited ? "true" : "false"; renderReviewReadable(prefix, draft);
        var controls = inlineReviewControls(prefix); text(controls.save, "Özet taslağını kaydet"); visible(controls.status, false);
      }
      [q, opInfo, ver, unc].forEach(function (input) { if (input) input.addEventListener("input", function () { changed(false); }); });
      sum.addEventListener("input", function () { changed(true); });
    }

    wireReviewSync("review-input");
    wireReviewSync("transfer-review");
    wireReviewSync("shield-review");
    function closeShieldReview() { view.shieldReviewOpen = false; render(A.agent.getSnapshot()); var opener = document.querySelector('[data-guard-action="shield-review"]'); if (opener) opener.focus({ preventScroll: true }); }
    el("shield-review-close").onclick = closeShieldReview;
    el("shield-review-cancel").onclick = closeShieldReview;
    el("shield-review-save").onclick = function () { saveInlineReview("shield-review"); };
    // Nöbetçi kartları her render'da güncellenebildiği için tek dinleyiciyle bağlanır.
    function openTransferLab() {
      if (view.page !== "transfer") go("transfer");
      var call = A.agent.getSnapshot().device.call;
      view.transferLabOpen = true; view.incomingCall = !(call && call.active); render(A.agent.getSnapshot()); el("new-transfer-title").focus({ preventScroll: true });
    }
    A.openTransferLab = openTransferLab;
    el("home-new-transfer").onclick = el("transfer-new").onclick = openTransferLab;
    el("home-scan-payment").onclick = el("transfer-scan").onclick = function () {
      if (view.page !== "transfer") go("transfer");
      view.scanOpen = true; view.scan = newScan(); scanGen++; view.transferLabOpen = false; render(A.agent.getSnapshot()); el("scan-title").focus({ preventScroll: true });
    };
    el("new-transfer-close").onclick = function () { view.transferLabOpen = false; view.incomingCall = false; render(A.agent.getSnapshot()); el("transfer-new").focus({ preventScroll: true }); };
    ["nt-iban", "nt-amount", "nt-payee"].forEach(function (id) { el(id).addEventListener("input", function () { renderTransferLab(A.agent.getSnapshot()); }); });
    el("nt-switch").onclick = function () { reset("security"); openTransferLab(); };
    el("nt-example").onclick = function () { el("nt-payee").value = "Güvenli Hesap Hizmetleri"; el("nt-iban").value = "TR 9047"; el("nt-amount").value = A.agent.getSnapshot().preset === "security" ? "230000" : String(Math.round(A.agent.getSnapshot().balances.cash / 100)); renderTransferLab(A.agent.getSnapshot()); el("nt-amount").focus(); };
    el("incoming-accept").onclick = async function () { view.incomingCall = false; await command({ type: "event", event: "call-start", caller: "112" }); el("call-banner-end").focus({ preventScroll: true }); };
    el("incoming-decline").onclick = function () { view.incomingCall = false; render(A.agent.getSnapshot()); el("new-transfer-title").focus({ preventScroll: true }); };
    el("call-banner-end").onclick = function () { command({ type: "event", event: "call-end" }); };
    // 1. adım: tutar ve yön kontrol edilir, onay özeti açılır. Para hareketi yalnız 2. adımda.
    function prepareFund(dir) {
      var amount = A.parseMoney(el("fund-amount").value);
      if (!amount) return formError("Geçerli bir TL tutarı gir.");
      var s = A.agent.getSnapshot();
      if (dir === "deposit" && amount > s.balances.cash) return formError("Vadesiz hesap bakiyen bu tutar için yetersiz.");
      if (dir === "redeem" && amount > s.balances.savings) return formError("Birikim bakiyen bu tutar için yetersiz.");
      view.fundPending = { dir: dir, amount: amount }; view.fundSent = null; view.message = "";
      render(s); el("fund-confirm-btn").focus({ preventScroll: true });
    }
    el("fund-deposit-btn").onclick = function () { prepareFund("deposit"); };
    el("fund-redeem-btn").onclick = function () { prepareFund("redeem"); };
    el("fund-confirm-btn").onclick = async function () {
      var fpend = view.fundPending; if (!fpend) return;
      var r = await command({ type: fpend.dir === "deposit" ? "deposit-savings" : "redeem-savings", amount: fpend.amount });
      view.fundPending = null;
      if (r.ok) { view.fundSent = { amount: fpend.amount }; el("fund-amount").value = ""; view.fundAmountDirty = false; }
      render(A.agent.getSnapshot());
    };
    el("fund-confirm-cancel").onclick = function () { var dir = view.fundPending && view.fundPending.dir; view.fundPending = null; render(A.agent.getSnapshot()); if (dir) el(dir === "deposit" ? "fund-deposit-btn" : "fund-redeem-btn").focus({ preventScroll: true }); };
    // Klavyedeki "Git" yön seçmez; klavyeyi kapatır, canlanan düğmeler görünür. Güvenlik senaryosu (Görev 11) fonu boşaltmayla başladığı için orada geri alma onayını açar.
    el("fund-form").onsubmit = function (e) {
      e.preventDefault();
      if (A.agent.getSnapshot().preset === "security") return prepareFund("redeem");
      el("fund-amount").blur();
    };
    // Fon seçimi: önce onay sorulur; yalnız "Geç" motora gider.
    el("fund-card").addEventListener("click", function (e) {
      var opt = e.target.closest("[data-fund-choice]");
      if (opt) { view.fundChoicePending = opt.dataset.fundChoice; view.fundSwitched = null; render(A.agent.getSnapshot()); var box = el("fund-choice-confirm"), yes = el("fund-choice-yes"); if (yes && !box.hidden) { yes.focus({ preventScroll: true }); if (box.scrollIntoView) box.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }
    });
    el("fund-choice-yes").onclick = async function () { var target = view.fundChoicePending, bal = A.agent.getSnapshot().balances.savings; view.fundChoicePending = null; view.fundAmountDirty = false; view.fundPending = null; view.fundSent = null; el("fund-amount").value = "";
      var r = await command({ type: "set-fund-product", code: target });
      if (r && r.ok) { view.fundSwitched = bal > 0 ? fundIn(target === "AIS" ? "ALE" : "AIS") + "ki " + A.money(bal) + " satıldı, " + target + " alındı. İki işlem de hesap hareketlerinde." : "Birikimin artık " + (target === "AIS" ? "katılım fonunda (AIS)." : "para piyasası fonunda (ALE)."); render(A.agent.getSnapshot()); } var b = document.querySelector('[data-fund-choice="' + target + '"]'); if (b) b.focus({ preventScroll: true }); };
    el("fund-choice-no").onclick = function () { var cur = A.agent.getSnapshot().fund.product.code; view.fundChoicePending = null; render(A.agent.getSnapshot()); var b = document.querySelector('[data-fund-choice="' + cur + '"]'); if (b) b.focus({ preventScroll: true }); };
    // Tutar değişirse yarım kalan onay ve önceki "✓" kapanır; yeni işlem baştan (1/2) başlar.
    el("fund-amount").addEventListener("input", function () { view.fundAmountDirty = true; if (view.fundPending || view.fundSent) { view.fundPending = null; view.fundSent = null; render(A.agent.getSnapshot()); } else syncFundActions(A.agent.getSnapshot()); });
    var closeFundBtn = el("fund-card-close");
    if (closeFundBtn) closeFundBtn.onclick = function () { view.fundCardOpen = false; view.fundCardDismissed = true; render(A.agent.getSnapshot()); };
    el("fund-card").addEventListener("click", function (e) {
      var chip = e.target.closest(".fund-chip");
      if (chip && chip.dataset.fundVal) {
        el("fund-amount").value = chip.dataset.fundVal; view.fundAmountDirty = true; view.fundPending = null; view.fundSent = null;
        render(A.agent.getSnapshot());
      }
    });
    // 30 günlük grafik: seçim yalnız görünümü değiştirir; motor veya para hareketi yoktur.
    function selectCashflowDay(i) { var n = cashflowPoints(A.agent.getSnapshot()).length; if (!n) return; view.cfIndex = Math.max(0, Math.min(n - 1, i)); render(A.agent.getSnapshot()); }
    el("cashflow-30").addEventListener("pointermove", function (e) {
      var svg = e.target.closest("[data-cf-chart]"); if (!svg) return;
      var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, px = (e.clientX - r.left) / r.width * vb.width;
      var Lp = Number(svg.dataset.cfLeft), Rp = Number(svg.dataset.cfRight), n = Number(svg.dataset.cfCount);
      var i = Math.round((px - Lp) / ((vb.width - Lp - Rp) / Math.max(1, n - 1)));
      if (i !== view.cfIndex) selectCashflowDay(i);
    });
    el("cashflow-30").addEventListener("pointerdown", function (e) { if (e.target.closest("[data-cf-chart]")) e.target.closest("[data-cf-chart]").dispatchEvent(new PointerEvent("pointermove", { clientX: e.clientX, clientY: e.clientY, bubbles: true })); });
    el("cashflow-30").addEventListener("keydown", function (e) {
      if (!e.target.closest("[data-cf-chart]") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault(); var n = cashflowPoints(A.agent.getSnapshot()).length, cur = Number.isInteger(view.cfIndex) ? view.cfIndex : -1;
      selectCashflowDay(e.key === "Home" ? 0 : e.key === "End" ? n - 1 : cur + (e.key === "ArrowRight" ? 1 : -1));
      var svgAgain = el("cashflow-30").querySelector("[data-cf-chart]"); if (svgAgain) svgAgain.focus({ preventScroll: true });
    });
    el("task-receipt").addEventListener("click", function (e) { if (e.target.closest("#receipt-fund-btn")) openFundFirst(); });
    el("accounts-view").addEventListener("click", function (e) {
      if (e.target.closest("#manage-fund-btn")) openFundFirst();
      // 26 Ekim: yatırımı güvenlik hesabına kat ya da çıkar; para hareketi yok, pay ve öneri yeniden hesaplanır.
      var pf = e.target.closest("[data-pf-use]");
      if (pf) command({ type: "set-holding-use", id: pf.dataset.pfUse, use: pf.getAttribute("aria-checked") !== "true" }).then(function () { var again = document.querySelector('[data-pf-use="' + pf.dataset.pfUse + '"]'); if (again) again.focus({ preventScroll: true }); });
    });
    // Üst üste "Devam et" tek taslak açar; kalkan yeni açıldıysa ilk cevap da aynı kısa korumayla bekler (ikinci dokunuş cevaba düşmesin).
    var submitBusy = false;
    el("new-transfer-form").onsubmit = async function (e) {
      e.preventDefault();
      if (submitBusy) return;
      var amount = A.parseMoney(el("nt-amount").value), payee = el("nt-payee").value.trim();
      if (!payee) return formError("Alıcının adını yaz.");
      if (!A.agent.validateIban(el("nt-iban").value)) return formError("IBAN TR ile başlamalı ve rakamlarla devam etmeli.");
      if (!amount) return formError("Geçerli bir TL tutarı gir.");
      submitBusy = true;
      var result; try { result = await command({ type: "prepare-payee-transfer", payee: payee, iban: el("nt-iban").value, amount: amount }); } finally { submitBusy = false; }
      if (result.ok && result.shield) ctxShownAt = Date.now();
      if (!result.ok) return;
      // C1-04: engellenen taslakta (ör. yetersiz bakiye) form ve girilen değerler açık kalır, gerekçe tutarın yanında görünür.
      var blocked = blockedTransferReason(result);
      if (blocked) { view.message = blocked; render(A.agent.getSnapshot()); el("nt-amount").focus({ preventScroll: true }); return; }
      view.transferLabOpen = false; render(A.agent.getSnapshot());
      var heading = el(result.shield ? "scam-shield-title" : "payee-review-title"); if (heading) heading.focus({ preventScroll: true });
    };
    var onGuardClick = async function (e) {
      var button = e.target.closest("[data-guard-action]");
      if (!button || button.disabled) return;
      var action = button.dataset.guardAction, s = A.agent.getSnapshot();
      A.telemetry.log("guard-action", { action: action });
      if (action === "trial-block" || action === "trial-continue") command({ type: "trial-decision", trialId: button.dataset.trialId, decision: action === "trial-block" ? "block" : "continue" });
      else if (action === "trial-dismiss") { view.dismissedTrials[button.dataset.trialId] = true; render(s); }
      else if (action === "liquidity-ob" || action === "liquidity-safe") command({ type: "liquidity-decision", decision: action === "liquidity-ob" ? "open-banking" : "safe-pay" });
      else if (action === "card-open" || action === "cc-pay") { if (button.dataset.choice) { view.stmt.choice = button.dataset.choice; view.stmt.pending = null; } openCardPay(); }
      else if (action === "cc-statement") { view.ccStatementOpen = true; render(s); var ss = el("cc-statement-section"); if (ss && ss.scrollIntoView) ss.scrollIntoView({ block: "start", behavior: "smooth" }); var sh2 = document.querySelector('[data-guard-action="cc-statement-toggle"]'); if (sh2) sh2.focus({ preventScroll: true }); }
      else if (action === "cc-statement-toggle") { view.ccStatementOpen = !view.ccStatementOpen; render(s); }
      else if (action === "cc-autopay") { var as = el("cc-autopay-section"); if (as && as.scrollIntoView) as.scrollIntoView({ block: "center", behavior: "smooth" }); var sw = document.querySelector('[data-guard-action="cc-autopay-toggle"]'); if (sw) sw.focus({ preventScroll: true }); }
      else if (action === "cc-autopay-toggle") { await command({ type: "card-autopay", enabled: !s.card.autopay }); var sw2 = document.querySelector('[data-guard-action="cc-autopay-toggle"]'); if (sw2) sw2.focus({ preventScroll: true }); }
      else if (action === "stmt-choice") {
        view.stmt.choice = button.dataset.choice; render(s);
        var focusTo = view.stmt.choice === "custom" ? el("stmt-amount") : document.querySelector('[data-guard-action="stmt-choice"][data-choice="' + view.stmt.choice + '"]');
        if (focusTo) focusTo.focus({ preventScroll: true });
      }
      else if (action === "stmt-pay" && s.cardStatement) {
        var pick = stmtSelection(s.cardStatement);
        if (pick.valid) { view.stmt.pending = { amount: pick.amount, topUp: pick.topUp, cost: pick.cost }; render(s); var cb = document.querySelector('[data-guard-action="stmt-confirm"]'); if (cb) cb.focus({ preventScroll: true }); }
      }
      else if (action === "stmt-cancel") { view.stmt.pending = null; render(s); var pb = document.querySelector('[data-guard-action="stmt-pay"]'); if (pb) pb.focus({ preventScroll: true }); }
      else if (action === "stmt-confirm" && view.stmt.pending) {
        var pd = view.stmt.pending; view.stmt.pending = null; view.stmt.sent = { amount: pd.amount, topUp: pd.topUp, working: true }; render(s);
        var paid = await command({ type: "card-pay", amount: pd.amount });
        if (!paid.ok) view.stmt.sent = null; else if (view.stmt.sent) view.stmt.sent.working = false;
        render(A.agent.getSnapshot());
      }
      else if (action === "stmt-done") {
        var still = s.cardStatement && s.cardStatement.open;
        view.stmt = newStmt(); view.stmt.dismissed = !still; render(s);
        var h = el("card-statement-title"); if (h) h.focus({ preventScroll: true });
      }
      else if (action === "liquidity-recover") command({ type: "redeem-savings", amount: s.liquidity.deficit });
      else if (action === "liquidity-clear") command({ type: "clear-liquidity-reserve" });
      else if (action === "liquidity-dismiss") { view.liquidityDismissed = button.dataset.reference; render(s); }
      else if (/^scan-(mode|paste|clear|choose|file|remove)$/.test(action) && view.scan && view.scan.phase !== "input") return;
      else if (action === "scan-mode") { view.scan.mode = button.dataset.mode; view.scan.sheet = false; render(s); var mb = document.querySelector('[data-guard-action="scan-mode"][data-mode="' + view.scan.mode + '"]'); if (mb) mb.focus({ preventScroll: true }); }
      else if (action === "scan-paste") { view.scan.text = A.SCAN.clipboard; render(s); el("scan-text").focus({ preventScroll: true }); }
      else if (action === "scan-clear") { view.scan.text = ""; render(s); el("scan-text").focus({ preventScroll: true }); }
      else if (action === "scan-choose") { view.scan.sheet = !view.scan.sheet; render(s); }
      else if (action === "scan-file") { view.scan.fileId = button.dataset.file; view.scan.sheet = false; render(s); el("scan-analyze").focus({ preventScroll: true }); }
      else if (action === "scan-remove") { view.scan.fileId = null; render(s); }
      else if (action === "scan-analyze") analyzeScan();
      else if (action === "scan-back") { scanGen++; view.scan = newScan(); render(s); el("scan-title").focus({ preventScroll: true }); }
      else if (action === "scan-close") { scanGen++; view.scanOpen = false; view.scan = null; render(s); el("transfer-scan").focus({ preventScroll: true }); }
      else if (action === "payee-approve" && s.plans.transfer) { view.sentPlan = s.plans.transfer.id; command({ type: "approve", taskId: "transfer", planId: s.plans.transfer.id, version: s.plans.transfer.version }); }
      else if (action === "payee-discard") command({ type: "discard-transfer-plan" });
      else if (action === "shield-yes" || action === "shield-no") command({ type: "shield-answer", answer: action === "shield-yes" ? "yes" : "no" });
      // Ek bağlam akışı (jüri canlı kısa): bir anda tek soru, üç eşit cevap. Cevap kaydedilir, sonraki adımı motordaki karar belirler.
      // 5 Kasım (kod incelemesi): ikinci soru birincinin yerinde açılır. Çift dokunuş ikinci, geri alınamaz soruyu cevaplamasın:
      // cevap işlenirken ve yeni soru göründükten sonraki kısa sürede gelen dokunuş yok sayılır.
      else if (action === "shield-ctx") {
        if (ctxBusy || Date.now() - ctxShownAt < answerGuardMs()) return;
        ctxBusy = true;
        try { await command({ type: "shield-answer", question: button.dataset.q, answer: button.dataset.a }); } finally { ctxBusy = false; ctxShownAt = Date.now(); }
      }
      else if (action === "shield-cancel") command({ type: "shield-cancel" });
      else if (action === "shield-protect") command({ type: "shield-protect" });
      else if (action === "shield-cooldown") command({ type: "shield-cooldown" });
      else if (action === "shield-stop") { var stopped = await command({ type: "shield-stop" }); if (stopped.ok) { view.shieldReviewOpen = false; render(A.agent.getSnapshot()); } }
      else if (action === "shield-review") {
        // Ek bağlam akışında özet ilk açılışta kalkan kaydından hazırlanır (iletilmez); yinelenen dokunuş yeni kayıt üretmez.
        if (!view.shieldReviewOpen && s.shield && s.shield.flow === "context") { var prepared = await command({ type: "shield-summary" }); if (!prepared.ok) return; s = A.agent.getSnapshot(); }
        view.shieldReviewOpen = !view.shieldReviewOpen; render(s);
        // 28 Ekim (sahip): özet açılınca ekran kendiliğinden ona kayar (yumuşak; azaltılmış harekette anında).
        if (view.shieldReviewOpen) { el("shield-review-title").focus({ preventScroll: true }); var panel = el("shield-review-panel"); if (panel.scrollIntoView) panel.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" }); }
      }
      else if (action === "shield-release") { view.shieldReviewOpen = false; command({ type: "shield-release" }); }
      else if (action === "shield-approve" && s.plans.transfer) command({ type: "approve", taskId: "transfer", planId: s.plans.transfer.id, version: s.plans.transfer.version });
    };
    // Sprint 2: bilgi kartları "Diğer uyarılar" içine taşınabildiği için aynı işleyici iki kapta dinlenir.
    el("guard-cards").addEventListener("click", onGuardClick);
    el("transfer-cards").addEventListener("click", onGuardClick);
    // Mesaj alanı yazarken yeniden çizilmez; yalnız taslak ve "İncele" düğmesi güncellenir.
    el("scan-panel").addEventListener("input", function (e) {
      if (e.target.id === "scan-iban") {
        // C1-05: IBAN durumu alanın güncel değerinden hesaplanır; eski "doğru" sonucu kalmaz.
        var compact = e.target.value.replace(/\s+/g, "").toUpperCase(), st = el("scan-iban-status"), ok = A.ibanChecksumValid(compact);
        if (st) { st.textContent = ok ? "IBAN biçimi doğru · alıcıyı doğrulamaz." : /^TR\d{24}$/.test(compact) ? "IBAN kontrol hanesi tutmuyor. Rakamları kontrol et." : "IBAN TR ile başlayan 26 karakter olmalı."; st.className = "nt-iban-status " + (ok ? "is-format" : "is-invalid"); }
        visible("scan-error", false); return;
      }
      if (e.target.id !== "scan-text" || !view.scan) return;
      view.scan.text = e.target.value; var b = el("scan-analyze"); if (b) b.disabled = !e.target.value.trim();
    });
    el("other-alerts").addEventListener("click", onGuardClick);
    // Ekstre kartında "Başka tutar": yazdıkça düğme tutarı ve kalan faiz güncellenir; odak ve imleç setGuardHtml ile korunur.
    var onStmtInput = function (e) { if (e.target.id !== "stmt-amount") return; view.stmt.custom = e.target.value; render(A.agent.getSnapshot()); };
    el("guard-cards").addEventListener("input", onStmtInput); el("other-alerts").addEventListener("input", onStmtInput);
    el("card-view").addEventListener("click", onGuardClick); el("card-view").addEventListener("input", onStmtInput);
    el("accounts-view").addEventListener("click", function (e) { if (e.target.closest("#accounts-card-open")) go("card"); });
    var toggleChat = function (event) {
      if (view.chatOpen) { closeChat(); return; }
      view.chatReturnFocusId = event.currentTarget.id;
      view.chatOpen = true;
      render(A.agent.getSnapshot());
      el("chat-close").focus({ preventScroll: true });
    };
    el("open-assistant-chat").onclick = toggleChat;
    el("home-chat-trigger").onclick = toggleChat;
    el("floating-chat-trigger").onclick = toggleChat;
    el("chat-close").onclick = closeChat;
    el("screen").addEventListener("click", function (e) {
      var opener = e.target.closest("[data-expense-detail]");
      if (opener) openExpenseChat(opener);
    });
    el("assistant-chat-view").addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeChat(); }
      else if (e.key === "Tab") {
        var controls = Array.from(el("assistant-chat-view").querySelectorAll('button,input,textarea,select,[tabindex="0"]')).filter(function (node) { return !node.disabled && !node.closest("[hidden]"); });
        var first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    if (el("chat-form")) {
      el("chat-form").onsubmit = function (e) {
        e.preventDefault();
        var inp = el("chat-input");
        if (!inp) return;
        var textVal = inp.value;
        inp.value = "";
        handleChatInput(textVal);
      };
    }
    if (el("refund-notice-close")) {
      el("refund-notice-close").onclick = function () {
        var s = A.agent.getSnapshot();
        var lastNotif = (s.bank.notifications || []).filter(function (n) { return n.type === "refund-received"; }).slice(-1)[0];
        if (lastNotif) view.dismissedRefundNoticeId = lastNotif.id;
        render(s);
      };
    }
    el("reset-demo").onclick = function () { if (presentation.kisa) openScene(kisaScene); else reset(); };
    el("preset-reset").onclick = function () { reset(el("demo-preset").value); };
    document.querySelectorAll("[data-event]").forEach(function (b) { b.onclick = async function () {
      if (b.dataset.event === "scam-call" && A.agent.getSnapshot().preset !== "security") reset("security");
      var generation = A.agent.getSnapshot().generation;
      var result = await command({ type: "event", event: b.dataset.event });
      if (!result.ok || generation !== A.agent.getSnapshot().generation) return;
      if (b.dataset.event === "call-start" || b.dataset.event === "call-end") return;
      if (b.dataset.event.indexOf("refund") === 0) go("accounts");
      else if (b.dataset.event === "rep-release") { view.shieldReviewOpen = false; view.message = result.unchanged ? "Kaldırılacak bir koruma yok." : "Müşteri temsilcisi yeni alıcı korumasını kaldırdı."; go("transfer"); }
      else if (b.dataset.event === "scam-call" || b.dataset.event === "shield-time" || b.dataset.event === "cashflow-24") { go(b.dataset.event === "cashflow-24" ? "home" : "transfer"); var heading = el(b.dataset.event === "cashflow-24" ? "liquidity-guard-title" : "scam-shield-title"); if (heading) heading.focus({ preventScroll: true }); }
      // Öneri kartları ve fon kartı Birikim sayfasında; olay sonrası güncellenen kart orada gösterilir.
      else go("savings", b.dataset.event === "expense" || b.dataset.event === "fund-cutoff" ? 0 : b.dataset.event === "subscription-price" ? 1 : 3);
    }; });
    el("tool-mode").onchange = function () { command({ type: "tool-mode", mode: el("tool-mode").value }); };
    document.querySelectorAll(".nudge-why, .comparison-disclosure").forEach(function (d) { d.addEventListener("toggle", fitCard); });
    el("why-savings").addEventListener("toggle", function () { if (this.open) A.telemetry.log("why-open", { taskId: "savings" }); });
    document.addEventListener("change", function (e) {
      if (e.target && e.target.classList && e.target.classList.contains("comparison-select")) {
        if (!A.COMPARISON.references.some(function (r) { return r.id === e.target.value; })) return;
        view.selectedGoldRef = e.target.value;
        A.telemetry.log("comparison-reference", {});
        renderComparisonViews();
        fitCard();
      }
    });
    function selectComparisonPoint(target) {
      var point = target.closest && target.closest("[data-comparison-index]");
      if (!point) return false;
      view.selectedGoldPoint = Number(point.dataset.comparisonIndex);
      A.telemetry.log("comparison-point", { index: view.selectedGoldPoint });
      renderComparisonViews();
      return true;
    }
    document.addEventListener("click", function (e) { selectComparisonPoint(e.target); });
    document.addEventListener("keydown", function (e) {
      var point = e.target.closest && e.target.closest("[data-comparison-index]");
      if (!point) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectComparisonPoint(point); }
      else if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) >= 0) {
        e.preventDefault();
        var prefix = point.id.replace(/-hit-\d+$/, ""), max = A.COMPARISON.months.length - 1;
        view.selectedGoldPoint = e.key === "Home" ? 0 : e.key === "End" ? max : Math.max(0, Math.min(max, Number(point.dataset.comparisonIndex) + (e.key === "ArrowLeft" ? -1 : 1)));
        A.telemetry.log("comparison-point", { index: view.selectedGoldPoint });
        renderComparisonViews();
        el(prefix + "-hit-" + view.selectedGoldPoint).focus({ preventScroll: true });
      }
    });
    window.addEventListener("resize", fitCard);
    if (window.ResizeObserver) {
      var cardObserver = new ResizeObserver(fitCard);
      document.querySelectorAll(".carousel-slide").forEach(function (slide) { cardObserver.observe(slide); });
    }
    // Tek sefer bağlanır. Yatay hareket gezinmedir; dikey kaydırma ve pointercancel görev çalıştırmaz.
    var start = null, viewport = el("carousel");
    viewport.addEventListener("pointerdown", function (e) { if (!e.isPrimary || e.button !== 0 || e.target.closest("button,input,a,summary,details")) return; start = { x: e.clientX, y: e.clientY, id: e.pointerId }; viewport.setPointerCapture(e.pointerId); });
    viewport.addEventListener("pointerup", function (e) {
      if (!start || start.id !== e.pointerId) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y; start = null;
      if (Math.abs(dx) > Math.max(40, viewport.clientWidth * 0.15) && Math.abs(dx) > Math.abs(dy) * 1.4) selectCard(view.active + (dx < 0 ? 1 : -1));
    });
    viewport.addEventListener("pointercancel", function () { start = null; });
  }
  A.reset = reset;
  A.getState = function () { return { view: Object.assign({}, view), engine: A.agent.getSnapshot(), tour: tour ? { key: tour.key, step: tour.i + 1, of: TOURS[tour.key].length } : null }; };
  A.act = command; // Eski test yardımcıları için açık komut köprüsü; örtük finansal eylem yok.
  // Başlatıcıdan doğrudan senaryo: ?view=jury&scenario=scam-call. Yalnız nöbetçi kartlarının açık olduğu görünümlerde çalışır.
  async function startScenario() {
    var scenario = new URLSearchParams(location.search).get("scenario");
    if (!presentation.features.guards || !["scam-call", "cashflow-24", "card-statement", "security", "portfolio", "portfolio-need"].includes(scenario)) return;
    if (scenario === "security") { reset("security"); A.openTransferLab(); return; }
    // 26 Ekim · portföy sepeti: 5 yatırımlı başlangıç; "portfolio-need" yarınki büyük ödemeyi de ekler. Hesaplarım'daki Yatırımların kartı açılır.
    if (scenario === "portfolio" || scenario === "portfolio-need") {
      reset("portfolio");
      if (scenario === "portfolio-need" && !(await command({ type: "event", event: "portfolio-need" })).ok) return;
      go("accounts"); focusPortfolio();
      return;
    }
    if (SCENARIO_PRESET[scenario]) reset(SCENARIO_PRESET[scenario]);
    var result = await command({ type: "event", event: scenario });
    if (!result.ok) return;
    go(SCENARIO_PAGE[scenario]); focusScenario(scenario, true);
  }
  // ?scenario= ve kısa sürüm sahneleri aynı başlangıcı kullanır: kalkan örneği güvenlik başlangıcıyla, karar kartı kendi sayfasında.
  var SCENARIO_PRESET = { "scam-call": "security" }, SCENARIO_PAGE = { "cashflow-24": "home", "card-statement": "home", "scam-call": "transfer" };
  function focusScenario(scenario, scroll) {
    var heading = el({ "cashflow-24": "liquidity-guard-title", "card-statement": "card-due-title", "scam-call": "scam-shield-title" }[scenario]);
    if (!heading) return;
    heading.focus({ preventScroll: true }); if (scroll && heading.scrollIntoView) heading.scrollIntoView({ block: "center" });
  }
  document.addEventListener("DOMContentLoaded", function () { shell(); A.agent.subscribe(render); syncForms(A.agent.getSnapshot()); render(A.agent.getSnapshot()); if (presentation.kisa) { var autoKey = new URLSearchParams(location.search).get("scenario"), AUTO = { "scam-call": "scam" }; openScene(initialScene(), Object.prototype.hasOwnProperty.call(AUTO, autoKey) ? AUTO[autoKey] : null); } else startScenario(); });
})(window.ARTI);
