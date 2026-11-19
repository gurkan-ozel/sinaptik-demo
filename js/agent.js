/* Ajan motoru: DOM'dan bağımsız, gerçek kayıt değiştiren çevrimdışı simülasyon. */
(function (A) {
  "use strict";
  var state, generation = 0, serial = 0, listeners = [], timers = new Set(), delayMs = A.CONFIG.toolDelayMs, undoMs = A.CONFIG.transferUndoMs;
  var activeStatuses = ["pending", "running", "unknown"];
  var TRANSFER_KINDS = ["saved-transfer", "payee-transfer"], TRIAL_KINDS = ["trial-block", "trial-continue"];
  var OB_KINDS = ["ob-pull"];
  // Sahip kararı (16 Ekim): Geri al yalnız paranın başkasına gittiği ciddi durumlarda. Kendi hesaplar arası aktarım, fon, deneme kararı ve
  // diğer bankadan kendi hesaba çekim onaydan sonra doğrudan uygulanır; bunlar zaten ters yönde tekrar yapılabilir.
  var UNDOABLE_KINDS = TRANSFER_KINDS.slice();
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function freeze(x) { if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); } return x; }
  function id(prefix) { return prefix + "-" + generation + "-" + (++serial); }
  function day() { return new Date(state.now + 10800000).toISOString().slice(0, 10); }
  // Faiz hassasiyeti yalnız kullanıcının açık tercihidir; davranıştan çıkarılmaz.
  function fundProduct() { var eco = A.RULES.ecosystem; return state.preferences.fundCode === "AIS" ? eco.participationMoneyMarket : eco.moneyMarket; }
  // ALE satışı 24 saat. AIS alım/satımı yalnız iş günlerinde kesim saatine kadar; dışında demo işlemi o an yapmaz.
  function productFor(code) { var eco = A.RULES.ecosystem; return code === "AIS" ? eco.participationMoneyMarket : eco.moneyMarket; }
  // product verilirse o fonun penceresi (fon değişiminde hedef fon); verilmezse seçili fonunki.
  function fundWindow(product) {
    var p = product || fundProduct();
    if (!p.cutoffMinutes) return { open: true, limited: false, code: p.code };
    var today = day(), open = businessDay(today, p.holidays) && localMinutes() < p.cutoffMinutes, next = today;
    if (!open) { do { next = nextDayOf(next); } while (!businessDay(next, p.holidays)); }
    return { open: open, limited: true, code: p.code, cutoff: p.cutoffLabel, nextDay: next };
  }
  function fundClosedReason(w) {
    w = w || fundWindow();
    return w.code + " alım ve satımı iş günlerinde saat " + w.cutoff + " öncesinde yapılabilir. Şu an fon nakde çevrilemez ve fona para aktarılamaz. Bir sonraki işlem günü " + new Date(w.nextDay + "T12:00:00+03:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long", timeZone: "Europe/Istanbul" }) + ".";
  }
  // 26 Ekim · portföy sepeti: birikim fonu + aynı anda tutulan fon ve hisseler; tutar ile nakde erişim günü birlikte değerlendirilir.
  // Salt okunur hesap: hiçbir yatırım satılmaz, satış talimatı oluşturulmaz (RULES.portfolio).
  // Fon saati (fundWindow) ile portföy erişim günü aynı iş günü/tatil kuralını kullanır.
  function businessDay(d, holidays) { var wd = new Date(d + "T00:00:00Z").getUTCDay(); return wd !== 0 && wd !== 6 && !(holidays || []).includes(d); }
  function nextDayOf(d) { return new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10); }
  function localMinutes() { var local = new Date(state.now + 10800000); return local.getUTCHours() * 60 + local.getUTCMinutes(); }
  // Bugün satış talimatı verilirse paranın vadesize geçtiği ilk gün: kontrollü saat, kesim saati, hafta sonu, tatil ve valör (iş günü).
  function arrivalDay(h) {
    var today = day(), hol = h.holidays || [], d = today;
    if (h.cutoffMinutes && !(businessDay(today, hol) && localMinutes() < h.cutoffMinutes)) { do { d = nextDayOf(d); } while (!businessDay(d, hol)); }
    for (var left = h.settlementDays; left > 0;) { d = nextDayOf(d); if (businessDay(d, hol)) left--; }
    return d;
  }
  // code verilirse birikim fonu o fonun erişim kuralıyla değerlendirilir (fon değişimi önizlemesi); verilmezse seçili fonla.
  function positions(code) {
    var r = A.RULES.portfolio, p = productFor(code || fundProduct().code), alias = state.bank.savingsAlias;
    var list = [{ id: "savings", label: alias || p.code, name: alias ? "Likit fon · birikim fonun" : p.name, kind: "fon", amount: balance("savings"), settlementDays: 0,
      cutoffMinutes: p.cutoffMinutes || null, cutoffLabel: p.cutoffLabel || null, holidays: p.holidays || [], risk: "düşük", useForSafety: true, savings: true }];
    (state.bank.holdings || []).forEach(function (h) { list.push(Object.assign({ holidays: r.holidays }, clone(h), { label: h.label || h.id, savings: false })); });
    return list.map(function (h) {
      var anytime = !h.cutoffMinutes, haircut = r.haircutBps[h.risk] || 0;
      return Object.assign(h, { anytime: anytime, worstDays: (anytime ? 0 : r.cutoffWaitDays) + h.settlementDays, arrival: arrivalDay(h),
        haircutBps: haircut, countable: Math.floor(h.amount * (10000 - haircut) / 10000) });
    });
  }
  function round100(x) { return Math.round(x / 10000) * 10000; }
  // Güvenlik payı = taban + bekleme payı + hiçbir yatırımın dolduramadığı kısım. Tek fonda bufferDays ile aynı sonucu verir.
  // projected: vadesizde ay sonuna kadarki ödemelerden sonra kalan (pay düşülmeden). Bunun tabanı aşan kısmı birikim fonuyla tek havuzdur:
  // önerilen birikim zaten o fona geçer. Böylece kendi hesapların arasındaki aktarım (fona ayır, fondan al) payı değiştirmez.
  function safetyBuffer(daily, code, list, projected) {
    var r = A.RULES.portfolio, base = daily * r.baseDays, left = base, wait = 0, tiers = [], free = (projected || 0) - base;
    (list || positions(code)).filter(function (h) { return h.useForSafety && (h.savings || h.countable > 0); })
      .sort(function (a, b) { return a.worstDays - b.worstDays || (a.savings ? -1 : b.savings ? 1 : 0); })
      .forEach(function (h) {
        var pool = h.savings ? Math.max(0, h.countable + free) : h.countable;
        if (left <= 0 || pool <= 0) return;
        var part = Math.min(left, pool), cost = Math.min(part, daily * h.worstDays);
        left -= part; wait += cost; tiers.push({ id: h.id, label: h.label, part: Math.round(part), days: h.worstDays, cost: Math.round(cost), withCash: !!h.savings && free > 0 });
      });
    var unfilled = Math.max(0, left), total = Math.max(10000, round100(base + wait + unfilled)), baseR = Math.max(10000, round100(base));
    return { base: baseR, extra: Math.max(0, total - baseR), wait: Math.round(wait), unfilled: Math.round(unfilled), total: total, tiers: tiers };
  }
  function balance(account) {
    return state.bank.accounts.find(function (a) { return a.id === account; }).opening +
      state.bank.transactions.reduce(function (sum, tx) { return sum + tx.postings.reduce(function (n, p) { return n + (p.account === account ? p.amount : 0); }, 0); }, 0);
  }
  function spent(kind) {
    return state.bank.transactions.filter(function (tx) { return tx.kind === kind && tx.at.slice(0, 7) === day().slice(0, 7); })
      .reduce(function (sum, tx) { return sum + tx.amount; }, 0);
  }
  function reserved() {
    return state.operations.reduce(function (sum, op) { return sum + (!op.applied && activeStatuses.includes(op.status) ? op.cashImpact : 0); }, 0);
  }
  function forecast() {
    var currentDay = day(), horizon = A.CONFIG.horizon, forecastPeriod = typeof horizon === "string" ? horizon.slice(0, 7) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(horizon) || currentDay < forecastPeriod + "-01") throw new RangeError("Kontrollü gider tahmini dönemi geçersiz veya henüz başlamadı.");
    var year = Number(forecastPeriod.slice(0, 4)), month = Number(forecastPeriod.slice(5, 7));
    var horizonExpired = currentDay > horizon;
    var basis = state.bank.expensePriceBasis, history = state.bank.history;
    if (!basis || basis.period !== forecastPeriod || !Number.isSafeInteger(basis.index) || basis.index <= 0 || basis.source !== "fictional") {
      throw new RangeError("Gider tahmini için kontrollü tahmin ayına ait geçerli kurgusal fiyat bazı gerekir.");
    }
    if (!Array.isArray(history) || history.length !== 12) {
      throw new RangeError("Gider tahmini için son 12 tamamlanmış ayın verisi gerekir.");
    }
    // Sort a copy: neither the historical aggregates nor the financial ledger are changed.
    var months = history.slice().sort(function (a, b) { return String(a.period).localeCompare(String(b.period)); });
    var normalizedMonths = months.map(function (row, i) {
      var expectedPeriod = new Date(Date.UTC(year, month - 1 - 12 + i, 1)).toISOString().slice(0, 7);
      if (row.period !== expectedPeriod || !Number.isSafeInteger(row.variableSpend) || row.variableSpend < 0 || !Number.isSafeInteger(row.priceIndex) || row.priceIndex <= 0) {
        throw new RangeError("Son 12 ay kesintisiz ve tekil olmalı. Harcama ile fiyat endeksi geçerli değerler taşımalı.");
      }
      var factor = basis.index / row.priceIndex, normalized = row.variableSpend * factor;
      if (!Number.isFinite(normalized) || normalized < 0 || normalized > Number.MAX_SAFE_INTEGER) throw new RangeError("Oranlanmış gider tutarı güvenli sayı aralığını aşıyor.");
      return { period: row.period, variableSpend: row.variableSpend, priceIndex: row.priceIndex,
        adjustmentFactor: factor, normalizedVariableSpend: normalized };
    });
    var total = normalizedMonths.reduce(function (sum, row) { return sum + row.normalizedVariableSpend; }, 0);
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(state.bank.variableAdjustment)) throw new RangeError("Gider tahmininin toplamı veya ek düzeltmesi geçersiz.");
    var monthlyAverage = total / 12;
    var daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    var remainingDays = horizonExpired ? 0 : daysInMonth - Number(currentDay.slice(8, 10)) + 1;
    var remainingVariable = Math.round(monthlyAverage * remainingDays / daysInMonth);
    var appliedAdjustment = horizonExpired ? 0 : state.bank.variableAdjustment;
    var categories = expenseCategories(horizonExpired ? 0 : remainingVariable);
    var overrideDelta = categories.reduce(function (n, x) { return n + x.amount - x.estimated; }, 0);
    var variable = remainingVariable + overrideDelta + appliedAdjustment;
    if (!Number.isSafeInteger(variable) || variable < 0) throw new RangeError("Kalan dönem için geçerli gider tahmini gerekir.");
    // Haber alma tercihi ödenecek tutarı etkilemez. Kesinleşmiş kayıtlar bu listede bulunmaz.
    var knownItems = horizonExpired ? [] : state.bank.payments.filter(function (p) { return p.status === "pending" && p.due >= currentDay && p.due <= horizon; });
    var known = knownItems.reduce(function (n, p) { return n + p.amount; }, 0);
    // Aday 3: yalnız onaylı ve tarihli girişler; varsayılan demo hikâyesinde boştur.
    var incoming = horizonExpired ? 0 : state.bank.incoming.filter(function (x) { return x.status === "confirmed" && x.due >= currentDay && x.due <= horizon; })
      .reduce(function (n, x) { return n + x.amount; }, 0);
    // Aday 14: kırılgan gün için ayrılan pay; o gün geçince kendiliğinden düşer.
    var lr = state.bank.liquidityReserve, liquidityReserve = !horizonExpired && lr && currentDay <= lr.until ? lr.amount : 0;
    var projected = balance("cash") - known - variable + incoming - reserved() - liquidityReserve;
    // Aday 15: kırılımın toplamı her zaman expected ile aynıdır.
    var breakdown = { categories: categories, adjustment: appliedAdjustment,
      known: knownItems.map(function (p) { return { id: p.id, label: p.label || A.RULES.knownPaymentLabels[p.kind] || p.kind, due: p.due, amount: p.amount }; }),
      total: known + variable, fictional: true };
    // 17 Ekim: güvenlik payı kişinin kendi ortalama günlük harcamasından gelir (bkz. RULES.bufferDays).
    // 26 Ekim: pay artık birikim fonu + aynı anda tutulan yatırımların erişim süresine göre (safetyBuffer). Elle girilen pay her zaman kazanır.
    var dailyAverage = monthlyAverage / daysInMonth, bufferFor = {}, current = fundProduct().code, bufferDetail = safetyBuffer(dailyAverage, current, positions(current), projected);
    Object.keys(A.RULES.bufferDays).forEach(function (code) { bufferFor[code] = code === current ? bufferDetail.total : safetyBuffer(dailyAverage, code, null, projected).total; });
    var buffer = state.permissions.bufferAuto ? bufferDetail.total : state.permissions.buffer;
    return { known: known, variable: variable, expected: known + variable, incoming: incoming, breakdown: breakdown, liquidityReserve: liquidityReserve, reserved: reserved(), projected: projected,
      method: "inflation-adjusted-12-month-variable", horizon: horizon, horizonExpired: horizonExpired,
      historyPeriods: normalizedMonths.map(function (row) { return row.period; }),
      priceBasisPeriod: basis.period, priceBasisIndex: basis.index, priceBasisSource: basis.source,
      normalizedMonthlyAverage: monthlyAverage, dailyAverage: Math.round(dailyAverage), bufferFor: bufferFor, bufferDetail: bufferDetail,
      bufferAuto: !!state.permissions.bufferAuto, remainingDays: remainingDays, daysInMonth: daysInMonth,
      remainingVariableBeforeAdjustment: remainingVariable, variableAdjustment: appliedAdjustment,
      calculation: { normalizedMonths: normalizedMonths, rounding: "Kalan gün payı hesaplandıktan sonra en yakın kuruşa yuvarlanır.",
        configuredVariableAdjustment: state.bank.variableAdjustment,
        historyScope: "Değişken harcama. Bilinen ödeme yükümlülükleri ayrı takvimden eklenir.",
        fictionalPriceNote: "Fiyat artışı endeksi kullanılır. Kişisel enflasyon ölçümü değildir.",
        dayConvention: "Kontrollü İstanbul tarihindeki gün dahil, takvim günleri üzerinden kalan ay payı." },
      buffer: buffer, available: horizonExpired ? 0 : Math.max(0, projected - buffer), shortfall: horizonExpired ? 0 : Math.max(0, buffer - (projected + liquidityReserve)) };
    // C1-01: kırılgan gün payı yalnız ayrılabilir tutarı küçültür; açığı ikinci kez yaratmaz (nakit akışıyla aynı formül).
  }
  // Aday 15: kalan değişken gideri kurgusal kategori paylarına en büyük kalan yöntemiyle böler; kuruş toplamı korunur.
  function expenseCategories(remaining) {
    var rules = A.RULES.expenseCategories, overrides = state.bank.expenseOverrides || {};
    var rows = rules.map(function (r) { var exact = remaining * r.weightBps / 10000; return { r: r, floor: Math.floor(exact), frac: exact - Math.floor(exact) }; });
    var left = remaining - rows.reduce(function (n, x) { return n + x.floor; }, 0);
    rows.slice().sort(function (a, b) { return b.frac - a.frac; }).slice(0, left).forEach(function (x) { x.floor += 1; });
    return rows.map(function (x) {
      var o = overrides[x.r.id], overridden = Number.isSafeInteger(o);
      return { id: x.r.id, label: x.r.label, estimated: x.floor, amount: overridden ? o : x.floor, overridden: overridden };
    });
  }
  // Aday 2: provizyondan bulunan denemenin yenilenirse ayrılabilir tutara etkisi. Salt okunur.
  function trialGuards() {
    var f = forecast(), today = day();
    return state.bank.trials.map(function (trial) {
      var daysLeft = Math.round((Date.parse(trial.endsOn + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
      var inHorizon = !f.horizonExpired && trial.renewalDue >= today && trial.renewalDue <= A.CONFIG.horizon;
      var counted = trial.status === "continued";
      var ifRenews = counted || !inHorizon ? f.available : Math.max(0, f.projected - trial.renewalAmount - f.buffer);
      var auth = state.bank.cardAuthorizations.find(function (a) { return a.id === trial.authorizationId; });
      return { id: trial.id, merchant: trial.merchant, status: trial.status, trialDays: trial.trialDays, startedOn: trial.startedOn,
        endsOn: trial.endsOn, renewalDue: trial.renewalDue, renewalAmount: trial.renewalAmount, period: trial.period, decisionRef: trial.decisionRef,
        authorizationAmount: auth ? auth.amount : null, authorizationStatus: auth ? auth.status : null, daysLeft: daysLeft,
        due: trial.status === "detected" && daysLeft >= 0 && daysLeft <= A.RULES.trialGuard.noticeDays,
        currentAvailable: f.available, availableIfRenews: ifRenews, reduction: f.available - ifRenews, countedInForecast: counted && inHorizon };
    });
  }
  // Aday 13: kurallara dayalı, açıklanabilir risk puanı. Para hareketi veya kayıt oluşturmaz.
  function knownPayeeIban(iban) {
    return state.bank.savedTransfers.some(function (x) { return x.ibanMask === iban; }) ||
      state.bank.transactions.some(function (tx) { return tx.status === "settled" && tx.ibanMask === iban; });
  }
  // Risk için "yeni alıcı": kayıtlı değil ve son bir saatten önce hiç para gönderilmemiş. Parayı aynı IBAN'a parça parça göndermek alıcıyı "bilinen" yapmaz.
  function establishedPayee(iban) {
    var since = state.now - A.RULES.scamShield.redemptionWindowMs;
    return state.bank.savedTransfers.some(function (x) { return x.ibanMask === iban; }) ||
      state.bank.transactions.some(function (tx) { return tx.status === "settled" && tx.ibanMask === iban && Date.parse(tx.at) < since; });
  }
  // Bir hesaplama içinde aynı IBAN'ı tekrar taramamak için (risk önizlemesi her tuş vuruşunda çalışır).
  function establishedMemo() {
    var memo = {};
    return function (iban) { return Object.prototype.hasOwnProperty.call(memo, iban) ? memo[iban] : (memo[iban] = establishedPayee(iban)); };
  }
  // Son bir saatte yeni alıcılara giden işlemler. fromIndex verilirse yalnız o sıradan sonraki kayıtlar:
  // demo saati olaylar arasında ilerlemediği için "görüşme sırasında" zamanla değil kayıt sırasıyla ayrılır.
  function newPayeeOutflows(fromIndex, established) {
    var since = state.now - A.RULES.scamShield.redemptionWindowMs, est = established || establishedMemo();
    return state.bank.transactions.filter(function (tx, i) {
      return i >= (fromIndex || 0) && tx.status === "settled" && !!tx.ibanMask && Date.parse(tx.at) >= since && Date.parse(tx.at) <= state.now && !est(tx.ibanMask);
    });
  }
  function outflowSum(list) {
    return list.reduce(function (sum, tx) {
      return sum + (tx.postings || []).filter(function (p) { return p.account === "cash" && p.amount < 0; }).reduce(function (n, p) { return n - p.amount; }, 0);
    }, 0);
  }
  // Görüşmenin başladığı andaki kayıt sayısı; görüşme yoksa null.
  function callMark() {
    var call = state.device.call;
    return call && call.active ? (Number.isSafeInteger(call.txMark) ? call.txMark : 0) : null;
  }
  // 5 Kasım (kod incelemesi): ek bağlam akışında arama başka telefonda, banka onu görmez. Parçalı gönderim penceresi bankanın gördüğü
  // olaydan başlar: son bir saatteki birikim bozumu. Ağırlıklar ve eşik aynı, yalnız pencerenin başlangıcı değişir. Görüşme çarpanı yine yalnız görüşmede.
  function redemptionMark() {
    var since = state.now - A.RULES.scamShield.redemptionWindowMs, list = state.bank.transactions;
    for (var i = list.length - 1; i >= 0; i--) {
      var tx = list[i], at = Date.parse(tx.at), ps = tx.postings || [];
      if (tx.status !== "settled" || at < since || at > state.now || tx.category === "fund-switch" || tx.category === "card-topup") continue;
      if (ps.some(function (p) { return p.account === "savings" && p.amount < 0; }) && ps.some(function (p) { return p.account === "cash" && p.amount > 0; })) return i;
    }
    return null;
  }
  function recentRedemption() {
    var since = state.now - A.RULES.scamShield.redemptionWindowMs;
    return state.bank.transactions.reduce(function (sum, tx) {
      var at = Date.parse(tx.at), postings = tx.postings || [];
      // Fon değişiminin satış bacağı parayı fondan çıkarmaz (aynı anda yeni fon alınır); "birikimden çekildi" sinyali sayılmaz.
      if (tx.category === "fund-switch") return sum;
      // Kart ödemesi için fondan tamamlanan para aynı anda karta gider; vadesizde bekleyen bozum değildir.
      if (tx.category === "card-topup") return sum;
      var out = postings.find(function (p) { return p.account === "savings" && p.amount < 0; }), into = postings.find(function (p) { return p.account === "cash" && p.amount > 0; });
      return sum + (tx.status === "settled" && at >= since && at <= state.now && out && into ? into.amount : 0);
    }, 0);
  }
  // Kategori ortancaları başlangıcın ölçeğiyle (canlı hikâye ×2): Ekim hareketleriyle aynı gelir düzeyinde kıyaslanır.
  function spendProfile() {
    var cats = A.RULES.spendProfile.categories, scale = state.bank.spendScale || 1, out = {};
    Object.keys(cats).forEach(function (key) { out[key] = Object.assign({}, cats[key], { median: cats[key].median * scale }); });
    return out;
  }
  // Kişinin olağan ödeme düzeyi: son 90 gündeki en büyük giden ödeme (hesap hareketleri + diğer kanallar). Salt okunur.
  function transferProfile(windowDays, floor) {
    var since = new Date(state.now - windowDays * 86400000).toISOString().slice(0, 10), payments = [];
    state.bank.transactions.forEach(function (tx) {
      if (tx.status !== "settled" || String(tx.at).slice(0, 10) < since) return;
      var out = (tx.postings || []).filter(function (p) { return p.account === "cash" && p.amount < 0; }).reduce(function (n, p) { return n - p.amount; }, 0);
      var internal = (tx.postings || []).some(function (p) { return p.account === "savings"; });
      if (!internal && out > 0) payments.push(out);
    });
    state.bank.externalOutflows.forEach(function (x) { if (x.date >= since) payments.push(x.amount); });
    payments.sort(function (a, b) { return a - b; });
    var largest = payments.length ? payments[payments.length - 1] : 0, median = payments.length ? payments[Math.floor(payments.length / 2)] : 0;
    return { largest: Math.max(largest, floor), smallest: payments[0] || 0, median: median, count: payments.length, payments: payments, liquid: balance("cash") + balance("savings"), windowDays: windowDays };
  }
  // Tutar sinyali sabit eşik değil: tutarın kişinin olağanına ve elindeki paraya göre ne kadar sıra dışı olduğu 0–35 arası puanlanır.
  function amountSignal(amount, max, cfg) {
    var prof = transferProfile(cfg.windowDays, cfg.baselineFloor), ratio = amount / prof.largest, share = prof.liquid > 0 ? amount / prof.liquid : 1;
    var ramp = function (x, a, b) { return Math.max(0, Math.min(1, (x - a) / (b - a))); };
    var byRatio = max * ramp(ratio, cfg.ratioStart, cfg.ratioFull), byShare = max * ramp(share, cfg.shareStart, cfg.shareFull), points = Math.round(Math.max(byRatio, byShare));
    // Olağan dışılık düzeyi puandan okunur; açıklama kişinin kendi hareket profiline dayanır (sabit eşik cümlesi kurulmaz).
    var level = points === 0 ? "olağan" : points < 15 ? "hafif" : points < 28 ? "belirgin" : "çok yüksek";
    var label = points === 0 ? "Tutar, hesap hareketlerine göre senin olağan ödeme aralığında"
      : "Hesap hareketlerine göre bu tutar senin için " + (level === "çok yüksek" ? "çok olağan dışı" : level + " derecede olağan dışı");
    var reason = byShare >= byRatio && points > 0 ? (share >= 0.95 ? "Hesaplarındaki paranın neredeyse tamamı tek seferde çıkıyor." : "Hesaplarındaki paranın büyük bölümü tek seferde çıkıyor.")
      : points > 0 ? (ratio >= 3 ? "Bugüne kadarki en büyük ödemenin çok üzerinde." : "Bugüne kadarki en büyük ödemenin üzerinde.") : "Benzer büyüklükte ödemeleri daha önce de yaptın.";
    return { code: "high-amount", active: points > 0, weight: points, maxWeight: max, label: label, level: level, reason: reason, ratio: ratio, share: share, baseline: prof.largest, liquid: prof.liquid,
      profile: { payments: prof.payments, smallest: prof.smallest, median: prof.median, largest: prof.largest, count: prof.count, windowDays: prof.windowDays, amount: amount } };
  }
  function assessTransferRisk(input) {
    var rules = A.RULES.scamShield, w = rules.weights, redeemed = recentRedemption(), mark = callMark(), est = establishedMemo();
    // Parçalı gönderim yalnız bu görüşme sırasında yapılanları sayar; görüşmeden önce ödenen bir fatura yönlendirme sayılmaz.
    // 20 Ekim (kod incelemesi): görüşme öncesi işlemler ne tekrar işaretine ne de birikimli tutara girer.
    var callOn = mark !== null, splitMark = callOn ? mark : state.shieldFlow === "context" ? redemptionMark() : null;
    var duringCall = splitMark !== null ? outflowSum(newPayeeOutflows(splitMark, est)) : 0;
    // 18 Ekim (risk-2): iki katman. Para hareketi işaretleri toplanır; telefonda görüşme sürüyorsa bu toplam katlanır.
    // Görüşme tek başına puan üretmez (kayıtlı alıcıya kira gibi). Ağırlıklar tests/risk-scenarios.test.cjs senaryo tablosuyla ayarlandı.
    var isNew = !est(input.ibanMask);
    // Birikimden çekilen para ancak bu transferle dışarı çıkıyorsa işarettir: tutar, çekimden önceki vadesizi aşıyor.
    var usesRedeemed = redeemed > 0 && input.amount > balance("cash") - redeemed;
    var money = [
      { code: "recent-redemption", active: usesRedeemed, weight: w.redemption, label: usesRedeemed ? "Son bir saatte birikiminden çektiğin " + A.money(redeemed) + " bu transferle çıkıyor" : "Son bir saatte birikimden çekilen para bu transferle çıkmıyor" },
      { code: "new-payee", active: isNew, weight: w.newPayee, label: "Bu alıcıya daha önce hiç para gönderilmedi" },
      { code: "repeat-new-payee", active: isNew && duringCall > 0, weight: w.repeatNewPayee, label: (!callOn && splitMark !== null ? "Birikim bozumundan sonra" : "Bu görüşme sırasında") + " yeni alıcılara " + A.money(duringCall) + " daha gönderildi" },
      // Tutar, bu görüşme sırasında yeni alıcılara gidenle birlikte değerlendirilir; parçalara bölmek tutarı küçültmez.
      amountSignal(input.amount + (isNew ? duringCall : 0), w.highAmount, rules.amountProfile)
    ];
    var base = money.reduce(function (n, x) { return n + (x.active ? x.weight : 0); }, 0);
    var boost = callOn ? Math.min(100, Math.round(base * rules.callMultiplier)) - base : 0;
    // 16 Ekim görüşmeleri: iki katılımcı da bankanın arayan numarayı bilmesinden rahatsız oldu. Sinyal ikili: yalnız "görüşme sürüyor mu";
    // arayanın numarası, kimliği veya rehber bilgisi kullanılmaz ve gösterilmez.
    var signals = [{ code: "active-call", active: callOn && boost > 0, weight: boost, label: "Şu an telefonda bir görüşme sürüyor. Banka, polis veya 112 telefonda para göndermeni istemez." }].concat(money);
    var score = Math.min(100, base + boost);
    // Gösterilen puan ile müdahale aynı kuralı izler: ≥70 ise kalkan açılır.
    return { score: score, level: score >= rules.highThreshold ? "high" : score >= rules.mediumThreshold ? "medium" : "low", highThreshold: rules.highThreshold,
      signals: signals, amount: input.amount, ibanMask: input.ibanMask, at: state.now };
  }
  function activeShield() {
    var sh = state.shield, p = state.plans.transfer;
    // Limit veya bakiye yüzünden engellenen transferde de kalkan görünür; risk niyetle ilgilidir.
    return sh && sh.status === "active" && p && p.id === sh.planId && ["awaiting", "blocked"].includes(p.status) ? sh : null;
  }
  // 5 Kasım (fraud uzmanı görüşmesi, jüri canlı kısa): "ek bağlam" akışı. Puan ve 15 dk bekleme yerine en fazla iki kısa soru.
  // Yüksek düzeyde demo banka kuralı ek bağlam ister (gerçek bankanın doğrulanmış skoru değildir). Cevap, mevcut kararla birlikte sonraki adımı belirler:
  // yönlendirme yok → standart onay · yönlendirme var + gizlilik yok/emin değil → doğrulama · gizlilik var → durdur · emin değilim → doğrulama.
  // Doğrulama/durdurma kararı aynı alıcıda kalır (hold): "Hayır" cevabı, yeni taslak veya geçen süre onu kaldırmaz. Varsayılan jüri görünümü eski akışta (cooling).
  function shieldFlowFor() {
    var f = A.CONFIG.shieldFlow;
    return f === "context" || f === "cooling" ? f : A.presentation && A.presentation.kisa ? "context" : "cooling";
  }
  function shieldOutcome(sh) {
    if (!sh || sh.flow !== "context") return null;
    if (sh.hold) return "hold";
    var a = sh.answers || {};
    // 19 Kasım (Akbank fraud direktörü): en fazla üç soru, sırayla ve yalnız şüphe sürerse. 1 telefon görüşmesi, 2 gizlilik, 3 his ("kontrolün dışında mı").
    if (!a.directed) return "ask";
    if (a.directed === "no") return "approve";
    if (a.directed === "yes") { if (!a.secrecy) return "ask"; if (a.secrecy === "yes") return "stop"; }
    if (!a.feeling) return "ask";
    return a.feeling === "yes" ? "stop" : "verify";
  }
  var CONTEXT_DENY = {
    ask: "Ek bilgi gerekiyor. Kısa soruları yanıtlamadan transfer gönderilmez.",
    verify: "Doğrulama gerekiyor. Bu transfer uygulamadan gönderilemez. Temsilciyle doğrulanmalı.",
    stop: "Cevapların bir yönlendirmeye işaret ediyor. Bu transfer gönderilmez.",
    hold: "Bu alıcıya transfer doğrulama bekliyor. Cevap veya bekleme bu kararı kaldırmaz.",
    holdOther: "Telefonla yönlendirildiğini söyledin. Doğrulanana kadar yeni alıcıya transfer gönderilmez. Kayıtlı alıcıların ve ödemelerin açık."
  };
  var ANSWER_WORD = { yes: "Evet", no: "Hayır", unsure: "Emin değilim" };
  var CONTEXT_QUESTIONS = { directed: "Bir telefon görüşmesi yüzünden mi bu işlemi yapıyorsun?", secrecy: "Biri bunu gizli tutmanı istedi mi?", feeling: "Bu işlemi kendi kontrolünde yapmıyormuş gibi hissediyor musun?" };
  function nextQuestion(a) { return !a.directed ? "directed" : a.directed === "yes" && !a.secrecy ? "secrecy" : "feeling"; }
  // Soru ve cevap metinleri tek yerde: telefon görünümü de bunları kullanır.
  A.SHIELD_CONTEXT = Object.freeze({ questions: Object.freeze(Object.assign({}, CONTEXT_QUESTIONS)), answers: Object.freeze(Object.assign({}, ANSWER_WORD)),
    short: Object.freeze({ directed: "Telefon görüşmesi yüzünden mi", secrecy: "Gizli tutmanı istedi mi", feeling: "Kontrolün dışında mı hissediyorsun" }), next: nextQuestion });
  var own = Object.prototype.hasOwnProperty;
  // Doğrulama/durdurma kararı alıcıya bağlanır. Tam IBAN saklanmaz: son dört hane (maske) ve geri çevrilemez kısa bir parmak izi tutulur.
  // İki tarafta da parmak izi varsa o karşılaştırılır (aynı son dört haneli başka alıcı kararı devralmaz); yoksa maske yeter (temkinli taraf).
  function ibanFingerprint(raw) {
    var x = String(raw || "").replace(/\s+/g, "").toUpperCase(), h = 2166136261;
    for (var i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return "f" + h.toString(36);
  }
  function holdFor(mask, key) {
    return state.reviewHolds.find(function (h) { return h.ibanMask === mask && (!h.ibanKey || !key || h.ibanKey === key); }) || null;
  }
  // feyz-2 (9 Kasım, stres testi): kişi açıkça "biri beni yönlendiriyor" dediyse, IBAN değiştirip "Hayır" demek kararı aşamaz.
  // Yalnız daha önce para gönderilmemiş alıcılar için geçerli. Kayıtlı alıcılar, faturalar ve kendi hesapları açık. "Emin değilim" alıcıya bağlı kalır.
  function directedHold(mask) {
    if (establishedMemo()(mask)) return null;
    var list = state.reviewHolds.filter(function (h) { return h.directed; });
    return list.length ? list[list.length - 1] : null;
  }
  function holdDenial(sh) { return sh && sh.hold && sh.hold.otherPayee ? CONTEXT_DENY.holdOther : CONTEXT_DENY.hold; }
  // Aday 3: kontrollü dönem içinde gün sonu vadesiz bakiyesi. Önerilen birikimin bugün ayrıldığı varsayılır.
  // savingOverride verilirse o tutar varsayılır (portföy ihtiyaç günü bugünkü bakiyelerle, 0 ile hesaplanır).
  function simulateCashFlow30Days(savingOverride) {
    var f = forecast(), today = day(), horizon = A.CONFIG.horizon, windowDays = A.RULES.cashflow.windowDays;
    var plan = state.plans.savings;
    var saving = savingOverride !== undefined ? savingOverride : plan && plan.status === "awaiting" && plan.kind === "save" ? plan.amount : f.shortfall ? 0 : f.available;
    var daily = f.remainingDays > 0 ? f.variable / f.remainingDays : 0;
    var start = balance("cash") - reserved() - saving, days = [], min = null, firstFragile = null, allowance = null;
    for (var i = 0; i < windowDays; i++) {
      var date = new Date(Date.parse(today + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);
      if (f.horizonExpired || date > horizon) { days.push({ date: date, balance: null, beyondHorizon: true, flows: [] }); continue; }
      var out = state.bank.payments.filter(function (p) { return p.status === "pending" && p.due >= today && p.due <= date; }).reduce(function (n, p) { return n + p.amount; }, 0);
      var inn = state.bank.incoming.filter(function (x) { return x.status === "confirmed" && x.due >= today && x.due <= date; }).reduce(function (n, x) { return n + x.amount; }, 0);
      var bal = Math.round(start - daily * (i + 1) - out + inn);
      var flows = state.bank.payments.filter(function (p) { return p.status === "pending" && p.due === date; }).map(function (p) { return { kind: "out", label: p.label || A.RULES.knownPaymentLabels[p.kind] || p.kind, amount: p.amount }; })
        .concat(state.bank.incoming.filter(function (x) { return x.status === "confirmed" && x.due === date; }).map(function (x) { return { kind: "in", label: x.label, amount: x.amount }; }));
      days.push({ date: date, balance: bal, beyondHorizon: false, flows: flows });
      if (!min || bal < min.balance) min = { date: date, balance: bal };
      if (!firstFragile && bal < f.buffer) firstFragile = date;
      // 18 Ekim: o güne kadar payın altına inmeden günde en fazla ne harcanabilir (tarihli ödemeler ayrıca düşülür).
      var room = (start - out + inn - f.buffer) / (i + 1);
      if (allowance === null || room < allowance) allowance = room;
    }
    var deficit = min ? Math.max(0, f.buffer - min.balance) : 0;
    return { start: today, windowDays: windowDays, coveredThrough: f.horizonExpired ? null : horizon, assumedSaving: saving, buffer: f.buffer,
      dailyVariable: daily, dailyAllowance: allowance === null ? 0 : Math.max(0, Math.floor(allowance)), days: days, minDay: min ? min.date : null, minBalance: min ? min.balance : null, firstFragileDay: firstFragile, deficit: deficit,
      note: "Kontrollü dönem sonrası için gider verisi olmadığından projeksiyon " + horizon + " tarihinde durur." };
  }
  function linkedSource(amount) {
    return state.bank.linkedAccounts.find(function (a) { return a.consent.status === "active" && a.consent.scopes.includes("payment-initiation") && a.consent.expiresOn >= day() && a.balance >= amount; }) || null;
  }
  // 26 Ekim · Hesaplarım "Yatırımların": yatırımların toplamı, güne göre erişilebilir tutar, güvenlik payına etkisi ve ihtiyaç günü. Salt okunur.
  // İhtiyaç günü: bugünkü bakiyelerle (birikim varsayılmadan) vadesizin güvenlik payının altına indiği ilk gün; o güne yetişen yatırımlarla karşılaştırılır.
  // Merdiven, ihtiyaç ve toplam aynı bakiyelerden gelir; tutarlar birbiriyle çelişmez.
  function portfolioView(f) {
    var list = positions(), today = day(), dates = [], cf = simulateCashFlow30Days(0);
    list.forEach(function (h) { if (!dates.includes(h.arrival)) dates.push(h.arrival); });
    var ladder = dates.sort().map(function (d) {
      return { date: d, today: d === today, reachable: list.reduce(function (n, h) { return n + (h.useForSafety && h.arrival <= d ? h.countable : 0); }, 0),
        gross: list.reduce(function (n, h) { return n + (h.arrival <= d ? h.amount : 0); }, 0) };
    });
    var need = null, tightest = null;
    cf.days.forEach(function (d) {
      if (d.balance === null || d.balance >= cf.buffer) return;
      var amount = cf.buffer - d.balance, reach = list.reduce(function (n, h) { return n + (h.useForSafety && h.arrival <= d.date ? h.countable : 0); }, 0);
      var row = { date: d.date, amount: amount, reachable: reach, gap: Math.max(0, amount - reach) };
      if (!need) need = row;
      if (row.gap > 0 && (!tightest || row.gap > tightest.gap)) tightest = row;
    });
    return { basket: list.length > 1, positions: list, ladder: ladder, total: list.reduce(function (n, h) { return n + h.amount; }, 0),
      included: list.reduce(function (n, h) { return n + (h.useForSafety ? h.countable : 0); }, 0),
      excluded: list.reduce(function (n, h) { return n + (h.useForSafety ? 0 : h.amount); }, 0),
      buffer: f.bufferDetail, bufferAuto: f.bufferAuto, need: need, gap: tightest };
  }
  // Aday 3 + 14: teşhis ve çözüm seçenekleri. Salt okunur.
  function liquidityInsight(cf) {
    var reserve = state.bank.liquidityReserve, source = cf.deficit > 0 ? linkedSource(cf.deficit) : null;
    return { fragile: cf.deficit > 0, deficit: cf.deficit, day: cf.minDay, minBalance: cf.minBalance, firstFragileDay: cf.firstFragileDay,
      linkedAccount: source ? { id: source.id, label: source.label, institution: source.institution, ibanMask: source.ibanMask, balance: source.balance } : null,
      reserve: reserve ? clone(reserve) : null };
  }
  // Kart ekstresi kararı: ödenmemiş kısım son ödeme gününe kadar giderlerde kalır ("önce borç"); birikim önerisi bu paradan yapılmaz.
  function openStatement() { var st = state.bank.cardStatement; return st && st.total - st.paid > 0 ? st : null; }
  function statementCost(remaining) {
    var r = A.RULES.cardStatement, interest = Math.round(remaining * r.monthlyRateBps / 10000);
    return interest + Math.round(interest * r.taxBps / 10000);
  }
  // Ödeme ekstre yükümlülüğünü kapattığı için yalnız ekstre dışı giderler ve güvenlik payıyla karşılaştırılır; açığı fondan tamamlanır.
  function statementTopUp(st, amount) {
    var f = forecast(), free = Math.max(0, f.projected + (st.total - st.paid) - f.buffer);
    return Math.min(balance("savings"), Math.max(0, amount - free));
  }
  function cardStatementInsight() {
    var st = state.bank.cardStatement;
    if (!st) return null;
    var outstanding = st.total - st.paid, minimumLeft = Math.max(0, st.minimum - st.paid), r = A.RULES.cardStatement;
    return { id: st.id, total: st.total, minimum: st.minimum, minimumBps: st.minimumBps, cardLimit: st.cardLimit, paid: st.paid, outstanding: outstanding, minimumLeft: minimumLeft,
      issued: st.issued, due: st.due, daysLeft: Math.round((Date.parse(st.due + "T00:00:00Z") - Date.parse(day() + "T00:00:00Z")) / 86400000),
      monthlyRateBps: r.monthlyRateBps, taxBps: r.taxBps, source: r.source, open: outstanding > 0, costIfUnpaid: statementCost(outstanding),
      full: { amount: outstanding, topUp: outstanding > 0 ? statementTopUp(st, outstanding) : 0, cost: 0 },
      minimumOption: minimumLeft > 0 && minimumLeft < outstanding ? { amount: minimumLeft, topUp: statementTopUp(st, minimumLeft), cost: statementCost(outstanding - minimumLeft) } : null };
  }
  // Kredi kartım ekranı: limit, hesap özeti ve güncel dönem borcu. Kesim olayından önce dönem harcamaları güncel dönemdedir.
  function cardOverview() {
    var r = A.RULES.cardStatement, st = state.bank.cardStatement, sum = function (list) { return list.reduce(function (n, x) { return n + x.amount; }, 0); };
    var itemsTotal = sum(r.items), provisions = sum(r.provisions), statementDebt = st ? st.total - st.paid : 0, periodDebt = st ? provisions : itemsTotal + provisions;
    var used = statementDebt + periodDebt;
    return { last4: r.last4, holder: r.holder, limit: st ? st.cardLimit : r.cardLimit, used: used, available: (st ? st.cardLimit : r.cardLimit) - used, statementDebt: statementDebt, periodDebt: periodDebt,
      cut: !!st, cutDate: r.issued, due: r.due, nextCut: st ? r.nextCut : r.issued, nextDue: st ? r.nextDue : r.due, autopay: !!state.bank.cardAutopay,
      items: clone(r.items), provisions: clone(r.provisions), previous: clone(r.previous) };
  }
  function previewCardPayment(amount) {
    var st = openStatement();
    if (!st) return { valid: false, reason: "Ödenecek kart borcu bulunmuyor." };
    var owe = st.total - st.paid, minLeft = Math.max(0, st.minimum - st.paid);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > owe) return { valid: false, reason: "Tutar en fazla kalan borç (" + A.money(owe) + ") olabilir." };
    if (amount < minLeft) return { valid: false, belowMinimum: true, reason: "Asgari tutar " + A.money(minLeft) + "; altında kalan ödeme gecikme sayılır." };
    var top = statementTopUp(st, amount);
    return { valid: balance("cash") + top >= amount, amount: amount, topUp: top, cost: statementCost(owe - amount), reason: balance("cash") + top >= amount ? "" : "Vadesiz hesap ve fon bu ödeme için yetmiyor." };
  }
  // Bölüm 5: katmanlı likidite görünümü. Ürün etiketi yetki veya işlem üretmez.
  function ecosystemTiers(f) {
    var eco = A.RULES.ecosystem, liquid = balance("savings"), since = new Date(Date.parse(day() + "T00:00:00Z") - 90 * 86400000).toISOString().slice(0, 10);
    var crypto = state.bank.externalOutflows.filter(function (x) { return x.category === "crypto-platform" && x.date >= since; })
      .concat(state.bank.transactions.filter(function (tx) { return tx.category === "crypto-platform" && String(tx.at).slice(0, 10) >= since; })
        .map(function (tx) { return { channel: tx.channel || "FAST", amount: -(tx.postings || []).filter(function (p) { return p.account === "cash"; }).reduce(function (n, p) { return n + p.amount; }, 0), date: String(tx.at).slice(0, 10) }; }));
    return {
      liquid: { balance: liquid, target: eco.liquidTarget, met: liquid >= eco.liquidTarget, product: fundProduct().name },
      pension: { overflowEligible: liquid >= eco.liquidTarget && f.shortfall === 0 && f.available > 0, rateBps: A.RULES.bes.rateBps, monthly: state.bank.bes.monthly, product: eco.pension.name },
      crypto: { count: crypto.length, total: crypto.reduce(function (n, x) { return n + x.amount; }, 0), since: since, channels: crypto.map(function (x) { return x.channel; }) }
    };
  }
  function spread() { var q = state.bank.quote; return Math.round((q.ask - q.bid) * 10000 / q.ask); }
  function besEstimate(target) {
    var payments = state.bank.payments.filter(function (p) { return p.kind === "bes" && p.status === "pending" && p.due >= day() && p.due <= "2026-12-31"; });
    var scheduled = payments.reduce(function (n, p) { return n + p.amount; }, 0);
    var room = Math.max(0, A.RULES.bes.annualEligibleCap - state.bank.bes.annualPaid - scheduled);
    var extra = Math.max(0, target - state.bank.bes.monthly) * payments.length;
    return { payments: payments.length, extra: extra, annualRoom: room, eligible: Math.min(room, extra),
      estimatedStateContribution: Math.floor(Math.min(room, extra) * A.RULES.bes.rateBps / 10000) };
  }
  function deriveSummary(s, st) {
    var primary = null, explanation = null, secondary = [];

    // 1. Sonucu belirsiz / sorgulanmakta olan işlem
    var unknownOp = st.operations.find(function (op) { return op.status === "unknown"; });
    if (unknownOp) {
      primary = {
        candidateId: "cand-" + unknownOp.id,
        taskId: unknownOp.taskId,
        intentKind: "reconcile",
        reasonCode: "unknown_operation",
        priorityClass: 1,
        title: "İşlemin sonucu henüz belli değil",
        copy: "İşlemin sonucu henüz belli değil. Tekrar göndermeden kontrol edelim.",
        action: "İşlemin sonucuna bak",
        actionable: true,
        planId: unknownOp.planId || null,
        version: null,
        operationId: unknownOp.id,
        facts: { operationId: unknownOp.id, kind: unknownOp.kind, amount: unknownOp.amount }
      };
      explanation = {
        facts: [["İşlem numarası", unknownOp.id], ["Durum", "Sonuç belirsiz"]],
        note: "Yanıt gelmediği için yeni finansal işlem yürütülmez. Önceki işlem sorgulanır."
      };
    }

    // 2. Transfer hazırlanıyor / gönderiliyor
    if (!primary) {
      var inFlightOp = st.operations.find(function (op) { return op.status === "pending" || op.status === "running"; });
      if (inFlightOp) {
        var isPending = inFlightOp.status === "pending", isTrial = TRIAL_KINDS.includes(inFlightOp.kind), isPayee = TRANSFER_KINDS.includes(inFlightOp.kind) || OB_KINDS.includes(inFlightOp.kind);
        primary = {
          candidateId: "cand-" + inFlightOp.id,
          taskId: inFlightOp.taskId,
          intentKind: isPending ? "undo" : "wait",
          reasonCode: "operation_in_flight",
          priorityClass: 2,
          title: isPending ? (isTrial ? "Kararın uygulanmak üzere" : isPayee ? "Transfer gönderilmek üzere" : "Transfer hazırlanıyor") : (isTrial ? "Kararın uygulanıyor" : "Transfer gönderiliyor"),
          copy: isPending ? (isTrial ? "Kararın uygulanmak üzere · Geri al" : isPayee ? "Transfer gönderilmek üzere · Geri al" : A.money(inFlightOp.amount) + " · Transfer hazırlanıyor. Gönderilmeden önce geri alabilirsin.") : (isTrial ? "Kararın uygulanıyor. Sonucunu kontrol edeceğim." : "Transfer gönderiliyor. Sonucunu kontrol edeceğim."),
          action: isPending ? "Geri al" : "İşlemin yapılıyor",
          actionable: isPending,
          planId: inFlightOp.planId || null,
          version: null,
          operationId: inFlightOp.id,
          facts: { operationId: inFlightOp.id, kind: inFlightOp.kind, amount: inFlightOp.amount, undoDeadline: inFlightOp.undoDeadline }
        };
        explanation = {
          facts: [["Tutar", A.money(inFlightOp.amount)], ["Ayrılan kaynak", A.money(inFlightOp.cashImpact)]],
          note: isPending ? "Gönderim öncesi iptal süresi dolana kadar yeni finansal işlem önerilmez." : "İşlem bankaya iletildi. Doğrulanmış sonuç bekleniyor."
        };
      }
    }

    // 3. Henüz kullanıcıya gösterilmemiş hata veya doğrulanmış sonuç
    if (!primary) {
      var unackOp = st.operations.find(function (op) { return (op.status === "failed" || (op.status === "succeeded" && op.unacknowledged)) && !op.acknowledged; });
      if (unackOp) {
        primary = {
          candidateId: "cand-" + unackOp.id,
          taskId: unackOp.taskId,
          intentKind: unackOp.status === "failed" ? "error" : "result",
          reasonCode: unackOp.status === "failed" ? "operation_failed" : "operation_verified",
          priorityClass: 3,
          title: unackOp.status === "failed" ? "İşlem tamamlanamadı" : "İşlemin tamamlandı",
          copy: unackOp.status === "failed" ? (unackOp.reason || "İşlem gerçekleştirilemedi.") : (unackOp.receipt ? unackOp.receipt.label : "İşlemin doğrulandı."),
          action: "Tamam",
          actionable: true,
          planId: unackOp.planId || null,
          version: null,
          operationId: unackOp.id,
          facts: { operationId: unackOp.id, status: unackOp.status, reference: unackOp.receipt ? unackOp.receipt.reference : null }
        };
        explanation = {
          facts: [["İşlem", unackOp.id], ["Durum", unackOp.status]],
          note: "İşlem sonucu kaydedildi."
        };
      }
    }

    // 4. Güncel nakit açığı (s.forecast.shortfall > 0)
    if (!primary && s.forecast.shortfall > 0) {
      var shortfall = s.forecast.shortfall;
      var savingsBal = s.balances.savings;
      var recoverAmount = Math.min(shortfall, savingsBal);
      var plan = s.plans.savings;
      if (savingsBal > 0) {
        primary = {
          candidateId: "cand-shortfall-recover",
          taskId: "savings",
          intentKind: "recover",
          reasonCode: "cash_shortfall",
          priorityClass: 4,
          title: "Ödemelerin ve güvenlik payın için " + A.money(shortfall) + " eksik kalıyor",
          copy: "Ödemelerin ve güvenlik payın için " + A.money(shortfall) + " eksik kalıyor. Birikiminden hesabına alabilirsin.",
          action: A.money(recoverAmount) + " hesabıma al",
          actionable: true,
          planId: plan ? plan.id : null,
          version: plan ? plan.version : null,
          operationId: null,
          facts: {
            shortfall: shortfall,
            recoverAmount: recoverAmount,
            savingsBalance: savingsBal,
            cashBalance: s.balances.cash,
            expectedExpenses: s.forecast.expected,
            buffer: s.forecast.buffer
          }
        };
      } else {
        primary = {
          candidateId: "cand-shortfall-insufficient",
          taskId: "savings",
          intentKind: "shortfall-warning",
          reasonCode: "cash_shortfall_insufficient_savings",
          priorityClass: 4,
          title: "Ödemelerin için yaklaşık " + A.money(shortfall) + " eksik var",
          copy: "Ödemelerin için yaklaşık " + A.money(shortfall) + " eksik var. Birikiminden karşılanabilecek tutar yok.",
          action: "Hesaplarımı incele",
          actionable: false,
          planId: null,
          version: null,
          operationId: null,
          facts: { shortfall: shortfall, savingsBalance: 0 }
        };
      }
      explanation = {
        facts: [
          ["Kullanılan bakiye", A.money(s.balances.cash)],
          ["Kalan gider", A.money(s.forecast.expected)],
          ["Güvenlik payı", A.money(s.forecast.buffer)],
          ["Eksik kalan", A.money(shortfall)]
        ],
        note: "Gider tahmini ve güvenlik payı toplamı mevcut nakdi aştığı için " + A.money(shortfall) + " nakit açığı oluştu."
      };

      secondary.push({
        taskId: "savings",
        status: "replanned",
        copy: "Yeni para ayırma önerisi bütçene göre yenilendi."
      });
      if (st.goals.bes.requested || s.plans.bes || st.bank.bes.monthly) {
        secondary.push({
          taskId: "bes",
          status: "blocked",
          copy: "BES katkını artırma taslağı bu bütçede uygun değil. Mevcut katkı talimatın sürüyor."
        });
      }
      if (st.goals.gold.watching) {
        secondary.push({
          taskId: "gold",
          status: "monitoring_no_buy",
          copy: "Altın koşulun takip ediliyor. Bu bütçeyle yeni alım önerilmiyor."
        });
      }
      if (st.bank.subscription.priceChanged) {
        secondary.push({
          taskId: "subscription",
          status: "notice",
          copy: "DigitalFilm ödemen 200 TL’den 280 TL’ye çıktı. Otomatik ödemen devam ediyor."
        });
      } else {
        secondary.push({
          taskId: "subscription",
          status: "mandate_active",
          copy: "Otomatik ödemelerin sürüyor. Bir ücret artışı varsa burada görebilirsin."
        });
      }
    }

    // 5. Aktif kullanıcı hedefine uygun, kaynak sınırları içindeki taslak
    if (!primary) {
      var sp = s.plans.savings, bp = s.plans.bes, gp = s.plans.gold;
      if (sp && sp.status === "awaiting" && sp.kind === "save" && !st.tasks.savings.paused) {
        primary = {
          candidateId: "cand-" + sp.id,
          taskId: "savings",
          intentKind: "save",
          reasonCode: "savings_proposal",
          priorityClass: 5,
          title: "Bu ay kendine bir pay ayır",
          copy: "Bu ay " + A.money(sp.amount) + " birikim için ayırabilirsin.",
          action: A.money(sp.amount) + " ayır",
          actionable: true,
          planId: sp.id,
          version: sp.version,
          operationId: null,
          facts: { amount: sp.amount, available: s.forecast.available }
        };
        explanation = {
          facts: [
            ["Hesabındaki para", A.money(s.balances.cash)],
            ["Kalan gider", A.money(s.forecast.expected)],
            ["Güvenlik payı", A.money(s.forecast.buffer)],
            ["Ayırabileceğin tutar", A.money(s.forecast.available)]
          ],
          note: "Beklenen giderler ve güvenlik payından sonra kalan bütçeden önerildi."
        };
        if (st.goals.gold.watching) {
          secondary.push({ taskId: "gold", status: "monitoring", copy: "Altın koşulun takip ediliyor. Alım için bütçe durumu izlenir." });
        }
        secondary.push({ taskId: "bes", status: "mandate_active", copy: "Mevcut BES katkı talimatın sürüyor." });
        secondary.push({ taskId: "subscription", status: "mandate_active", copy: "Otomatik ödemelerin sürüyor." });
      } else if (bp && bp.status === "awaiting" && !st.tasks.bes.paused) {
        primary = {
          candidateId: "cand-" + bp.id,
          taskId: "bes",
          intentKind: "bes-change",
          reasonCode: "bes_proposal",
          priorityClass: 5,
          title: "BES katkında küçük bir adım",
          copy: "Aylık BES katkını " + A.money(bp.amount) + " yapabilirsin.",
          action: "Katkımı " + A.money(bp.amount) + " yap",
          actionable: true,
          planId: bp.id,
          version: bp.version,
          operationId: null,
          facts: { target: bp.amount }
        };
        explanation = {
          facts: [["Mevcut katkı", A.money(st.bank.bes.monthly)], ["Yeni katkı", A.money(bp.amount)]],
          note: "Gelecek ödemeler için katkı artış taslağı hazırlandı."
        };
      } else if (gp && gp.status === "awaiting" && !st.tasks.gold.paused) {
        primary = {
          candidateId: "cand-" + gp.id,
          taskId: "gold",
          intentKind: "gold-buy",
          reasonCode: "gold_buy_proposal",
          priorityClass: 5,
          title: "Altın alım koşulu sağlandı",
          copy: "İstediğin makas koşulunda " + A.money(gp.amount) + " altın alabilirsin.",
          action: A.money(gp.amount) + " altın al",
          actionable: true,
          planId: gp.id,
          version: gp.version,
          operationId: null,
          facts: { amount: gp.amount, quoteId: gp.quoteId }
        };
        explanation = {
          facts: [["Alış-satış farkı", "%" + (s.spreadBps / 100).toLocaleString("tr-TR")], ["Bütçe", A.money(gp.amount)]],
          note: "Belirlediğin makas sınırına uygun kotasyon tespit edildi."
        };
      }
    }

    // 6. Kullanıcının haber alma tercihi açık olan yeni ödeme artışı
    if (!primary) {
      var notice = st.bank.notifications.find(function (n) { return n.type === "price-increase"; });
      if (notice && st.bank.priceAlerts.enabled && !st.tasks.subscription.paused) {
        primary = {
          candidateId: "cand-" + notice.id,
          taskId: "subscription",
          intentKind: "price-alert",
          reasonCode: "price_increase_notice",
          priorityClass: 6,
          title: notice.label + " ödemen yükseldi",
          copy: notice.label + " ödemen " + A.money(notice.previous) + "’den " + A.money(notice.current) + "’ye çıktı (%" + (notice.changeBps / 100).toLocaleString("tr-TR") + ").",
          action: "Ödemelerimi gör",
          actionable: true,
          planId: null,
          version: null,
          operationId: null,
          facts: { previous: notice.previous, current: notice.current, label: notice.label }
        };
        explanation = {
          facts: [
            [notice.label + " önceki", A.money(notice.previous)],
            [notice.label + " güncel", A.money(notice.current)],
            ["Artış", "%" + (notice.changeBps / 100).toLocaleString("tr-TR")]
          ],
          note: "Haber alma tercihin açık olduğu için fiyat değişikliği bildirildi. Ödeme talimatın devam ediyor."
        };
      }
    }

    // 7. Sadece izleme / yeni anlamlı öneri yok
    if (!primary) {
      primary = {
        candidateId: "cand-calm",
        taskId: "savings",
        intentKind: "none",
        reasonCode: "monitoring_calm",
        priorityClass: 7,
        title: "Akbank Asistan",
        copy: "Küçük bir adım, karar sende.",
        action: "",
        actionable: false,
        planId: null,
        version: null,
        operationId: null,
        facts: {}
      };
      explanation = {
        facts: [],
        note: "Hesapların ve ödemelerin takip ediliyor."
      };
    }

    // Bütçe ve hedef çatışması analizi (Kabul ölçütü F2-08)
    var avail = s.forecast.available;
    var sPlan = s.plans.savings, bPlan = s.plans.bes, gPlan = s.plans.gold;
    var sDemand = (sPlan && sPlan.status === "awaiting" && sPlan.kind === "save") ? sPlan.amount : 0;
    var bDemand = (st.goals.bes.requested && st.goals.bes.target > st.bank.bes.monthly) ? (st.goals.bes.target - st.bank.bes.monthly) : 0;
    var gDemand = (gPlan && gPlan.status === "awaiting") ? gPlan.amount : (st.goals.gold.watching && st.goals.gold.budget > 0 ? Math.min(st.goals.gold.budget, avail) : 0);
    var totalDem = sDemand + bDemand + gDemand;
    var hasConf = (totalDem > avail && avail > 0);
    var conflict = {
      hasConflict: hasConf,
      availableAmount: avail,
      totalDemand: totalDem,
      competingTasks: ["savings", "bes", "gold"].filter(function (tId) {
        return (tId === "savings" && sDemand > 0) || (tId === "bes" && bDemand > 0) || (tId === "gold" && gDemand > 0);
      }),
      note: hasConf ? "Ayrılabilir " + A.money(avail) + " bütçe için hedeflerin toplam talebi (yaklaşık " + A.money(totalDem) + ") birlikte karşılanamaz. Birikim hedefi önceliklidir." : ""
    };

    var summaryId = "sum-" + st.generation + "-" + primary.reasonCode + "-" + (primary.planId || primary.operationId || primary.priorityClass);

    return {
      summaryId: summaryId,
      generation: st.generation,
      priorityClass: primary.priorityClass,
      reasonCode: primary.reasonCode,
      primary: primary,
      secondary: secondary,
      explanation: explanation,
      conflict: conflict
    };
  }
  function snapshot() {
    var s = clone(state);
    s.balances = { cash: balance("cash"), savings: balance("savings") };
    s.forecast = forecast(); s.spreadBps = spread(); s.besEstimate = besEstimate(state.goals.bes.target);
    if (state.permissions.bufferAuto) s.permissions.buffer = s.forecast.buffer;
    s.monthlySavingsSpent = spent("save"); s.authority = clone(A.RULES.authority);
    s.automaticPayments = automaticPayments();
    s.reservations = { cash: reserved(), savings: state.operations.reduce(function (n, op) { return n + (!op.applied && activeStatuses.includes(op.status) && op.kind === "recover" ? op.amount : 0); }, 0) };
    s.trialGuards = trialGuards(); s.shieldActive = !!activeShield(); s.shieldOutcome = shieldOutcome(state.shield);
    s.protectionRelease = protectionRelease();
    s.fund = { product: clone(fundProduct()), window: fundWindow(), windows: { ALE: fundWindow(productFor("ALE")), AIS: fundWindow(productFor("AIS")) } };
    // Hesap hareketleri: kalkanla aynı kişisel profil (son 90 gün) üzerinden olağan dışı çıkışlar.
    var cashAccount = state.bank.accounts.find(function (a) { return a.id === "cash"; }), sa = A.RULES.scamShield.amountProfile;
    s.ledgerAttention = A.ledgerAttention(state.bank.transactions, { openingCash: cashAccount.opening, buffer: s.forecast.buffer,
      categoryProfile: spendProfile(), largestPayment: transferProfile(sa.windowDays, sa.baselineFloor).largest });
    s.cashflow = simulateCashFlow30Days(); s.liquidity = liquidityInsight(s.cashflow); s.ecosystem = ecosystemTiers(s.forecast);
    s.portfolio = portfolioView(s.forecast);
    s.cardStatement = cardStatementInsight(); s.card = cardOverview();
    s.summary = deriveSummary(s, state);
    return freeze(s);
  }
  // Salt okunur deneme: plan, hedef, izin, işlem veya günlük oluşturmaz.
  function previewSavings(amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000) return freeze({ valid: false });
    var f = forecast(), remaining = f.projected - f.buffer - amount;
    var decision = policy({ taskId: "savings", kind: "save", amount: amount }, false, false);
    return freeze({ valid: true, amount: amount, remaining: remaining, shortfall: Math.max(0, -remaining),
      feasible: decision.allowed || decision.needsApproval, reason: decision.reason,
      busy: !!busy(), expected: f.expected, buffer: f.buffer, reserved: f.reserved, dataVersion: state.dataVersion });
  }
  function buildHumanReviewSummary(taskId, st, custom) {
    custom = custom || {};
    var reference = custom.reference || (st.tasks[taskId] && st.tasks[taskId].humanReview && st.tasks[taskId].humanReview.reference) || id("REVIEW");
    var operations = st.operations.filter(function (item) { return item.taskId === taskId; });
    var op = operations.find(function (item) { return item.status === "unknown"; }) || operations.slice().reverse()[0];
    var checks = op ? st.events.filter(function (event) {
      return event.phase === "tool" && event.title === "getOperationStatus" && event.detail.operationId === op.id;
    }) : [];
    var lastCheck = checks.length ? checks[checks.length - 1].detail : null;
    var payee = op && TRANSFER_KINDS.includes(op.kind) ? ((op.receipt && op.receipt.payee) || op.payeeLabel || "") : "";
    var amount = op ? op.amount : 0;
    var operationRef = op ? ((op.receipt && op.receipt.reference) || op.id) : "";
    var verified = !!(op && op.status === "succeeded" && op.receipt && op.receipt.verified);
    var question, operation, verifiedStatus, uncertainty, summaryText;
    if (op) {
      var names = { "saved-transfer": "transfer", "payee-transfer": "yeni alıcıya transfer", save: "birikim hesabına aktarım", recover: "birikimden vadesize aktarım", "gold-buy": "altın alımı", "bes-change": "BES katkı talimatı değişikliği", "trial-block": "deneme yenilemesini kartta engelleme", "trial-continue": "deneme yenilemesini gider tahminine ekleme", "ob-pull": "diğer bankadan açık bankacılık aktarımı", redeem: "birikim bozdurma" };
      var label = names[op.kind] || "işlem", value = A.money(amount);
      operation = value + " " + label + (payee ? " (" + payee + ")" : "");
      question = "İşlemimin durumu hakkında bilgi almak istiyorum.";
      if (op.status === "unknown") {
        verifiedStatus = op.applied ? "İşlem için mock finansal kayıt oluştu. Sonuç henüz doğrulanmadı." : "İşlem gönderildi. Sonucu henüz doğrulanmadı. Tutar işlem sonuçlanana kadar ayrıldı.";
        uncertainty = op.reconciling ? "Son durum sorgusu devam ediyor." : checks.length ? "Son durum sorgusu kaydı var. İşlem durumu ayrıca incelenmeli." : "Son durum sorgusu henüz yapılmadı.";
        question = TRANSFER_KINDS.includes(op.kind) || op.kind === "save" || op.kind === "recover" ? "Para gönderildi mi, öğrenmek istiyorum." : "İşlem gerçekleşti mi, öğrenmek istiyorum.";
        summaryText = value + " " + label + " için onay verdim. İşlemin sonucu henüz doğrulanamadı. " + uncertainty + " " + question;
      } else if (op.status === "pending") {
        verifiedStatus = "İşlem onaylandı. Gönderim henüz başlamadı ve tutar ayrıldı.";
        uncertainty = "Gönderim öncesi geri alma süresi devam ediyor.";
        summaryText = operation + " için onay verdim. Gönderim henüz başlamadı. İptal ve gönderim durumu hakkında destek istiyorum.";
      } else if (op.status === "running") {
        verifiedStatus = "Mock işlem gönderildi. Sonuç doğrulaması tamamlanmadı.";
        uncertainty = "Araç yanıtı veya kayıt doğrulaması bekleniyor.";
        summaryText = operation + " gönderildi. Sonucu henüz doğrulanmadı. İşlem durumu hakkında destek istiyorum.";
      } else if (verified) {
        verifiedStatus = "İşlem mock kayıttan doğrulandı ve tamamlandı.";
        uncertainty = "İşlem sonucu doğrulandı. Gerçek alıcıya mesaj veya banka dışı teyit gönderilmedi.";
        summaryText = operation + " tamamlandı ve mock kayıt doğrulandı. İşlem detayları hakkında destek istiyorum.";
      } else if (op.status === "cancelled") {
        verifiedStatus = "İşlem gönderimden önce iptal edildi. Bu işlem için finansal kayıt oluşmadı.";
        uncertainty = "Gönderim iptal edildi. Tutar artık bu işlem için ayrılmıyor.";
        summaryText = operation + " gönderilmeden iptal edildi. İptal durumu hakkında destek istiyorum.";
      } else if (op.status === "failed") {
        verifiedStatus = op.applied ? "Mock kayıt oluştu fakat sonuç doğrulaması başarılı olmadı." : "Mock işlem başarısız. Bu işlem için finansal kayıt oluşmadı.";
        uncertainty = op.reason || "İşlem kaydı ayrıca incelenmeli.";
        summaryText = operation + " için işlem başarılı olarak doğrulanmadı. " + uncertainty + " Destek istiyorum.";
      } else {
        verifiedStatus = "İşlem kaydı var. Sonuç doğrulanmış olarak işaretlenmedi.";
        uncertainty = "İşlem durumu ayrıca incelenmeli.";
        summaryText = operation + " için durum bilgisi ve destek istiyorum.";
      }
    } else {
      var contexts = { transfer: "Transfer", trial: "Ücretsiz deneme yenilemesi", savings: "Birikim önerisi", subscription: "Otomatik ödeme ve ücret artışı takibi", bes: "BES katkı planı", gold: "Altın koşul takibi" };
      operation = (contexts[taskId] || "Bankacılık") + " hakkında destek";
      question = "Sorumu müşteri temsilcisine açıklamak istiyorum.";
      verifiedStatus = "Bu oturumda bu konuya ait gönderilmiş işlem kaydı bulunmuyor.";
      uncertainty = "İlgili işlem veya sorun kullanıcı tarafından belirtilmeli.";
      summaryText = operation + " almak istiyorum. Bu oturumda ilgili gönderilmiş işlem kaydı yok. Sorumu açıklayacağım.";
    }
    if (custom.question !== undefined) question = custom.question;
    if (custom.operation !== undefined) operation = custom.operation;
    if (custom.amount !== undefined) amount = custom.amount;
    if (custom.operationRef !== undefined) operationRef = custom.operationRef;
    if (custom.verifiedStatus !== undefined) verifiedStatus = custom.verifiedStatus;
    if (custom.uncertainty !== undefined) uncertainty = custom.uncertainty;
    if (custom.summaryText !== undefined) summaryText = custom.summaryText;
    return {
      reference: reference, status: "draft", at: custom.at || st.now, taskId: taskId,
      question: question, operation: operation, amount: amount, operationRef: operationRef,
      verifiedStatus: verifiedStatus, uncertainty: uncertainty, summaryText: summaryText,
      operationId: op ? op.id : null, operationKind: op ? op.kind : null, payee: payee, verified: verified,
      reconcile: { inProgress: !!(op && op.reconciling), performed: checks.length > 0, lastApplied: lastCheck ? !!lastCheck.applied : null },
      editedByUser: !!custom.editedByUser
    };
  }
  function automaticPayments() {
    return state.bank.automaticPaymentOrders.map(function (order) {
      var row = clone(order), payment = state.bank.payments.filter(function (p) { return p.orderId === order.id && p.status === "pending" && p.due >= day(); }).sort(function (a, b) { return a.due.localeCompare(b.due); })[0];
      row.amount = payment ? payment.amount : null; row.nextDue = payment ? payment.due : order.nextDue;
      if (order.kind === "subscription") { row.status = state.bank.subscription.mandateStatus; row.previousAmount = state.bank.subscription.previousAmount; row.priceChanged = state.bank.subscription.priceChanged; }
      return row;
    });
  }
  function notify() { syncContextReview(); var s = snapshot(); listeners.slice().forEach(function (fn) { fn(s); }); }
  function audit(taskId, phase, title, detail, run) {
    var event = { id: id("log"), at: new Date(state.now).toISOString(), taskId: taskId, phase: phase, title: title, detail: detail || {}, dataVersion: state.dataVersion };
    state.events.push(event);
    if (run) run.steps.push(event.id);
    if (A.telemetry) A.telemetry.log("agent-" + phase, { eventId: event.id, taskId: taskId, title: title });
    return event;
  }
  function readTool(name, taskId, run) {
    var result;
    if (name === "readAccounts") result = { cash: balance("cash"), savings: balance("savings") };
    if (name === "readPaymentSchedule") result = clone(state.bank.payments);
    if (name === "readVariableHistory") result = clone(state.bank.history);
    if (name === "readExpensePriceBasis") result = clone(state.bank.expensePriceBasis);
    if (name === "readAutomaticPayments") result = automaticPayments();
    if (name === "readPriceAlertPreferences") result = clone(state.bank.priceAlerts);
    if (name === "readBesContract") result = clone(state.bank.bes);
    if (name === "getGoldQuote") result = clone(state.bank.quote);
    if (name === "readCardAuthorizations") result = clone(state.bank.cardAuthorizations);
    if (name === "readTrials") result = clone(state.bank.trials);
    if (name === "readLinkedAccounts") result = state.bank.linkedAccounts.map(function (a) { return { id: a.id, label: a.label, balance: a.balance, consent: clone(a.consent) }; });
    audit(taskId, "tool", name, { result: result }, run);
    return result;
  }
  function runFor(taskId, trigger) {
    var r = { id: id("run"), taskId: taskId, trigger: trigger, at: state.now, steps: [], status: "planning" };
    state.runs.push(r);
    return r;
  }
  function busy() { return state.operations.find(function (op) { return activeStatuses.includes(op.status); }); }
  function taskBusy(taskId) { return state.operations.find(function (op) { return op.taskId === taskId && activeStatuses.includes(op.status); }); }
  function invalidate(reason) {
    Object.values(state.plans).forEach(function (p) {
      if (p.status === "awaiting") {
        p.status = "invalidated";
        audit(p.taskId, "replan", "Eski plan geçersizleşti", { planId: p.id, reason: reason });
      }
    });
  }
  function policy(p, approved, execution) {
    var f = forecast(), t = state.tasks[p.taskId], perm = state.permissions;
    function denied(reason) { return { allowed: false, needsApproval: false, reason: reason }; }
    function approval(reason) { return { allowed: false, needsApproval: true, reason: reason }; }
    if (t.paused) return denied("Görev duraklatıldı.");
    if (execution && (p.dataVersion !== state.dataVersion || p.permissionVersion !== state.permissionVersion)) return denied("Veri veya izin sürümü değişti. Yeni plan gerekiyor.");
    if (!Number.isSafeInteger(p.amount) || p.amount < 0 || (["save", "recover", "gold-buy", "saved-transfer", "payee-transfer"].includes(p.kind) && p.amount === 0)) return denied("Geçersiz işlem tutarı.");
    if (p.kind === "payee-transfer") {
      // Yüksek riskte zorunlu soru + 15 dk bekleme. Kalıcı bloke yok; bekleme sonrası karar kullanıcıda.
      var sh = state.shield, guarded = !!p.risk && p.risk.level === "high" || !!p.held, ctx = p.shieldFlow === "context";
      if (protectionBlocks(p.recipientIban)) return denied(protectionLockReason());
      if (p.amount > balance("cash")) return denied("Transfer için hesapta yeterli bakiye yok.");
      if (!approved) return approval(guarded ? (ctx ? (p.held ? holdDenial(sh) : CONTEXT_DENY.ask) : "Yüksek riskli transfer: güvenlik sorusunu yanıtla ve 15 dakikalık beklemeyi tamamla.") : "Her transfer için ayrı onayın gerekiyor.");
      if (guarded && (!sh || sh.planId !== p.id || sh.status !== "active")) return denied("Güvenlik kalkanı kaydı bulunamadı. Yeni transfer talebi gerekiyor.");
      // Ek bağlam akışı: yalnız "standart onay" sonucunda gönderilir; 15 dk bekleme yoktur ve bekleme hiçbir kararı açmaz.
      if (guarded && ctx) {
        var outcome = shieldOutcome(sh);
        if (outcome !== "approve") return denied(outcome === "hold" ? holdDenial(sh) : CONTEXT_DENY[outcome] || CONTEXT_DENY.ask);
        return { allowed: true, needsApproval: false, reason: "Ek bilgi kaydedildi. Tek işlem onayı ve güncel bakiye kontrolü uygun." };
      }
      if (guarded && !sh.answer) return denied("Güvenlik sorusu yanıtlanmadan transfer gönderilmez.");
      if (guarded && (!sh.coolingUntil || state.now < sh.coolingUntil)) return denied("15 dakikalık güvenlik beklemesi tamamlanmadan transfer gönderilmez.");
      return { allowed: true, needsApproval: false, reason: "Tek işlem onayı, güvenlik beklemesi ve güncel bakiye kontrolü uygun." };
    }
    if (p.kind === "card-pay") {
      var stp = state.bank.cardStatement;
      if (!stp || p.statementId !== stp.id || p.amount <= 0 || p.amount > stp.total - stp.paid) return denied("Ekstre borcu değişti. Yeni karar gerekiyor.");
      if (p.topUp > balance("savings")) return denied("Fon bakiyesi tamamlama için yetersiz.");
      if (balance("cash") + p.topUp < p.amount) return denied("Ödeme için vadesizde yeterli para yok.");
      if (p.topUp > 0 && !fundWindow().open) return denied(fundClosedReason());
      if (!approved) return approval("Kart ödemesi için onay gerekiyor.");
      return { allowed: true, needsApproval: false, reason: "Kendi kartına ödeme. Tek işlem onayı ve güncel bakiye kontrolü uygun." };
    }
    if (["redeem", "recover", "save"].includes(p.kind) && !fundWindow().open) return denied(fundClosedReason());
    if (p.kind === "redeem") {
      if (p.amount > balance("savings")) return denied("Birikim bakiyesi bu tutar için yetersiz.");
      if (!approved) return approval("Birikimden hesabına aktarım için onay gerekiyor.");
      return { allowed: true, needsApproval: false, reason: "Kendi hesapların arasında tek işlem onayı uygun." };
    }
    if (p.kind === "ob-pull") {
      var linked = state.bank.linkedAccounts.find(function (a) { return a.id === p.linkedAccountId; });
      if (!linked || linked.consent.status !== "active" || !linked.consent.scopes.includes("payment-initiation") || linked.consent.expiresOn < day()) return denied("Açık bankacılık ödeme başlatma izni bulunamadı veya süresi doldu.");
      if (p.amount <= 0 || p.amount > linked.balance) return denied("Bağlı hesapta yeterli bakiye yok.");
      if (!approved) return approval("Diğer bankadan aktarım için tek işlem onayı gerekiyor.");
      return { allowed: true, needsApproval: false, reason: "Açık bankacılık izni, bağlı hesap bakiyesi ve tek işlem onayı uygun." };
    }
    if (TRIAL_KINDS.includes(p.kind)) {
      var trial = state.bank.trials.find(function (x) { return x.id === p.trialId; });
      if (!trial || trial.status !== "detected") return denied("Bu deneme için karar zaten kaydedildi.");
      if (trial.renewalDue < day()) return denied("Deneme süresi geçti. Yenileme kararı artık verilemez.");
      if (p.kind === "trial-continue" && p.amount !== trial.renewalAmount) return denied("Yenileme tutarı değişti. Yeni karar gerekiyor.");
      if (!approved) return approval("Deneme kararı için onayın gerekiyor.");
      return { allowed: true, needsApproval: false, reason: "Kullanıcının açık kararı ve deneme durumu uygun." };
    }
    if (p.kind === "saved-transfer") {
      // Üçüncü kişiye giden kayıtlı transfer: ön yetki kapsamına girmez, her seferinde ayrı onay ister.
      var template = state.bank.savedTransfers.find(function (x) { return x.id === p.savedId; });
      if (!template || template.amount !== p.amount) return denied("Kayıtlı işlem bulunamadı veya tutarı değişti.");
      if (p.amount > balance("cash")) return denied("Transfer için hesapta yeterli bakiye yok.");
      if (!approved) return approval("Her kayıtlı transfer için ayrı onayın gerekiyor.");
      return { allowed: true, needsApproval: false, reason: "Tek işlem onayı ve güncel bakiye/izin kontrolü uygun." };
    }
    if (p.kind === "save") {
      if (perm.source !== "cash" || perm.target !== "savings") return denied("Ön yetki hesap kapsamı dışında.");
      var source = state.bank.accounts.find(function (a) { return a.id === perm.source; });
      var target = state.bank.accounts.find(function (a) { return a.id === perm.target; });
      if (!source || !target || source.owner !== target.owner || source.owner !== "elif" || source.currency !== "TRY" || target.currency !== "TRY") return denied("Kendi TRY hesapları kapsamı doğrulanamadı.");
      if (p.amount > (p.taskId === "fund" ? balance("cash") : f.available)) return denied("Kalan gider ve nakit tamponu için yeterli kaynak yok.");
      if (spent("save") + p.amount > (p.taskId === "fund" ? Math.max(balance("cash"), perm.monthlyLimit) : perm.monthlyLimit)) return denied("Aylık birikim aktarım limiti aşılıyor.");
      if (!approved && (!perm.autoSave || state.now > perm.expiresAt)) return approval("Bu işlem için onayın gerekiyor. Ön yetki kapalı veya süresi dolmuş.");
      if (!approved && p.amount > perm.perAction) return approval("İşlem ön yetki tutarını aşıyor. Limit bölünerek aşılmaz. Tek işlem onayı gerekiyor.");
      return { allowed: true, needsApproval: false, reason: approved ? "Tek işlem onayı, kaynak ve aylık limit uygun." : "Açık ön yetki, hesap kapsamı, işlem/ay limiti ve tampon uygun." };
    }
    if (p.kind === "recover" && (p.amount > balance("savings") || p.amount > f.shortfall)) return denied("Dönüş tutarı güncel ihtiyaç veya likit birikim bakiyesini aşıyor.");
    if (p.kind === "bes-change") {
      if (day() < A.RULES.bes.effectiveFrom || day() > A.RULES.bes.validThrough) return denied("Tarihli BES kuralı bu dönemde geçerli değil.");
      var currentPayment = state.bank.payments.find(function (x) { return x.kind === "bes" && x.status === "pending" && x.due >= day() && x.due <= A.CONFIG.horizon; });
      if (currentPayment && Math.max(0, p.amount - currentPayment.amount) > f.available) return denied("Katkı artışının bu dönem ödemesi için nakit tamponu korunamıyor.");
    }
    if (p.kind === "gold-buy") {
      if (state.now >= state.bank.quote.expiresAt || p.quoteId !== state.bank.quote.id) return denied("Teklif süresi doldu veya kotasyon değişti.");
      if (spread() > state.goals.gold.thresholdBps) return denied("Kullanıcının makas koşulu sağlanmıyor.");
      if (p.amount > f.available || p.amount > Math.max(0, state.goals.gold.budget - spent("gold-buy"))) return denied("Altın bütçesi veya kullanılabilir nakit yetersiz.");
      if (p.quantityMg <= 0) return denied("Bütçe en küçük altın miktarının altında.");
    }
    if (!approved) return approval("Bu işlem türü için her defasında onayın gerekiyor.");
    return { allowed: true, needsApproval: false, reason: "Tek işlem onayı ve güncel kaynak/koşul kontrolü uygun." };
  }
  function makePlan(taskId, kind, amount, trigger, extra) {
    var t = state.tasks[taskId], r = runFor(taskId, trigger);
    audit(taskId, "perception", "Olay algılandı", { trigger: trigger, date: day() }, r);
    readTool("readAccounts", taskId, r); readTool("readPaymentSchedule", taskId, r); readTool("readVariableHistory", taskId, r); readTool("readExpensePriceBasis", taskId, r);
    if (taskId === "bes") readTool("readBesContract", taskId, r);
    if (taskId === "gold") readTool("getGoldQuote", taskId, r);
    if (taskId === "trial") { readTool("readCardAuthorizations", taskId, r); readTool("readTrials", taskId, r); }
    if (taskId === "liquidity") readTool("readLinkedAccounts", taskId, r);
    var p = { id: id("plan"), taskId: taskId, runId: r.id, version: ++t.planVersion, kind: kind, amount: amount,
      dataVersion: state.dataVersion, permissionVersion: state.permissionVersion, status: "awaiting",
      facts: { balances: { cash: balance("cash"), savings: balance("savings") }, forecast: forecast() },
      alternatives: kind === "recover" ? ["Ayrı onayla likit birikimden dönüş", "Yeni isteğe bağlı işlemleri beklet"] : TRANSFER_KINDS.includes(kind) ? ["Transferi onaylama", "Başka bir kayıtlı işlem seç"] : TRIAL_KINDS.includes(kind) ? ["Yenileme çekimini kartta engelle", "Devam et ve gider tahminine ekle"] : ["Tutarı veya koşulu değiştir", "Taslağı iptal et ve görevi duraklat"] };
    if (extra) Object.assign(p, extra);
    if (kind === "gold-buy") {
      p.quoteId = state.bank.quote.id; p.expiresAt = state.bank.quote.expiresAt; p.quantityMg = Math.floor(amount * 1000 / state.bank.quote.ask);
      p.amount = Math.ceil(p.quantityMg * state.bank.quote.ask / 1000);
      p.facts.quote = clone(state.bank.quote); p.facts.spreadBps = spread();
    }
    if (kind === "bes-change") p.facts.besEstimate = besEstimate(amount);
    audit(taskId, "reasoning", "Hedef ve nakit planı hesaplandı", { kind: kind, amount: p.amount, facts: p.facts, alternatives: p.alternatives }, r);
    var decision = policy(p, false, false);
    p.permissionDecision = decision; p.autoEligible = decision.allowed;
    if (!decision.allowed && !decision.needsApproval) { p.status = "blocked"; t.status = "blocked"; } else { t.status = "awaiting"; }
    t.reason = decision.reason; state.plans[taskId] = p; r.planId = p.id; r.status = p.status;
    audit(taskId, "guardrail", "İzin ve sınır kontrolü", decision, r);
    return p;
  }
  function scan(trigger, allowAuto) {
    var autoPlan = null;
    A.TASKS.forEach(function (def) {
      var t = state.tasks[def.id], old = state.plans[def.id];
      if (t.paused || taskBusy(def.id) || t.needsRetry) return;
      if (old && old.status === "awaiting" && old.dataVersion === state.dataVersion && old.permissionVersion === state.permissionVersion) return;
      var p = null, f = forecast(), g = state.goals[def.id];
      if (def.id === "savings" && g.requested && f.shortfall && openStatement()) {
        // Açık, ekstre kartındaki ödemede fondan tamamlanır; aynı para için ikinci bir "hesabıma al" önerisi gösterilmez.
        t.status = "blocked"; t.reason = "Önce kart ekstresi: eksik kalan tutarı ekstre ödemesinde fondan tamamlarım.";
      } else if (def.id === "savings" && g.requested) {
        var kind = f.shortfall ? "recover" : "save";
        var amount = f.shortfall ? Math.min(f.shortfall, balance("savings")) : (g.amount === null ? (state.permissions.autoSave ? Math.min(f.available, Math.max(0, state.permissions.monthlyLimit - spent("save"))) : f.available) : g.amount);
        if (amount > 0) p = makePlan(def.id, kind, amount, trigger);
        else { t.status = "blocked"; t.reason = "Bu dönem için ayrılabilir tutar veya likit dönüş kaynağı bulunmuyor."; }
      } else if (def.id === "bes" && g.requested && g.target !== state.bank.bes.monthly) {
        p = makePlan(def.id, "bes-change", g.target, trigger);
      } else if (def.id === "gold" && g.watching) {
        var budget = Math.min(Math.max(0, g.budget - spent("gold-buy")), f.available);
        if (state.now >= state.bank.quote.expiresAt) { t.status = "blocked"; t.reason = "Teklifin süresi doldu. Yeni kotasyon bekleniyor."; }
        else if (spread() > g.thresholdBps) { t.status = "monitoring"; t.reason = "Makas koşulu sağlanmıyor. Alım taslağı hazırlanmıyor."; }
        else if (budget <= 0) { t.status = "blocked"; t.reason = "Kullanılabilir nakit veya dönem altın bütçesi kalmadı."; }
        else p = makePlan(def.id, "gold-buy", budget, trigger);
        if (!p) audit(def.id, "monitor", "Altın koşulu yeniden değerlendirildi", { spreadBps: spread(), thresholdBps: g.thresholdBps, budget: budget, reason: t.reason });
      } else if (!["succeeded", "failed", "cancelled"].includes(t.status)) { t.status = "monitoring"; t.reason = def.rationale; }
      if (!p && old && old.status === "invalidated") delete state.plans[def.id];
      if (p && p.autoEligible && allowAuto && p.kind === "save") autoPlan = p;
    });
    notify();
    if (autoPlan && !busy()) return execute(autoPlan, false);
    return Promise.resolve({ ok: true });
  }
  function replan(reason, allowAuto) { invalidate(reason); return scan(reason, !!allowAuto); }
  function wait(gen, duration, operationId) {
    return new Promise(function (resolve) {
      var entry = { handle: null, resolve: resolve, operationId: operationId };
      entry.handle = setTimeout(function () { timers.delete(entry); resolve(gen === generation); }, duration === undefined ? delayMs : duration);
      timers.add(entry);
    });
  }
  function cancelTransfer(operationId) {
    var op = state.operations.find(function (o) { return o.id === operationId; });
    if (!op || !UNDOABLE_KINDS.includes(op.kind) || op.status !== "pending" || op.applied || Date.now() >= op.undoDeadline) return invalid("Bu transferin gönderim öncesi iptal süresi doldu. Mevcut sonucu kontrol et.");
    op.status = "cancelled"; op.reason = TRIAL_KINDS.includes(op.kind) ? "Kararın uygulanmadan geri alındı. Hiçbir ayar değişmedi." : "Transfer gönderilmeden iptal edildi. Para hesaplarında kaldı.";
    var p = state.plans[op.taskId], t = state.tasks[op.taskId], run = state.runs.find(function (r) { return r.id === op.runId; });
    if (p && p.id === op.planId) p.status = "cancelled";
    t.status = t.paused ? "paused" : "cancelled"; t.reason = op.reason; t.needsRetry = false;
    if (op.kind === "save" || op.kind === "recover") { state.goals.savings.requested = false; state.goals.savings.amount = null; }
    if (run) run.status = "cancelled";
    timers.forEach(function (entry) { if (entry.operationId === op.id) { clearTimeout(entry.handle); timers.delete(entry); entry.resolve(false); } });
    audit(op.taskId, "cancel", "Transfer gönderilmeden iptal edildi", { operationId: op.id, key: op.key, amount: op.amount, recordUnchanged: true }, run);
    replan("Bekleyen transfer iptal edildi · ayrılan kaynak serbest bırakıldı", false);
    return { ok: true, cancelled: true, operationId: op.id };
  }
  function addTransaction(op, postings, label, extra) {
    var tx = { id: id("tx"), ref: (extra && extra.ref) || id("REF-TX"), operationId: op.id, key: op.key, at: new Date(state.now).toISOString(),
      kind: op.kind, label: label, amount: op.amount, postings: postings, status: "settled" };
    if (extra) Object.assign(tx, extra);
    state.bank.transactions.push(tx);
  }
  function operationResult(op) {
    var txs = state.bank.transactions.filter(function (tx) { return tx.operationId === op.id && tx.key === op.key; });
    var matched = false;
    if (op.kind === "save" || op.kind === "recover" || op.kind === "redeem") {
      var from = op.kind === "save" ? "cash" : "savings", to = op.kind === "save" ? "savings" : "cash";
      matched = txs.length === 1 && txs[0].amount === op.amount &&
        txs[0].postings.length === 2 && txs[0].postings.some(function (p) { return p.account === from && p.amount === -op.amount; }) &&
        txs[0].postings.some(function (p) { return p.account === to && p.amount === op.amount; });
    }
    if (TRANSFER_KINDS.includes(op.kind)) matched = txs.length === 1 && txs[0].amount === op.amount &&
      txs[0].postings.length === 1 && txs[0].postings[0].account === "cash" && txs[0].postings[0].amount === -op.amount && !!op.receipt;
    if (op.kind === "ob-pull") {
      var lr = state.bank.liquidityReserve;
      matched = txs.length === 1 && txs[0].amount === op.amount && txs[0].postings.length === 1 && txs[0].postings[0].account === "cash" &&
        txs[0].postings[0].amount === op.amount && !!op.receipt && !!lr && lr.operationId === op.id;
    }
    if (TRIAL_KINDS.includes(op.kind)) {
      var trial = state.bank.trials.find(function (x) { return x.id === op.trialId; });
      matched = !!op.receipt && !!trial && trial.decisionRef === op.id && (op.kind === "trial-block"
        ? trial.status === "blocked" && state.bank.cardControls.filter(function (c) { return c.operationId === op.id; }).length === 1
        : trial.status === "continued" && state.bank.payments.filter(function (x) { return x.operationId === op.id && x.amount === op.amount && x.status === "pending"; }).length === 1);
    }
    if (op.kind === "card-pay") {
      var payTx = txs.filter(function (tx) { return tx.kind === "card-pay"; }), topTx = txs.filter(function (tx) { return tx.kind === "card-topup"; });
      matched = !!op.receipt && payTx.length === 1 && payTx[0].postings.length === 1 && payTx[0].postings[0].account === "cash" && payTx[0].postings[0].amount === -op.amount &&
        (op.topUp > 0 ? topTx.length === 1 && topTx[0].postings.some(function (p) { return p.account === "savings" && p.amount === -op.topUp; }) && topTx[0].postings.some(function (p) { return p.account === "cash" && p.amount === op.topUp; }) : topTx.length === 0);
    }
    if (op.kind === "gold-buy") matched = txs.length === 1 && txs[0].amount === op.amount &&
      txs[0].postings.length === 1 && txs[0].postings[0].account === "cash" && txs[0].postings[0].amount === -op.amount &&
      !!op.receipt && state.bank.gold.quantityMg === op.goldBefore + op.receipt.quantityMg;
    if (op.kind === "bes-change") matched = !!op.receipt && state.bank.bes.monthly === op.amount &&
      state.bank.payments.filter(function (p) { return p.kind === "bes" && p.status === "pending" && p.due >= day(); }).every(function (p) { return p.amount === op.amount; });
    return { operationId: op.id, applied: matched, reference: matched && op.receipt ? op.receipt.reference : null, recordChecked: true };
  }
  // Tekil anahtar mock backend'de de kontrol edilir. Belirsiz sonuçta tekrar çağrılmaz.
  function commit(op, p) {
    if (op.applied) return;
    var label;
    if (p.kind === "save" || p.kind === "recover") {
      var from = p.kind === "save" ? "cash" : "savings", to = p.kind === "save" ? "savings" : "cash";
      label = p.kind === "save" ? (p.taskId === "fund" ? (state.preferences.fundCode === "AIS" ? "Fona aktarım · Ak Portföy Katılım PPF" : "Fona aktarım · Ak Portföy PPF") : "Birikim hesabına aktarım") : "Vadesize dönüş aktarımı";
      addTransaction(op, [{ account: from, amount: -p.amount }, { account: to, amount: p.amount }], label, { category: p.kind === "save" ? "savings-deposit" : "savings-redemption" });
      if (p.taskId === "savings") { state.goals.savings.requested = false; state.goals.savings.amount = null; }
    }
    if (p.kind === "saved-transfer") {
      var tpl = state.bank.savedTransfers.find(function (x) { return x.id === p.savedId; });
      label = tpl ? tpl.label + " (" + tpl.payee + ")" : "Kayıtlı Transfer";
      addTransaction(op, [{ account: "cash", amount: -p.amount }], "Transfer · " + (tpl ? tpl.label : "Kayıtlı"), { merchant: tpl ? tpl.payee : "", category: "transfer" });
      op.savedId = p.savedId;
    }
    if (p.kind === "payee-transfer") {
      label = "Transfer · " + p.payee;
      addTransaction(op, [{ account: "cash", amount: -p.amount }], label, { merchant: p.payee, category: "transfer", ibanMask: p.recipientIban });
      if (state.shield && state.shield.planId === p.id) state.shield.status = "completed";
    }
    if (p.kind === "card-pay") {
      var cst = state.bank.cardStatement, cpay = state.bank.payments.find(function (x) { return x.id === cst.paymentId; });
      // Tek onay, iki kayıt: gerekiyorsa önce fondan vadesize tamamlanır, sonra karta ödenir.
      if (p.topUp > 0) addTransaction(op, [{ account: "savings", amount: -p.topUp }, { account: "cash", amount: p.topUp }], "Fondan vadesize · kart ödemesi için", { kind: "card-topup", category: "card-topup", amount: p.topUp });
      addTransaction(op, [{ account: "cash", amount: -p.amount }], "Kredi kartı ödemesi", { category: "card" });
      cst.paid += p.amount;
      var cleft = cst.total - cst.paid;
      if (cpay) { cpay.amount = cleft; if (cleft === 0) cpay.status = "paid"; else if (cst.paid >= cst.minimum) cpay.label = "Kart borcu (kalan)"; }
      label = cleft === 0 ? "Kart ekstresi ödendi" : "Kart ekstresine ödeme";
    }
    if (p.kind === "redeem") {
      label = "Birikimden bozum · vadesize";
      addTransaction(op, [{ account: "savings", amount: -p.amount }, { account: "cash", amount: p.amount }], label, { category: "savings-redemption" });
    }
    if (p.kind === "ob-pull") {
      var linkedAccount = state.bank.linkedAccounts.find(function (a) { return a.id === p.linkedAccountId; });
      linkedAccount.balance -= p.amount;
      label = "Açık bankacılık · " + linkedAccount.label + " → Vadesiz";
      addTransaction(op, [{ account: "cash", amount: p.amount }], label, { merchant: linkedAccount.institution, category: "open-banking-in" });
      // Gelen tutar kırılgan gün için ayrılır; birikim önerisini artırmaz.
      state.bank.liquidityReserve = { amount: p.amount, until: p.fragileDay, source: "open-banking", operationId: op.id, reference: id("LIQ"), at: state.now };
    }
    if (TRIAL_KINDS.includes(p.kind)) {
      var trial = state.bank.trials.find(function (x) { return x.id === p.trialId; });
      trial.decisionRef = op.id;
      if (p.kind === "trial-block") {
        // Yalnız bu üye işyerinin kartından yeni dönem çekimi durur; sağlayıcıdaki üyelik banka tarafından iptal edilmez.
        trial.status = "blocked";
        state.bank.cardControls.push({ id: id("control"), operationId: op.id, merchant: trial.merchant, type: "block-recurring-charge", from: trial.renewalDue, at: state.now });
        label = trial.merchant + " yeni dönem kart çekimi engellendi";
      } else {
        trial.status = "continued";
        state.bank.payments.push({ id: trial.id + "-renewal", orderId: trial.id, operationId: op.id, due: trial.renewalDue, kind: "card-subscription", amount: trial.renewalAmount, status: "pending", obligation: true });
        state.bank.automaticPaymentOrders.push({ id: trial.id, label: trial.merchant, kind: "card-subscription", status: "active" });
        label = trial.merchant + " yenilemesi gider tahminine eklendi";
      }
    }
    if (p.kind === "bes-change") {
      state.bank.bes.monthly = p.amount;
      state.bank.payments.forEach(function (x) { if (x.kind === "bes" && x.status === "pending" && x.due >= day()) x.amount = p.amount; });
      state.goals.bes.requested = false; label = "BES gelecek katkı talimatı güncellendi";
    }
    if (p.kind === "gold-buy") {
      state.bank.gold.quantityMg += p.quantityMg;
      addTransaction(op, [{ account: "cash", amount: -p.amount }], "Altın hesabına alım");
      state.goals.gold.watching = false; label = "Altın hesabına alım";
    }
    op.applied = true; state.dataVersion++;
    op.receipt = {
      reference: id("MOCK"),
      kind: p.kind,
      label: label,
      at: state.now,
      amount: p.amount,
      quantityMg: p.quantityMg || 0,
      verified: false,
      savedId: p.savedId || null,
      trialId: p.trialId || null,
      topUp: p.topUp || 0,
      payee: (tpl && tpl.payee) || op.payeeLabel || "",
      ibanMask: (tpl && tpl.ibanMask) || p.recipientIban || "",
      note: (tpl && tpl.note) || p.note || ""
    };
  }
  function finish(op, success, reason) {
    op.status = success ? "succeeded" : "failed"; op.reason = reason;
    var t = state.tasks[op.taskId], p = state.plans[op.taskId], run = state.runs.find(function (r) { return r.id === op.runId; });
    if (p && p.id === op.planId) p.status = op.status;
    t.status = t.paused ? "paused" : op.status; t.reason = reason; t.needsRetry = !success;
    if (success) { op.receipt.verified = true; t.lastReceipt = clone(op.receipt); }
    if (run) run.status = op.status;
    audit(op.taskId, success ? "verified" : "error", success ? "Sonuç mock kayıttan doğrulandı" : "İşlem gerçekleşmedi", { operationId: op.id, reference: op.receipt && op.receipt.reference, reason: reason }, run);
    replan("Araç sonucu ve kaynaklar güncellendi", false);
    return { ok: success, operationId: op.id, reason: reason };
  }
  async function execute(p, approved) {
    if (p.status !== "awaiting") return { ok: false, reason: "Plan onaya açık değil." };
    if (busy()) return { ok: false, reason: "Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı." };
    var decision = policy(p, approved, true);
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    var run = state.runs.find(function (r) { return r.id === p.runId; });
    audit(p.taskId, approved ? "approval" : "authorization", approved ? "Tek işlem demo onayı kaydedildi" : "Açık ön yetki kullanıldı", { planId: p.id, version: p.version, decision: decision }, run);
    var gen = generation, cancellable = UNDOABLE_KINDS.includes(p.kind) && undoMs > 0;
    var op = { id: id("op"), key: p.id + ":" + p.version, taskId: p.taskId, planId: p.id, runId: p.runId, kind: p.kind,
      amount: p.amount, cashImpact: ["save", "gold-buy"].concat(TRANSFER_KINDS).includes(p.kind) ? p.amount : (p.kind === "bes-change" ? Math.max(0, p.amount - state.bank.bes.monthly) : 0),
      status: cancellable ? "pending" : "running", applied: false, approvedPermissionVersion: state.permissionVersion, submittedPermissionVersion: null, reconciling: false, goldBefore: state.bank.gold.quantityMg,
      undoDeadline: cancellable ? Date.now() + undoMs : null, undoWindowMs: cancellable ? undoMs : 0, submittedAt: null };
    if (p.kind === "saved-transfer") { op.savedId = p.savedId; op.payeeLabel = p.payeeLabel; }
    if (p.kind === "payee-transfer") { op.payeeLabel = p.payeeLabel; op.recipientIban = p.recipientIban; }
    if (p.trialId) op.trialId = p.trialId;
    if (p.kind === "card-pay") { op.topUp = p.topUp; op.statementId = p.statementId; }
    if (p.linkedAccountId) op.linkedAccountId = p.linkedAccountId;
    state.operations.push(op); p.status = op.status; state.tasks[p.taskId].status = op.status; run.status = op.status;
    if (cancellable) {
      audit(p.taskId, "pending", "Transfer gönderim için bekliyor", { operationId: op.id, amount: op.amount, windowMs: undoMs, reserved: op.cashImpact }, run);
      notify();
      if (gen !== generation) return { ok: false, reason: "Demo sıfırlandı. Eski çalışma iptal edildi." };
      if (op.status === "cancelled") return { ok: true, cancelled: true, operationId: op.id };
      var elapsed = await wait(gen, Math.max(0, op.undoDeadline - Date.now()), op.id);
      if (gen !== generation) return { ok: false, reason: "Demo sıfırlandı. Eski çalışma iptal edildi." };
      if (!elapsed || op.status === "cancelled") return { ok: true, cancelled: true, operationId: op.id };
      // Gönderimden önce veri/izin/kaynak yeniden kontrol edilir; kendi rezervi ikinci kez düşülmez.
      op.status = "checking"; decision = policy(p, approved, true); op.status = "pending";
      if (!decision.allowed) return finish(op, false, decision.reason);
    }
    op.status = "running"; p.status = "running"; state.tasks[p.taskId].status = "running"; run.status = "running";
    op.submittedAt = state.now; op.submittedPermissionVersion = state.permissionVersion;
    audit(p.taskId, "action", "Mock araç çağrısı gönderildi", { operationId: op.id, key: op.key, tool: p.kind, reserved: op.cashImpact }, run);
    notify();
    if (gen !== generation) return { ok: false, reason: "Demo sıfırlandı. Eski çalışma iptal edildi." };
    if (!await wait(gen)) return { ok: false, reason: "Demo sıfırlandı. Eski çalışma iptal edildi." };
    // Kendi rezervi yeterlilik kontrolünde ikinci kez düşülmez.
    op.status = "checking"; decision = policy(p, approved, true); op.status = "running";
    if (!decision.allowed) return finish(op, false, decision.reason);
    var mode = state.nextToolMode; state.nextToolMode = "success"; op.mode = mode;
    if (mode === "fail") return finish(op, false, "Mock araç işlemi reddetti. Finansal kayıt değişmedi.");
    if (mode !== "timeout-before") commit(op, p);
    if (mode === "timeout-before" || mode === "timeout-after") {
      op.status = "unknown"; p.status = "unknown"; state.tasks[p.taskId].status = "unknown"; run.status = "unknown";
      state.tasks[p.taskId].reason = "Yanıt gelmedi. Yeni işlem göndermeden mevcut işlem sorgulanmalı.";
      audit(p.taskId, "uncertainty", "Araç yanıtı belirsiz", { operationId: op.id, key: op.key }, run);
      invalidate("Belirsiz işlem · kaynaklar yeniden değerlendirilecek"); notify();
      return { ok: false, unknown: true, operationId: op.id };
    }
    audit(p.taskId, "tool-result", "Mock araç yanıtı alındı", { reference: op.receipt.reference }, run); notify();
    if (!await wait(gen)) return { ok: false, reason: "Demo sıfırlandı." };
    var verified = operationResult(op);
    audit(p.taskId, "tool", "getOperationStatus", verified, run);
    return finish(op, verified.applied, verified.applied ? "İşlem sonucu mock kayıttan doğrulandı." : "Mock kayıt doğrulaması başarısız. İnsan incelemesi gerekiyor.");
  }
  async function reconcile(opId) {
    var op = state.operations.find(function (o) { return o.id === opId; });
    if (!op || op.status !== "unknown" || op.reconciling) return { ok: false, reason: "Sorgulanabilir belirsiz işlem bulunmuyor." };
    op.reconciling = true; notify();
    var gen = generation;
    if (!await wait(gen)) return { ok: false, reason: "Demo sıfırlandı." };
    op.reconciling = false;
    var verified = operationResult(op);
    audit(op.taskId, "tool", "getOperationStatus", verified);
    return finish(op, verified.applied, verified.applied ? "Belirsiz yanıtın gerçekleşen sonucu doğrulandı. Tekrar gönderilmedi." : "Mock backend işlem oluşmadığını doğruladı. Kaynak ayrımı kaldırıldı.");
  }
  function invalid(reason) { return { ok: false, reason: reason }; }
  // Aday 13: yeni alıcıya transfer talebi. Risk yüksekse onay hattı soru + bekleme tamamlanana kadar kapalıdır.
  // Demo IBAN'ı: TR + rakam yeterli (ör. "TR 101"). Tam numara saklanmaz; yalnız son en fazla dört hane tutulur.
  function normalizeIban(raw) {
    var iban = String(raw || "").replace(/\s+/g, "").toUpperCase();
    return /^TR\d{1,32}$/.test(iban) ? "TR** **** " + iban.slice(2).slice(-4) : null;
  }
  function preparePayeeTransfer(c) {
    var ibanKey = null;
    if (c.iban !== undefined) { var masked = normalizeIban(c.iban); if (!masked) return invalid("IBAN TR ile başlamalı ve rakamlarla devam etmeli."); ibanKey = ibanFingerprint(c.iban); c = Object.assign({}, c, { ibanMask: masked }); }
    var payee = typeof c.payee === "string" ? c.payee.trim() : "", iban = typeof c.ibanMask === "string" ? c.ibanMask.trim() : "";
    if (!payee || payee.length > 80 || !/^TR[0-9* ]{6,30}$/.test(iban)) return invalid("Alıcı adı ve geçerli bir IBAN gerekli.");
    if (!Number.isSafeInteger(c.amount) || c.amount <= 0 || c.amount > 100000000) return invalid("Pozitif ve geçerli tutar gir.");
    if (protectionBlocks(iban)) return invalid(protectionLockReason());
    if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
    var risk = assessTransferRisk({ amount: c.amount, ibanMask: iban }), flow = state.shieldFlow;
    // Ek bağlam akışı: bu alıcı için doğrulama/durdurma kararı varsa yeni taslak da o kararla açılır (cevap veya yeni tutar kararı kaldırmaz).
    var held = flow === "context" ? holdFor(iban, ibanKey) : null, heldOther = flow === "context" && !held ? directedHold(iban) : null;
    // Eski taslağın cevapları yeni alıcı/tutarla kullanılmaz: önceki etkin kalkan kapanır.
    if (flow === "context" && state.shield && state.shield.status === "active") { state.shield.status = "superseded"; audit("transfer", "shield", "Önceki transfer taslağı yenisiyle değişti, cevapları kullanılmaz", { shieldId: state.shield.id, moneyMoved: false }); }
    var p = makePlan("transfer", "payee-transfer", c.amount, "Yeni alıcıya transfer talebi", { payee: payee, payeeLabel: payee, recipientIban: iban, note: typeof c.note === "string" ? c.note.trim() : "", description: typeof c.description === "string" ? c.description.trim().slice(0, 140) : "", risk: risk, shieldFlow: flow, held: !!(held || heldOther) });
    if (flow === "context" && (risk.level === "high" || held || heldOther)) {
      state.shield = { id: id("SHIELD"), planId: p.id, flow: "context", status: "active", score: risk.score, level: risk.level,
        signals: risk.signals.filter(function (x) { return x.active; }).map(function (x) { return x.code; }), risk: clone(risk),
        payee: payee, recipientIban: iban, recipientKey: ibanKey, amount: c.amount, answers: { directed: null, secrecy: null, feeling: null }, answer: null,
        hold: held ? { shieldId: held.shieldId, outcome: held.outcome } : heldOther ? { shieldId: heldOther.shieldId, outcome: heldOther.outcome, otherPayee: true } : null, coolingUntil: null, autoCooling: false, startedAt: state.now, reviewReference: null };
      // Puan iç hesapta ve teknik kayıtta kalır; müşteri yolunda gösterilmez. Kaynaklar ayrışır: hesap hareketi ve işlem (banka), cevaplar (müşteri), arama (senaryo).
      audit("transfer", "shield", held ? "Bu alıcı için doğrulama kararı sürüyor; transfer gönderilmedi" : heldOther ? "Müşteri yönlendirildiğini bildirdi; yeni alıcıya transfer gönderilmedi" : "Demo banka kuralı ek bağlam istedi; transfer gönderilmedi",
        { planId: p.id, score: risk.score, signals: state.shield.signals, decision: held || heldOther ? "hold" : "context", source: "bank-demo-rule", realBankScore: false, moneyMoved: false });
    } else if (risk.level === "high") {
      state.shield = { id: id("SHIELD"), planId: p.id, status: "active", score: risk.score, level: risk.level,
        signals: risk.signals.filter(function (x) { return x.active; }).map(function (x) { return x.code; }),
        answer: null, coolingUntil: state.now + A.RULES.scamShield.coolingMs, autoCooling: true, startedAt: state.now, reviewReference: null };
      // Güçlü sinyallerde 15 dk bekleme kullanıcı seçimine bırakılmaz; kalkanla birlikte kendiliğinden başlar.
      audit("transfer", "shield", "Güvenlik kalkanı devreye girdi; 15 dk bekleme otomatik başladı", { planId: p.id, score: risk.score, signals: state.shield.signals, intervention: "cognitive-pause+auto-cooling", coolingUntil: new Date(state.shield.coolingUntil).toISOString(), moneyMoved: false });
    }
    notify();
    return { ok: true, planId: p.id, version: p.version, status: p.status, risk: clone(risk), shield: risk.level === "high" || !!held || !!heldOther };
  }
  // Kullanıcının dolandırıcı yönlendirmesiyle yaptığı önceki adımların kurgusal canlandırması: görüşme sürüyor, birikim bozuldu.
  // 29 Ekim · kısa sürüm: transferi kullanıcı kendisi gönderir (scam-setup); hazır senaryo (scam-call) aynı başlangıçla transferi de hazırlar.
  // 5 Kasım (fraud uzmanı): kısa demoda arama başka telefondan gelir. Banka uygulaması o aramayı bilmez: cihaz sinyali yok, "Görüşme sürüyor" yok,
  // risk işaretlerinde ve çarpanda arama yok. Arayanın 112 kimliği yalnız senaryo bilgisidir; denetim kaydında kaynak "scenario", banka gözlemi değil.
  function scamSetup(scenario, otherPhone) {
    if (otherPhone) audit(null, "event", "Senaryo bilgisi: arama başka telefonda, banka uygulaması görmez", { source: "scenario", observedByBank: false, callerClaim: "112", callActive: false });
    else {
      state.device.call = { active: true, startedAt: state.now, txMark: state.bank.transactions.length, source: "demo-signal" };
      audit(null, "event", "Aktif görüşme sinyali", { callActive: true, source: "demo-signal" });
    }
    var savings = balance("savings");
    if (savings > 0) {
      state.bank.transactions.push({ id: id("redeem"), ref: id("REF-RD"), kind: "redemption", category: "savings-redemption", at: new Date(state.now).toISOString(),
        amount: savings, label: "Birikimden bozum · vadesize", status: "settled", postings: [{ account: "savings", amount: -savings }, { account: "cash", amount: savings }] });
      audit(null, "event", "Birikim bozuldu ve vadesize geçti", { redeemedAmount: savings, scenario: scenario, source: "account" });
    }
    state.dataVersion++;
  }
  async function scamScenario() {
    if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
    scamSetup("scam-call");
    await replan("Senaryo olayı: scam-call", false);
    var sc = state.bank.scamScenario;
    return preparePayeeTransfer({ payee: sc.payee, ibanMask: sc.ibanMask, amount: Math.min(sc.amount, balance("cash") - reserved()), note: sc.note });
  }
  // 20 Ekim (katılımcı): "Dolandırılan kişi korumayı zaten kaldırır." Görüşme sürerken kullanıcı kaldıramaz;
  // görüşme bittikten (ve koruma açıldıktan) 15 dk sonra kaldırabilir. Temsilci her zaman kaldırabilir.
  function protectionRelease() {
    var pr = state.protection, call = state.device.call || {};
    if (!pr.newPayeeLocked) return null;
    if (call.active) return { allowed: false, callActive: true, at: null };
    var at = Math.max(pr.since || 0, call.endedAt || 0) + A.RULES.scamShield.coolingMs;
    return { allowed: state.now >= at, callActive: false, at: at };
  }
  function protectionBlocks(iban) {
    var pr = state.protection;
    return !!pr.newPayeeLocked && (!knownPayeeIban(iban) || (pr.suspectIbans || []).includes(iban));
  }
  function protectionLockReason() {
    var rel = protectionRelease() || {};
    return "Yeni alıcılara transfer koruma altında. " + (rel.callActive ? "Görüşme sürerken korumayı yalnız müşteri temsilcisi kaldırabilir."
      : rel.allowed ? "Göndermek istiyorsan önce korumayı kaldır." : "Korumayı görüşme bittikten 15 dakika sonra kaldırabilirsin. Daha önce gerekiyorsa müşteri temsilcisi kaldırabilir.");
  }
  // 20 Ekim (kod incelemesi): bu görüşmede (görüşme yoksa son bir saatte) para gönderilen yeni alıcılar ve durdurulan alıcı
  // koruma süresince "bilinen" sayılmaz; parçalı gönderimde ilk parça dolandırıcının IBAN'ını kilitten muaf yapmaz.
  function lockNewPayees(sh, iban, extra) {
    var suspects = newPayeeOutflows(callMark() || 0).map(function (tx) { return tx.ibanMask; }).concat([iban]);
    state.protection = Object.assign({ newPayeeLocked: true, reference: id("PROTECT"), since: state.now, shieldId: sh.id,
      suspectIbans: suspects.filter(function (x, i) { return x && suspects.indexOf(x) === i; }) }, extra || {});
  }
  function stopShield() {
    var sh = activeShield();
    if (!sh) return invalid("Etkin güvenlik kalkanı bulunmuyor.");
    // Ek bağlam akışında durdurma ile koruma ayrıdır: "Bu transferi iptal et" yalnız bu taslağı kapatır, koruma ayrı ve açık bir seçimdir.
    if (sh.flow === "context") return invalid("Bu transferi iptal et. Yeni alıcı korumasını istersen ayrıca açabilirsin.");
    var p = state.plans.transfer, t = state.tasks.transfer;
    p.status = "cancelled"; t.status = "monitoring"; t.reason = "Şüpheli transfer kullanıcı tarafından durduruldu.";
    sh.status = "protected";
    lockNewPayees(sh, p.recipientIban);
    var labels = p.risk.signals.filter(function (x) { return x.active; }).map(function (x) { return x.label; });
    var answer = sh.answer === "yes" ? "Evet, telefondaki kişi işlemi gizli tutmamı istedi" : sh.answer === "no" ? "Hayır olarak yanıtlandı" : "Yanıtlanmadı";
    var operation = A.money(p.amount) + " transfer talebi · " + p.payee + " (" + p.recipientIban + ") · gönderilmedi";
    var verifiedStatus = "Gönderilmedi, para hesapta. Yeni alıcılara transfer kapalı (" + state.protection.reference + ").";
    // C2-11: özet düzenleme alanında tek uzun cümle yerine maddeler.
    var uncertainty = "Güvenlik işaretleri · risk puanı " + sh.score + "/100\n• " + labels.join("\n• ") + "\nGüvenlik sorusu: " + answer + ".";
    var question = "Telefonda yönlendirildiğimi düşündüğüm transferi durdurdum. Destek istiyorum.";
    var review = buildHumanReviewSummary("transfer", state, { question: question, operation: operation, amount: p.amount, operationRef: sh.id,
      verifiedStatus: verifiedStatus, uncertainty: uncertainty, summaryText: "İlgili işlem: " + operation + ". " + verifiedStatus + " " + uncertainty + " " + question });
    // Özet yalnız bu kalkan olayına bağlıdır; önceki kayıtlı transfer işlemleriyle karıştırılmaz.
    review.operationId = null; review.operationKind = "payee-transfer"; review.payee = p.payee; review.verified = false;
    review.reconcile = { inProgress: false, performed: false, lastApplied: null };
    t.humanReview = review; sh.reviewReference = review.reference;
    audit("transfer", "shield", "İşlem durduruldu ve korumaya alındı", { planId: p.id, protection: state.protection.reference, moneyMoved: false, answer: sh.answer });
    audit("transfer", "review", "İnsan incelemesi taslağı hazırlandı", { reference: review.reference, status: review.status, operation: operation, summaryText: review.summaryText, source: "scam-shield" });
    notify();
    return { ok: true, review: clone(review), protection: clone(state.protection) };
  }
  // Ek bağlam akışı · temsilci özeti. Banka kaydı (işlem, doğrulanmış durum, gerekçeler, müşterinin cevapları) kilitli; müşterinin notu ayrı alan.
  // Özetin hazırlanması, taslağın kaydedilmesi ve iletim ayrı durumlardır: bu demoda iletim yok (transmitted: false), "iletildi" denmez.
  function contextStatus(sh) {
    var o = shieldOutcome(sh), lock = state.protection.newPayeeLocked && state.protection.shieldId === sh.id ? " Yeni alıcı koruması müşterinin seçimiyle açıldı (" + state.protection.reference + ")." : "";
    if (sh.status === "cancelled") return "İptal edildi. Gönderilmedi, para hesapta. Yalnız bu transfer iptal edildi." + (o === "verify" || o === "hold" ? " İptalden önce doğrulama gerekiyordu." : o === "stop" ? " İptalden önce işlem durdurulmuştu." : "") + lock;
    return { ask: "Gönderilmedi. Ek bilgi bekleniyor.", approve: "Gönderilmedi. Müşteri onayı bekleniyor.", verify: "Gönderilmedi. Doğrulama gerekiyor, uygulamadan gönderilemez.",
      stop: "Gönderilmedi. Cevapların bir yönlendirmeye işaret ediyor, transfer durduruldu.", hold: "Gönderilmedi. Bu alıcıya transfer doğrulama bekliyor." }[o] + lock;
  }
  function contextReview(sh, note, reference) {
    var labels = (sh.risk.signals || []).filter(function (x) { return x.active; }).map(function (x) { return x.label; });
    var answers = ["directed", "secrecy", "feeling"].filter(function (q) { return sh.answers[q]; }).map(function (q) { return CONTEXT_QUESTIONS[q] + " " + ANSWER_WORD[sh.answers[q]]; });
    var operation = A.money(sh.amount) + " transfer talebi · " + sh.payee + " (" + sh.recipientIban + ")", status = contextStatus(sh);
    var uncertainty = "Gerekçeler\n• " + labels.join("\n• ") + (answers.length ? "\nMüşterinin cevapları\n• " + answers.join("\n• ") : "\nMüşterinin cevapları\n• Yanıtlanmadı");
    note = typeof note === "string" ? note.trim().slice(0, 600) : "";
    var review = buildHumanReviewSummary("transfer", state, { reference: reference, question: note, operation: operation, amount: sh.amount, operationRef: sh.id, verifiedStatus: status, uncertainty: uncertainty,
      summaryText: "İlgili işlem: " + operation + ". " + status + " Gerekçeler: " + labels.join(", ") + ". Cevaplar: " + (answers.join(" · ") || "yanıtlanmadı") + "." + (note ? " Müşteri notu: " + note : "") });
    review.operationId = null; review.operationKind = "payee-transfer"; review.payee = sh.payee; review.verified = false;
    review.reconcile = { inProgress: false, performed: false, lastApplied: null };
    review.flow = "context"; review.lockedFields = ["operation", "verifiedStatus", "uncertainty"]; review.transmitted = false;
    review.answers = clone(sh.answers); review.reasons = sh.signals.slice(); review.recipientIban = sh.recipientIban; review.shieldState = sh.status === "cancelled" ? "cancelled" : shieldOutcome(sh);
    return review;
  }
  // Hazırlanmış özetin banka kaydı alanları her bildirimde kalkan ve koruma kaydından yeniden kurulur (cevap, iptal, koruma açma/kaldırma).
  // Elle yenileme çağrısı gerekmez; müşterinin notu, referans ve "düzenlendi" bilgisi korunur.
  function syncContextReview() {
    var sh = state.shield, t = state.tasks && state.tasks.transfer, hr = t && t.humanReview;
    if (!sh || sh.flow !== "context" || !hr || hr.flow !== "context" || hr.operationRef !== sh.id) return;
    var next = contextReview(sh, hr.question, hr.reference);
    if (next.summaryText === hr.summaryText && next.verifiedStatus === hr.verifiedStatus && next.uncertainty === hr.uncertainty && next.shieldState === hr.shieldState) return;
    next.editedByUser = !!hr.editedByUser; t.humanReview = next;
  }
  function contextShield() {
    var sh = state.shield;
    return sh && sh.flow === "context" && (activeShield() === sh || sh.status === "cancelled") ? sh : null;
  }
  function refundSource(reference) {
    if (typeof reference !== "string" || !reference) return null;
    var tx = state.bank.transactions.find(function (item) { return item.ref === reference || item.id === reference; });
    var postings = tx && tx.postings || [];
    var cash = postings.find(function (item) { return item.account === "cash"; });
    // Yalnız kesinleşmiş nakit gideri iade edilir; transfer, yatırım ve gelir kaydı harcama değildir.
    if (!tx || tx.status !== "settled" || !["settled-expense", "new-expense"].includes(tx.kind) ||
      ["salary", "refund", "transfer", "p2p", "income", "deposit"].includes(tx.category) ||
      postings.length !== 1 || !cash || !Number.isSafeInteger(cash.amount) || cash.amount >= 0) return null;
    return { tx: tx, reference: tx.ref || tx.id, amount: -cash.amount };
  }
  function refundReceived(reference) {
    return state.bank.transactions.reduce(function (total, tx) {
      if (tx.status !== "settled" || !(tx.kind === "refund" || tx.category === "refund") ||
        !(tx.relatedRef === reference || tx.originalRef === reference)) return total;
      return total + (tx.postings || []).reduce(function (sum, posting) {
        return sum + (posting.account === "cash" && posting.amount > 0 ? posting.amount : 0);
      }, 0);
    }, 0);
  }
  function receiveRefund(c, completeRemaining) {
    var source = refundSource(c.originalRef);
    if (!source) return invalid("Yalnızca kesinleşmiş vadesiz harcama kaydı için iade alınabilir.");
    var occurrence = c.sourceOccurrenceId !== undefined ? c.sourceOccurrenceId : c.occurrenceId;
    if (occurrence !== undefined && (typeof occurrence !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(occurrence))) {
      return invalid("Geçerli bir iade olay kimliği gerekli.");
    }
    var mode = completeRemaining && c.amount === undefined ? "remaining" : "fixed";
    var requested = mode === "fixed" ? c.amount : null;
    if (mode === "fixed" && (!Number.isSafeInteger(requested) || requested <= 0)) return invalid("Geçerli bir iade tutarı girin.");
    var previous = occurrence !== undefined && Object.prototype.hasOwnProperty.call(state.bank.occurrences, occurrence)
      ? state.bank.occurrences[occurrence] : null;
    // Retry önce özgün niyetle karşılaştırılır; tam iade sonrası kalan tutar artık sıfır olabilir.
    if (previous) {
      if (previous.event === "refund" && previous.originalRef === source.reference &&
        previous.amountMode === mode && previous.requestedAmount === requested) {
        return { ok: true, duplicate: true, occurrenceId: occurrence };
      }
      return invalid("Aynı olay kimliği farklı içerikle tekrar işlenemez.");
    }
    var remaining = source.amount - refundReceived(source.reference);
    var refundAmt = mode === "remaining" ? remaining : requested;
    if (!Number.isSafeInteger(refundAmt) || refundAmt <= 0) return invalid("Bu harcamanın iadesi tamamlandı. Yeni iade kaydı oluşturulmadı.");
    if (refundAmt > remaining) return invalid("Toplam iade özgün harcama tutarını aşamaz.");
    if (occurrence !== undefined) state.bank.occurrences[occurrence] = {
      event: "refund", originalRef: source.reference, amount: refundAmt,
      amountMode: mode, requestedAmount: requested, at: state.now
    };
    var refundTx = {
      id: id("refund"), ref: id("REF-RF"), relatedRef: source.reference, originalRef: source.reference,
      sourceOccurrenceId: occurrence || null, kind: "refund", category: "refund",
      label: "İade · " + (source.tx.merchant || source.tx.label), merchant: source.tx.merchant || "",
      at: new Date(state.now).toISOString(), amount: refundAmt, status: "settled",
      postings: [{ account: "cash", amount: refundAmt }]
    };
    state.bank.transactions.push(refundTx);
    var tracker = state.bank.refundTrackers[source.reference];
    if (tracker && tracker.enabled) {
      var status = A.getRefundTrackerStatus(tracker, state.bank.transactions);
      state.bank.notifications.push({
        id: id("notice"), type: "refund-received", originalRef: source.reference,
        amount: refundAmt, label: source.tx.merchant || source.tx.label,
        statusText: status.statusText, at: state.now, delivery: "in-demo"
      });
      audit(null, "notification", "İade bildirimi hazırlandı", { originalRef: source.reference, amount: refundAmt, statusText: status.statusText, delivery: "in-demo" });
    }
    audit(null, "event", "İade kesinleşti", { originalRef: source.reference, amount: refundAmt, occurrenceId: occurrence });
    state.dataVersion++;
    return replan("İade hesaba geçti: " + A.money(refundAmt), true);
  }
  async function dispatch(c) {
    if (!c || typeof c.type !== "string") return invalid("Geçersiz komut.");
    var t = state.tasks[c.taskId], p = state.plans[c.taskId];
    if (c.type === "prepare-mandate") return invalid("Ödeme talimatı değiştirilmez. Ücret artışı takibi ve ödeme listesi sunulur.");
    if (c.type === "set-price-alert") {
      if (typeof c.enabled !== "boolean") return invalid("Haber alma tercihi açık veya kapalı olmalı.");
      if (state.bank.priceAlerts.enabled === c.enabled) return { ok: true, unchanged: true };
      var reference = id("ALERT");
      state.bank.priceAlerts = { enabled: c.enabled, version: state.bank.priceAlerts.version + 1, reference: reference };
      audit("subscription", "action", "Ücret artışı tercihi kaydedildi", { kind: "price-alert", enabled: c.enabled, reference: reference, bankMandateUnchanged: true });
      var preference = readTool("readPriceAlertPreferences", "subscription");
      var verified = preference.enabled === c.enabled && preference.reference === reference;
      audit("subscription", "verified", "Haber alma tercihi doğrulandı", { kind: "price-alert", enabled: preference.enabled, reference: reference, reason: "Yerel tercih kaydı okundu. Ödeme talimatı ve bakiyeler değişmedi." });
      notify(); return { ok: verified, reference: reference };
    }
    if (c.type === "read-automatic-payments") {
      var orders = readTool("readAutomaticPayments", "subscription");
      notify(); return { ok: true, count: orders.length };
    }
    if (c.type === "prepare-saved-transfer") {
      // İkinci bir transfer motoru yok: seçim yalnızca onaya açık plan üretir; gönderim execute() hattındadır.
      var saved = state.bank.savedTransfers.find(function (x) { return x.id === c.savedId; });
      if (!saved) return invalid("Kayıtlı işlem bulunamadı.");
      if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
      var prepared = makePlan("transfer", "saved-transfer", saved.amount, "Kayıtlı işlem seçildi", { savedId: saved.id, payeeLabel: saved.label + " (" + saved.payee + ")", recipientIban: saved.ibanMask });
      audit("transfer", "goal", "Kayıtlı işlem seçildi · para hareketi yok", { savedId: saved.id, amount: saved.amount, planId: prepared.id });
      notify();
      return { ok: true, planId: prepared.id, version: prepared.version, status: prepared.status };
    }
    if (c.type === "prepare-payee-transfer") return preparePayeeTransfer(c);
    if (c.type === "redeem-savings") {
      if (!Number.isSafeInteger(c.amount) || c.amount <= 0) return invalid("Pozitif ve geçerli tutar gir.");
      if (c.amount > balance("savings")) return invalid("Birikim bakiyesi bu tutar için yetersiz.");
      if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
      if (!fundWindow().open) return invalid(fundClosedReason());
      var redeemPlan = makePlan("fund", "redeem", c.amount, "Kullanıcı birikimini bozdurdu");
      return execute(redeemPlan, true);
    }
    if (c.type === "card-autopay") {
      // Talimat tercihi: para hareket etmez, bu demoda ödeme gününe kadar zaman ilerlemez.
      if (typeof c.enabled !== "boolean") return invalid("Talimat açık ya da kapalı olmalı.");
      state.bank.cardAutopay = c.enabled;
      audit("card", "action", c.enabled ? "Kart borcu otomatik ödeme talimatı açıldı" : "Kart borcu otomatik ödeme talimatı kapatıldı", { mode: "full", moneyMoved: false });
      notify(); return { ok: true, enabled: c.enabled };
    }
    if (c.type === "card-pay") {
      var cps = openStatement();
      if (!cps) return invalid("Ödenecek kart borcu bulunmuyor.");
      if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
      var cprev = previewCardPayment(c.amount);
      if (!cprev.valid) return invalid(cprev.reason);
      if (cprev.topUp > 0 && !fundWindow().open) return invalid(fundClosedReason());
      var cardPlan = makePlan("card", "card-pay", c.amount, "Kart ekstresi ödemesi", { statementId: cps.id, topUp: cprev.topUp });
      audit("card", "goal", "Kullanıcı ekstre ödeme tutarını seçti", { amount: c.amount, outstanding: cps.total - cps.paid, minimumLeft: Math.max(0, cps.minimum - cps.paid), topUp: cprev.topUp, interestAvoided: statementCost(cps.total - cps.paid) - cprev.cost, planId: cardPlan.id });
      return execute(cardPlan, true);
    }
    if (c.type === "deposit-savings") {
      if (!Number.isSafeInteger(c.amount) || c.amount <= 0) return invalid("Pozitif ve geçerli tutar gir.");
      if (c.amount > balance("cash")) return invalid("Vadesiz hesap bakiyesi bu tutar için yetersiz.");
      if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
      if (!fundWindow().open) return invalid(fundClosedReason());
      var depositPlan = makePlan("fund", "save", c.amount, "Kullanıcı fona nakit aktardı");
      return execute(depositPlan, true);
    }
    if (c.type === "discard-transfer-plan") {
      var tp = state.plans.transfer;
      if (!tp || tp.status !== "awaiting") return { ok: true, unchanged: true };
      tp.status = "cancelled"; state.tasks.transfer.status = "monitoring";
      if (state.shield && state.shield.planId === tp.id && state.shield.status === "active") state.shield.status = "dismissed";
      audit("transfer", "control", "Transfer taslağından vazgeçildi", { planId: tp.id, moneyMoved: false });
      notify(); return { ok: true };
    }
    if (c.type === "shield-answer") {
      var shield = activeShield();
      if (!shield) return invalid("Etkin güvenlik kalkanı bulunmuyor.");
      if (shield.flow === "context") {
        var qn = c.question || nextQuestion(shield.answers), was = shieldOutcome(shield);
        if (typeof qn !== "string" || !own.call(CONTEXT_QUESTIONS, qn)) return invalid("Soru bulunamadı.");
        if (typeof c.answer !== "string" || !own.call(ANSWER_WORD, c.answer)) return invalid("Yanıt evet, hayır veya emin değilim olmalı.");
        if (shield.hold) return invalid(holdDenial(shield));
        // Cevaplar kilitlidir: aynı cevaba yinelenen dokunuş kayıt üretmez, farklı cevap kararı geri almaz.
        if (shield.answers[qn]) return shield.answers[qn] === c.answer ? { ok: true, unchanged: true, outcome: was } : invalid("Bu soru yanıtlandı. Yanıt değiştirilemez. Gerekirse bu transferi iptal et.");
        if (qn === "secrecy" && shield.answers.directed !== "yes") return invalid("Bu soru yalnız telefon görüşmesi varsa sorulur.");
        if (qn === "feeling" && (shieldOutcome(shield) !== "ask" || nextQuestion(shield.answers) !== "feeling")) return invalid("Bu soru şu an sorulmuyor.");
        shield.answers[qn] = c.answer;
        var ansOutcome = shieldOutcome(shield);
        // "Evet" (biri yönlendiriyor) her durumda doğrulamaya ya da durdurmaya gider. Karar ikinci cevabı beklemeden alıcıya bağlanır:
        // iptal, yeni taslak veya sonradan verilen "Hayır" onu kaldırmaz (5 Kasım kod incelemesi). Gizlilik "Evet" ise karar durdurmaya yükselir.
        var holdAs = ansOutcome === "stop" ? "stop" : ansOutcome === "verify" || shield.answers.directed === "yes" || shield.answers.directed === "unsure" ? "verify" : null;
        if (holdAs) {
          var mine = state.reviewHolds.find(function (h) { return h.shieldId === shield.id; });
          if (mine) { if (holdAs === "stop") mine.outcome = "stop"; }
          else if (!holdFor(shield.recipientIban, shield.recipientKey)) state.reviewHolds.push({ ibanMask: shield.recipientIban, ibanKey: shield.recipientKey || null, shieldId: shield.id, outcome: holdAs, directed: shield.answers.directed === "yes", at: state.now });
        }
        audit("transfer", "shield", "Ek bilgi sorusu yanıtlandı", { planId: shield.planId, question: qn, answer: c.answer, source: "customer", outcome: ansOutcome, moneyMoved: false });
        notify(); return { ok: true, answer: c.answer, outcome: ansOutcome };
      }
      if (!["yes", "no"].includes(c.answer)) return invalid("Yanıt evet veya hayır olmalı.");
      shield.answer = c.answer;
      audit("transfer", "shield", "Güvenlik sorusu yanıtlandı", { planId: shield.planId, answer: c.answer, coercionSignal: c.answer === "yes" });
      notify(); return { ok: true, answer: c.answer };
    }
    if (c.type === "shield-cancel") {
      // Yalnız bu, henüz gönderilmemiş transfer taslağı. Diğer transferler ve yeni alıcılar kilitlenmez; para hareketi yok.
      var csh = state.shield;
      if (csh && csh.flow === "context" && csh.status === "cancelled") return { ok: true, unchanged: true };
      var act = activeShield();
      if (!act || act.flow !== "context") return invalid("İptal edilecek, gönderilmemiş bir transfer bulunmuyor.");
      var cp = state.plans.transfer, ct = state.tasks.transfer;
      cp.status = "cancelled"; ct.status = "monitoring"; ct.reason = "Gönderilmemiş transfer kullanıcı tarafından iptal edildi.";
      act.status = "cancelled"; act.cancelledAt = state.now;
      audit("transfer", "control", "Gönderilmemiş transfer iptal edildi", { planId: cp.id, shieldId: act.id, outcome: shieldOutcome(act), scope: "this-transfer", moneyMoved: false, newPayeesLocked: !!state.protection.newPayeeLocked });
      notify(); return { ok: true, cancelled: true };
    }
    if (c.type === "shield-protect") {
      // İsteğe bağlı, ayrı ve açık seçim: yeni alıcılara gönderimleri de korumaya al. Kayıtlı alıcılar açık; kaldırma kuralı mevcut korumayla aynı.
      if (state.protection.newPayeeLocked) return { ok: true, unchanged: true, protection: clone(state.protection) };
      var psh = contextShield();
      if (!psh) return invalid("Koruma bu ekrandan yalnız şüpheli transfer kartında açılır.");
      lockNewPayees(psh, psh.recipientIban, { optIn: true });
      audit("transfer", "shield", "Yeni alıcı koruması müşterinin seçimiyle açıldı", { reference: state.protection.reference, shieldId: psh.id, source: "customer-choice", scope: "new-payees", moneyMoved: false });
      notify(); return { ok: true, protection: clone(state.protection) };
    }
    if (c.type === "shield-summary") {
      var ssh = contextShield();
      if (!ssh) return invalid("Özet için bekleyen veya iptal edilen bir şüpheli transfer bulunmuyor.");
      var srt = state.tasks.transfer, prev = srt.humanReview && srt.humanReview.operationRef === ssh.id ? srt.humanReview : null;
      if (prev) return { ok: true, unchanged: true, review: clone(prev) };
      // Her kalkan olayı kendi referansını alır; önceki özetin referansı yeni olaya taşınmaz.
      srt.humanReview = contextReview(ssh, "", ssh.reviewReference || id("REVIEW")); ssh.reviewReference = srt.humanReview.reference;
      audit("transfer", "review", "Temsilci özeti hazırlandı, iletilmedi", { reference: srt.humanReview.reference, status: "draft", transmitted: false, operation: srt.humanReview.operation, verifiedStatus: srt.humanReview.verifiedStatus, source: "scam-shield" });
      notify(); return { ok: true, review: clone(srt.humanReview) };
    }
    if (c.type === "shield-cooldown") {
      var cooling = activeShield();
      if (!cooling) return invalid("Etkin güvenlik kalkanı bulunmuyor.");
      if (cooling.flow === "context") return invalid("Bu akışta bekleme süresi yok. Karar soruların cevabına ve banka kuralına bağlı.");
      if (cooling.coolingUntil) return { ok: true, unchanged: true, coolingUntil: cooling.coolingUntil };
      cooling.coolingUntil = state.now + A.RULES.scamShield.coolingMs;
      audit("transfer", "shield", "15 dakikalık güvenlik beklemesi başladı", { planId: cooling.planId, coolingUntil: new Date(cooling.coolingUntil).toISOString(), moneyMoved: false });
      notify(); return { ok: true, coolingUntil: cooling.coolingUntil };
    }
    if (c.type === "shield-stop") return stopShield();
    if (c.type === "shield-release") {
      if (!state.protection.newPayeeLocked) return { ok: true, unchanged: true };
      // by:"representative" istemciden gelen bir alandır; gerçek kimlik/yetki doğrulaması değildir (yalnız moderatör canlandırması, PROJECT.md "Güvenlik sınırı").
      var byRep = c.by === "representative", rel = protectionRelease();
      if (!byRep && rel.callActive) return invalid("Görüşme sürerken korumayı yalnız müşteri temsilcisi kaldırabilir.");
      if (!byRep && !rel.allowed) return invalid("Koruma, görüşme bittikten 15 dakika sonra kaldırılabilir. Daha önce gerekiyorsa müşteri temsilcisi kaldırabilir.");
      var released = state.protection.reference;
      state.protection = { newPayeeLocked: false, reference: null, releasedAt: state.now, previousReference: released, releasedBy: byRep ? "representative" : "user" };
      audit("transfer", "shield", byRep ? "Yeni alıcı koruması müşteri temsilcisi tarafından kaldırıldı" : "Yeni alıcı koruması kullanıcı tarafından kaldırıldı", { reference: released });
      notify(); return { ok: true, released: released };
    }
    if (c.type === "liquidity-decision") {
      if (!["open-banking", "safe-pay"].includes(c.decision)) return invalid("Seçenek diğer bankadan çek veya güvenli paydan dengele olmalı.");
      if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
      var cf = simulateCashFlow30Days();
      if (cf.deficit <= 0) return invalid("Önümüzdeki günlerde dengelenecek bir kırılganlık görünmüyor.");
      audit("liquidity", "goal", "Kullanıcı kırılganlık çözümünü seçti", { decision: c.decision, deficit: cf.deficit, day: cf.minDay });
      if (c.decision === "open-banking") {
        var src = linkedSource(cf.deficit);
        if (!src) return invalid("Bağlı hesapta açık bankacılık izni veya yeterli bakiye yok.");
        var obPlan = makePlan("liquidity", "ob-pull", cf.deficit, "Açık bankacılık likidite taslağı", { linkedAccountId: src.id, fragileDay: cf.minDay, payeeLabel: src.label });
        return execute(obPlan, true);
      }
      // H-01: ayrılacak öneri açığı kapatmıyorsa "dengele" etkisizdir; kullanıcıya sahte çözüm sunulmaz.
      if (cf.assumedSaving < cf.deficit) return invalid("Ayrılacak birikim önerisi kalmadı. Birikimden aktar veya diğer bankadan çek.");
      // Para hareketi yok: güvenli paydan kırılgan gün için pay ayrılır, birikim önerisi yeniden hesaplanır.
      state.bank.liquidityReserve = { amount: cf.deficit, until: cf.minDay, source: "safe-pay", operationId: null, reference: id("LIQ"), at: state.now };
      state.dataVersion++;
      audit("liquidity", "action", "Güvenli paydan kırılganlık payı ayrıldı", { kind: "liquidity-reserve", amount: cf.deficit, until: cf.minDay, moneyMoved: false });
      var check = forecast();
      audit("liquidity", "verified", "Kırılganlık payı doğrulandı", { kind: "liquidity-reserve", reference: state.bank.liquidityReserve.reference, reason: "Gider tahmininde ayrılan pay okundu. Bakiyeler değişmedi." });
      await replan("Kırılgan gün için güvenli paydan pay ayrıldı", false);
      return { ok: check.liquidityReserve === cf.deficit, reserve: clone(state.bank.liquidityReserve) };
    }
    if (c.type === "expense-estimate") {
      // Aday 15: kullanıcı bir gider kaleminin kalan dönem tahminini düzeltir. Para hareket etmez; amount null düzeltmeyi kaldırır.
      var rule = A.RULES.expenseCategories.find(function (r) { return r.id === c.category; });
      if (!rule) return invalid("Bilinmeyen gider kalemi.");
      if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
      if (forecast().horizonExpired) return invalid("Bu örnek dönemi sona erdi.");
      if (c.amount !== null && (!Number.isSafeInteger(c.amount) || c.amount < 0 || c.amount > 10000000)) return invalid("Tutar 0 ile 100.000 TL arasında olmalı.");
      var overrides = state.bank.expenseOverrides, previous = Number.isSafeInteger(overrides[rule.id]) ? overrides[rule.id] : null;
      if (previous === c.amount) return { ok: true, unchanged: true, forecast: clone(forecast()) };
      if (c.amount === null) delete overrides[rule.id]; else overrides[rule.id] = c.amount;
      state.dataVersion++;
      audit("savings", "goal", c.amount === null ? "Gider kalemi düzeltmesi kaldırıldı" : "Gider kalemi tahmini düzeltildi", { category: rule.id, previous: previous, amount: c.amount, moneyMoved: false });
      await replan("Gider kalemi tahmini değişti", false);
      return { ok: true, forecast: clone(forecast()) };
    }
    if (c.type === "clear-liquidity-reserve") {
      var current = state.bank.liquidityReserve;
      if (!current) return { ok: true, unchanged: true };
      if (current.source !== "safe-pay") return invalid("Diğer bankadan gelen tutarın ayrımı kaldırılmaz. Para hesabında kalır.");
      state.bank.liquidityReserve = null; state.dataVersion++;
      audit("liquidity", "action", "Kırılganlık payı kaldırıldı", { kind: "liquidity-reserve", reference: current.reference, moneyMoved: false });
      await replan("Kırılganlık payı kaldırıldı", false);
      return { ok: true };
    }
    if (c.type === "trial-decision") {
      var trialRecord = state.bank.trials.find(function (x) { return x.id === c.trialId; });
      if (!trialRecord) return invalid("Deneme kaydı bulunamadı.");
      if (!["block", "continue"].includes(c.decision)) return invalid("Karar engelle veya devam et olmalı.");
      if (trialRecord.status !== "detected") return invalid("Bu deneme için kararın zaten kaydedildi.");
      if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
      var trialKind = c.decision === "block" ? "trial-block" : "trial-continue";
      var trialPlan = makePlan("trial", trialKind, trialKind === "trial-continue" ? trialRecord.renewalAmount : 0, "Ücretsiz deneme kararı", { trialId: trialRecord.id, merchant: trialRecord.merchant });
      audit("trial", "goal", "Kullanıcı deneme kararını seçti", { trialId: trialRecord.id, decision: c.decision, planId: trialPlan.id });
      // Düğmeye basmak bu tek kararın açık onayıdır; geri alma penceresi execute() içindedir.
      return execute(trialPlan, true);
    }
    if (c.type === "approve") {
      if (!p || (c.planId && p.id !== c.planId) || (c.version && p.version !== c.version)) return invalid("Eski plan onaylanamaz. Güncel planı incele.");
      return execute(p, true);
    }
    if (c.type === "reconcile") return reconcile(c.operationId);
    if (c.type === "cancel-transfer") return cancelTransfer(c.operationId);
    if (c.type === "share-receipt") {
      var op = c.operationId
        ? state.operations.find(function (o) { return o.id === c.operationId; })
        : state.operations.slice().reverse().find(function (o) { return o.kind === "saved-transfer" && o.status === "succeeded"; });
      if (!op || op.kind !== "saved-transfer" || op.status !== "succeeded" || !op.receipt || !op.receipt.verified) {
        return invalid("Paylaşım için doğrulanmış kayıtlı transfer bulunamadı.");
      }
      var tpl = state.bank.savedTransfers.find(function (x) { return x.id === (op.savedId || op.receipt.savedId); });
      var note = c.note !== undefined ? String(c.note).trim() : ((tpl && tpl.note) || (op.receipt && op.receipt.note) || "");
      var message = c.message || (A.money(op.amount) + " gönderdim.");
      var draft = {
        operationId: op.id,
        reference: op.receipt.reference,
        amount: op.amount,
        sender: "Deniz Yılmaz",
        payee: (tpl && tpl.payee) || (op.receipt && op.receipt.payee) || op.payeeLabel,
        recipientIban: (tpl && tpl.ibanMask) || (op.receipt && op.receipt.ibanMask) || "",
        note: note,
        message: message,
        status: "draft_prepared",
        at: state.now
      };
      op.shareDraft = draft;
      audit("transfer", "action", "Alıcıyı bilgilendir · Paylaşım taslağı hazırlandı", {
        operationId: op.id,
        reference: op.receipt.reference,
        payee: draft.payee,
        message: draft.message,
        note: draft.note,
        status: "draft_prepared"
      });
      notify();
      return { ok: true, status: "Paylaşım taslağı hazırlandı", draft: draft };
    }
    if (c.type === "check") {
      if (busy()) return invalid("Önce bekleyen işlemi doğrula.");
      if (c.taskId && !t) return invalid("Görev bulunamadı.");
      if (t) t.needsRetry = false;
      if (!c.taskId || c.taskId === "savings") { state.goals.savings.requested = true; state.goals.savings.amount = null; }
      return replan("Kullanıcı dönem kontrolü istedi", true);
    }
    if (c.type === "set-savings-amount" || c.type === "set-bes-target" || c.type === "watch-gold") {
      var target = { "set-savings-amount": "savings", "set-bes-target": "bes", "watch-gold": "gold" }[c.type];
      if (taskBusy(target)) return invalid("Önce bu görevin işlem sonucunu doğrula.");
      if (!Number.isSafeInteger(c.amount) || c.amount <= 0 || c.amount > 100000000) return invalid("Pozitif ve geçerli tutar gir.");
      if (c.type === "set-savings-amount") { state.goals.savings.amount = c.amount; state.goals.savings.requested = true; }
      if (c.type === "set-bes-target") { state.goals.bes.target = c.amount; state.goals.bes.requested = true; }
      if (c.type === "watch-gold") {
        if (!Number.isSafeInteger(c.thresholdBps) || c.thresholdBps < 1 || c.thresholdBps > 1000) return invalid("Makas koşulu %0,01–%10 arasında olmalı.");
        state.goals.gold.budget = c.amount; state.goals.gold.thresholdBps = c.thresholdBps; state.goals.gold.watching = true;
      }
      state.tasks[target].needsRetry = false;
      audit(target, "goal", "Kullanıcı hedefi güncellendi", { command: c.type, amount: c.amount, thresholdBps: c.thresholdBps, intent: c.intent });
      return replan("Kullanıcı hedefi değişti", false);
    }
    if (c.type === "permissions") {
      var changes = c.changes || {}, allowed = ["autoSave", "perAction", "monthlyLimit", "buffer"];
      if (!Object.keys(changes).length || Object.keys(changes).some(function (k) { return !allowed.includes(k); })) return invalid("İzin alanı geçersiz.");
      if (Object.keys(changes).some(function (k) { return k === "autoSave" ? typeof changes[k] !== "boolean" : (!Number.isSafeInteger(changes[k]) || changes[k] < (k === "buffer" ? 0 : 1) || changes[k] > 100000000); })) return invalid("İzin tutarları geçersiz.");
      Object.assign(state.permissions, changes); state.permissionVersion++;
      if (changes.buffer !== undefined) state.permissions.bufferAuto = false;
      audit("savings", "permission", "Kullanıcı izinleri değiştirdi", clone(state.permissions));
      return replan("İzin sürümü değişti · otomatik işlem başlatılmadı", false);
    }
    // SA-05: durum yalnız seçilen ürünü tutar (fundCode); "faiz istemiyor" gibi bir özellik adı saklanmaz.
    if (c.type === "set-fund-product") {
      if (!["ALE", "AIS"].includes(c.code)) return invalid("Fon ALE veya AIS olmalı.");
      if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
      if (state.preferences.fundCode === c.code) return { ok: true, unchanged: true };
      // 18 Ekim: fon değişimi gerçekte iki işlemdir: eski fon satılır, yeni fon alınır. Kullanıcı tek onay verir, iki işlem de deftere yazılır.
      // AIS alım ve satımı yalnız iş günlerinde kesim saatine kadar; iki fondan biri kapalıysa değişim yapılmaz (para vadesizde beklemez).
      var held = balance("savings"), from = fundProduct(), to = productFor(c.code), fromW = fundWindow(from), toW = fundWindow(to);
      if (held > 0 && (!fromW.open || !toW.open)) return invalid("Fon değişimi şu an yapılamaz. " + fundClosedReason(fromW.open ? toW : fromW));
      state.preferences.fundCode = c.code; state.dataVersion++;
      if (held > 0) {
        var swAt = new Date(state.now).toISOString(), swRef = id("REF-SW");
        state.bank.transactions.push({ id: id("switch"), ref: swRef, kind: "fund-switch", category: "fund-switch", at: swAt, amount: held,
          label: from.code + " satışı · fon değişimi", status: "settled", postings: [{ account: "savings", amount: -held }, { account: "cash", amount: held }] });
        state.bank.transactions.push({ id: id("switch"), ref: swRef, kind: "fund-switch", category: "fund-switch", at: swAt, amount: held,
          label: to.code + " alımı · fon değişimi", status: "settled", postings: [{ account: "cash", amount: -held }, { account: "savings", amount: held }] });
        audit("fund", "action", "Fon değişimi: " + from.code + " satıldı, " + to.code + " alındı", { sold: from.code, bought: to.code, amount: held, reference: swRef, moneyMoved: true });
      }
      // Fonun nakde çevrilebilirliği güvenlik payının varsayılanını belirler (kullanıcı payı elle ayarladıysa dokunulmaz). Profil çıkarımı değildir.
      if (state.permissions.bufferAuto) { state.permissions.buffer = forecast().bufferFor[c.code]; state.permissionVersion++; }
      // Kayıt yalnız işlem için gerekeni tutar: ürün kodu, kullanıcının kendi seçimi olduğu ve kullanım amacı.
      // Seçimden inanç/kişilik çıkarımı yapılmaz ve etiket üretilmez. Gerçek bir kişiyle ilişkilendirilirse bu tercih kişisel veri olabilir;
      // canlı sınıflandırma ve saklama kararı bankanın KVKK değerlendirmesine aittir (MEVZUAT_VE_FRAUD_ON_UYUM_DENETIMI_2026-10-24.md).
      audit("fund", "preference", "Kullanıcı fon seçimini değiştirdi: " + c.code,
        { product: c.code, source: "user-choice", inferred: false, usage: "fund-execution-and-liquidity-buffer" });
      return replan("Fon seçimi değişti", false);
    }
    // 26 Ekim: kullanıcı bir yatırımı güvenlik hesabına katar ya da çıkarır. Para hareketi ve satış talimatı yoktur; yalnız pay ve öneri yeniden hesaplanır.
    if (c.type === "set-holding-use") {
      var holding = (state.bank.holdings || []).find(function (h) { return h.id === c.id; });
      if (!holding) return invalid("Yatırım bulunamadı.");
      if (typeof c.use !== "boolean") return invalid("Tercih açık ya da kapalı olmalı.");
      if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
      if (holding.useForSafety === c.use) return { ok: true, unchanged: true };
      holding.useForSafety = c.use; state.dataVersion++;
      audit("savings", "preference", holding.id + (c.use ? " acil durumda kullanılabilir" : " acil durum hesabından çıkarıldı"),
        { holding: holding.id, useForSafety: c.use, moneyMoved: false, saleOrder: false, source: "user-choice" });
      return replan("Acil durumda kullanılabilecek yatırımlar değişti", false);
    }
    if (c.type === "revoke") {
      state.permissions.autoSave = false; state.permissionVersion++;
      audit("savings", "permission", "Ön yetki geri çekildi", { autoSave: false });
      return replan("Ön yetki geri çekildi", false);
    }
    if (["pause", "resume", "cancel-plan"].includes(c.type)) {
      if (!t) return invalid("Görev bulunamadı.");
      if (c.type === "cancel-plan" && taskBusy(c.taskId)) return invalid(taskBusy(c.taskId).status === "pending" ? "Bekleyen transfer için Geri al seçeneğini kullan." : "Gönderilmiş işlem taslak gibi iptal edilemez. Önce sonucu sorgula.");
      t.paused = c.type !== "resume"; t.needsRetry = false; t.status = t.paused ? "paused" : "monitoring";
      state.permissionVersion++;
      var active = taskBusy(c.taskId);
      audit(c.taskId, "control", t.paused ? "Görev duraklatıldı" : "Görev yeniden etkinleştirildi", { bankMandateUnchanged: true, submittedOperation: !!active && active.status !== "pending", pendingTransfer: !!active && active.status === "pending" });
      return replan("Görev kontrolü değişti", false);
    }
    if (c.type === "human-review") {
      var tId = c.taskId || (t ? c.taskId : "savings");
      var targetTask = state.tasks[tId];
      if (!targetTask) return invalid("Görev bulunamadı.");
      // 18 Ekim (katılımcı): kalkan özetinde işlem, doğrulanmış durum ve güvenlik işaretleri banka kaydıdır; kullanıcı yalnız kendi notunu değiştirir.
      // İstemci bu alanları gönderse bile kayıttaki değerler kullanılır ve özet metni yeniden kurulur.
      var locked = tId === "transfer" && state.shield && c.operationRef === state.shield.id && targetTask.humanReview && targetTask.humanReview.operationRef === state.shield.id ? targetTask.humanReview : null;
      if (locked && locked.flow === "context") {
        // Müşteri yalnız kendi notunu değiştirir; banka kaydı alanları kalkan kaydından yeniden kurulur, istemcinin gönderdiği değerler kullanılmaz.
        var cr = contextReview(state.shield, typeof c.question === "string" ? c.question : locked.question, locked.reference); cr.editedByUser = true;
        targetTask.humanReview = cr;
        audit(tId, "review", "Temsilci özeti taslağı müşterinin notuyla kaydedildi, iletilmedi", { reference: cr.reference, status: cr.status, transmitted: false, noteChars: cr.question.length, summaryText: cr.summaryText, editedByUser: true });
        notify(); return { ok: true, reason: "Özet taslağı kaydedildi.", review: cr };
      }
      if (locked) {
        var note = typeof c.question === "string" && c.question.trim() ? c.question.trim() : locked.question;
        c = Object.assign({}, c, { question: note, operation: locked.operation, verifiedStatus: locked.verifiedStatus, uncertainty: locked.uncertainty, amount: locked.amount,
          summaryText: "İlgili işlem: " + locked.operation + ". " + locked.verifiedStatus + " " + locked.uncertainty + " " + note });
      }
      var summary = buildHumanReviewSummary(tId, state, c);
      if (locked) summary.lockedFields = ["operation", "verifiedStatus", "uncertainty"];
      if (tId === "transfer" && state.shield && c.operationRef === state.shield.id) {
        // Kalkan özeti düzenlemesi kalkan olayına bağlı kalır; önceki transfer işlemine bağlanmaz.
        summary.operationId = null; summary.operationKind = "payee-transfer"; summary.verified = false;
        summary.reconcile = { inProgress: false, performed: false, lastApplied: null };
      }
      targetTask.humanReview = summary;
      audit(tId, "review", "İnsan incelemesi taslağı hazırlandı", {
        reference: summary.reference,
        status: summary.status,
        question: summary.question,
        operation: summary.operation,
        amount: summary.amount,
        operationRef: summary.operationRef,
        verifiedStatus: summary.verifiedStatus,
        uncertainty: summary.uncertainty,
        summaryText: summary.summaryText,
        editedByUser: summary.editedByUser
      });
      notify();
      return { ok: true, reason: "İnceleme taslağı hazırlandı.", review: summary };
    }
    if (c.type === "clear-human-review") {
      var targetTask = state.tasks[c.taskId];
      if (targetTask) targetTask.humanReview = null;
      notify();
      return { ok: true };
    }
    if (c.type === "tool-mode") {
      if (!["success", "fail", "timeout-before", "timeout-after"].includes(c.mode)) return invalid("Geçersiz araç modu.");
      state.nextToolMode = c.mode; notify(); return { ok: true };
    }
    if (c.type === "acknowledge-result") {
      var targetOp = state.operations.find(function (op) { return op.id === c.operationId; });
      if (targetOp) targetOp.acknowledged = true;
      notify();
      return { ok: true, acknowledged: true };
    }
    if (c.type === "mark-summary-shown") {
      state.presentationState.shownSummaryId = c.summaryId;
      return { ok: true, shownSummaryId: c.summaryId };
    }
    if (c.type === "dismiss-summary") {
      state.presentationState.dismissed[c.summaryId] = true;
      notify();
      return { ok: true, dismissed: true };
    }
    if (c.type === "set-refund-tracker") {
      var origRef = c.originalRef || c.txId;
      if (!origRef) return invalid("İşlem referansı gerekli.");
      var source = refundSource(origRef);
      if (!source) return invalid("Yalnızca vadesiz hesaptan yapılan harcamalar için iade takibi açılabilir.");
      var targetTx = source.tx;
      var expAmt = c.expectedAmount !== undefined ? c.expectedAmount : source.amount;
      if (!Number.isSafeInteger(expAmt) || expAmt <= 0) return invalid("Geçerli bir beklenen iade tutarı girin.");
      if (expAmt > source.amount) return invalid("Beklenen iade özgün harcama tutarını aşamaz.");
      var refKey = source.reference;
      state.bank.refundTrackers[refKey] = {
        originalRef: refKey,
        txId: targetTx.id,
        label: targetTx.label,
        merchant: targetTx.merchant || "",
        account: "cash",
        expectedAmount: expAmt,
        enabled: true,
        createdAt: state.now
      };
      audit(null, "refund-tracker", "İade takibi başlatıldı", { originalRef: refKey, expectedAmount: expAmt, account: "cash" });
      state.dataVersion++;
      notify();
      return { ok: true, tracker: clone(state.bank.refundTrackers[refKey]) };
    }
    if (c.type === "close-refund-tracker") {
      var origRef = c.originalRef || c.txId;
      var originalTx = state.bank.transactions.find(function (tx) { return tx.ref === origRef || tx.id === origRef; });
      var canonicalRef = originalTx ? (originalTx.ref || originalTx.id) : origRef;
      var trk = state.bank.refundTrackers[canonicalRef];
      if (!trk || !trk.enabled) return { ok: true, closed: false };
      trk.enabled = false;
      audit(null, "refund-tracker", "İade takibi kapatıldı", { originalRef: trk.originalRef, merchantRefundCancelled: false, note: "Takip kapatıldı. Satıcıdaki iade süreci veya yasal haklar etkilenmez." });
      state.dataVersion++;
      notify();
      return { ok: true, closed: true, message: "İade takibi kapatıldı. Bu işlem satıcıdaki iade sürecini veya yasal haklarını etkilemez." };
    }
    if (c.type === "receive-refund") return receiveRefund(c, false);
    if (c.type === "event") {
      if (!A.EVENTS.some(function (e) { return e.id === c.event; })) return invalid("Olay bulunamadı.");
      if (c.event === "scam-call") return scamScenario();
      if (c.event === "scam-setup") {
        if (busy()) return invalid("Önce devam eden veya belirsiz işlemin sonucu doğrulanmalı.");
        scamSetup("scam-setup", c.device === "other"); await replan("Senaryo olayı: scam-setup", false); notify();
        // Hazır senaryoyla aynı sınır: form, vadesizde ayrılmamış paradan fazlasıyla dolmaz.
        var scam = clone(state.bank.scamScenario); scam.amount = Math.min(scam.amount, balance("cash") - reserved());
        return { ok: true, scam: scam };
      }
      if (c.event === "call-start" || c.event === "call-end") {
        // Cihaz sinyali yalnız risk puanını etkiler; plan/veri sürümü değişmez.
        // Telefonda arayan "112" görünür (dolandırıcı taklidi); motor yalnız görüşmenin sürüp sürmediğini alır, numarayı almaz.
        state.device.call = c.event === "call-start" ? { active: true, startedAt: state.now, txMark: state.bank.transactions.length, source: "demo-signal" } : { active: false, endedAt: state.now };
        audit(null, "event", c.event === "call-start" ? "Aktif görüşme sinyali" : "Görüşme sinyali bitti", { callActive: c.event === "call-start", source: "demo-signal" });
        notify(); return { ok: true, call: clone(state.device.call) };
      }
      if (c.event === "cashflow-24") {
        if (state.bank.payments.some(function (x) { return x.id === "card-statement-oct"; })) return invalid("Bu nakit akışı senaryosu zaten eklendi.");
        // Kurgusal: iş masraflarının kart ekstresi 24 Ekim'de, onaylı şirket iadesi 25 Ekim'de. Ay sonu toplamı değişmez, zamanlama değişir.
        var statement = A.RULES.cashflow.statementAmount[state.preset === "legacy" || A.CONFIG.useLegacyStartingCash ? "legacy" : "current"];
        state.bank.payments.push({ id: "card-statement-oct", orderId: null, due: "2026-10-24", kind: "card-statement", label: "Kredi kartı ekstresi", amount: statement, status: "pending", obligation: true });
        state.bank.incoming.push({ id: "reimbursement-oct", due: "2026-10-25", label: "Şirket masraf iadesi (onaylı)", amount: statement, status: "confirmed", source: "payroll-confirmed" });
        audit(null, "event", "Yeni tarihli ödeme ve onaylı giriş eklendi", { statement: statement, statementDue: "2026-10-24", incoming: statement, incomingDue: "2026-10-25" });
      }
      if (c.event === "portfolio-need") {
        // Yalnız portföy sepeti senaryosunda; "yarın" kontrollü saate göre hesaplanır.
        var np = A.RULES.portfolio.needPayment, due = nextDayOf(day());
        if (state.preset !== "portfolio") return invalid("Bu ödeme yalnız portföy sepeti senaryosunda eklenir.");
        if (state.bank.payments.some(function (x) { return x.id === np.id; })) return invalid("Bu ödeme zaten eklendi.");
        state.bank.payments.push({ id: np.id, orderId: null, due: due, kind: "one-off", label: np.label, amount: np.amount, status: "pending", obligation: true });
        audit(null, "event", "Yeni tarihli ödeme eklendi", { label: np.label, due: due, amount: np.amount });
      }
      if (c.event === "card-statement") {
        if (state.bank.cardStatement) return invalid("Bu ekstre zaten eklendi.");
        // 5 Kasım: tutar isteğe bağlı (jüri canlı kısa 18.000 TL kullanır); verilmezse kural tutarı (36.000 TL).
        var csr = A.RULES.cardStatement, stTotal = c.amount === undefined ? csr.total : c.amount, minBps = csr.cardLimit <= 10000000 ? csr.minimumBps.upTo100k : csr.minimumBps.above;
        if (!Number.isSafeInteger(stTotal) || stTotal <= 0 || stTotal > csr.cardLimit) return invalid("Ekstre tutarı geçersiz.");
        state.bank.cardStatement = { id: "stmt-2026-10", total: stTotal, minimum: Math.round(stTotal * minBps / 10000), minimumBps: minBps, cardLimit: csr.cardLimit, paid: 0, issued: csr.issued, due: csr.due, paymentId: "card-statement-stmt" };
        state.bank.payments.push({ id: "card-statement-stmt", orderId: null, due: csr.due, kind: "card-statement", label: "Kredi kartı ekstresi", amount: stTotal, status: "pending", obligation: true, statementId: "stmt-2026-10" });
        audit("card", "event", "Kart ekstresi kesildi", { total: stTotal, minimum: state.bank.cardStatement.minimum, due: csr.due, costIfMinimum: statementCost(stTotal - state.bank.cardStatement.minimum) });
      }
      if (c.event === "fund-cutoff") {
        // Yalnız aynı günün kontrollü saati 13:30'a ilerler; gün ve gider tahmini değişmez.
        var cutoffAt = Date.parse(day() + "T13:30:00+03:00");
        if (state.now >= cutoffAt) return { ok: true, unchanged: true, now: state.now };
        state.now = cutoffAt;
        audit(null, "event", "Kontrollü saat 13:30'a ilerledi", { time: "13:30" });
        return replan("Kontrollü saat fon kesim saatini geçti", false);
      }
      if (c.event === "rep-release") return dispatch({ type: "shield-release", by: "representative" });
      if (c.event === "shield-time") {
        // Yalnız kontrollü demo saati ilerler; plan/veri sürümü değişmez, bekleyen karar korunur.
        state.now += A.RULES.scamShield.coolingMs;
        audit(null, "event", "Kontrollü saat 15 dakika ilerledi", { minutes: 15 });
        notify(); return { ok: true, now: state.now };
      }
      // İade olayları ortak kanonik kayıttan geçer; diğer olayların kimlik kontrolü ayrıdır.
      if (c.event === "refund" || c.event === "refund-full" || c.event === "refund-partial") {
        return receiveRefund({
          originalRef: c.originalRef || "REF-TX-5",
          amount: c.amount !== undefined ? c.amount : (c.event === "refund-partial" ? 100000 : undefined),
          sourceOccurrenceId: c.sourceOccurrenceId !== undefined ? c.sourceOccurrenceId : c.occurrenceId
        }, c.event === "refund-full");
      }
      var occId = c.sourceOccurrenceId || c.occurrenceId;
      if (occId) {
        var prevOcc = state.bank.occurrences[occId];
        if (prevOcc) {
          var testAmount = c.amount === undefined ? (c.event === "expense" ? 180000 : c.event === "refund-partial" ? 100000 : c.event === "refund-full" ? 210000 : null) : c.amount;
          if (prevOcc.event === c.event && prevOcc.amount === testAmount) {
            return { ok: true, duplicate: true, occurrenceId: occId };
          }
          return invalid("Aynı olay kimliği farklı içerikle tekrar işlenemez.");
        }
      }
      if (c.event === "expense") {
        // Canlı hikâyede (29 Ekim ×2) varsayılan beklenmedik gider 3.600 TL; klasik bakiyede 1.800 TL.
        var amount = c.amount === undefined ? (state.preset === "legacy" || A.CONFIG.useLegacyStartingCash ? 180000 : 360000) : c.amount;
        if (!Number.isSafeInteger(amount) || amount <= 0 || amount > balance("cash") - reserved()) return invalid("Gider için yeterli serbest nakit yok.");
        if (occId) state.bank.occurrences[occId] = { event: c.event, amount: amount, at: state.now };
        state.bank.transactions.push({ id: id("expense"), kind: "new-expense", at: new Date(state.now).toISOString(), amount: amount, label: "Beklenmedik gider", status: "settled", postings: [{ account: "cash", amount: -amount }] });
        state.goals.savings.requested = true; state.goals.savings.amount = null;
        audit(null, "event", "Beklenmedik gider kesinleşti", { amount: amount, occurrenceId: occId, forecastCountedAgain: false });
      }
      if (c.event === "subscription-price") {
        if (occId) state.bank.occurrences[occId] = { event: c.event, amount: 28000, at: state.now };
        if (state.bank.subscription.priceChanged) return invalid("Bu fiyat olayı zaten işlendi.");
        state.bank.subscription.amount = 28000; state.bank.subscription.priceChanged = true;
        state.bank.payments.forEach(function (x) { if (x.kind === "subscription" && x.status === "pending") x.amount = 28000; });
        audit("subscription", "event", "Abonelik fiyatı değişti", { previous: 20000, current: 28000 });
        var run = runFor("subscription", "subscription-price");
        readTool("readAutomaticPayments", "subscription", run);
        var alerts = readTool("readPriceAlertPreferences", "subscription", run);
        audit("subscription", "monitor", "Ücret artışı karşılaştırıldı", { previous: 20000, current: 28000, changeBps: 4000, enabled: alerts.enabled, bankMandateUnchanged: true }, run);
        if (alerts.enabled && !state.tasks.subscription.paused) {
          var notice = { id: id("notice"), key: "digital-film:2026-10-20:20000:28000", type: "price-increase", paymentId: "digital-film", label: "DigitalFilm", previous: 20000, current: 28000, changeBps: 4000, at: state.now, delivery: "in-demo" };
          state.bank.notifications.push(notice);
          audit("subscription", "notification", "Ücret artışı bildirimi hazır", { notificationId: notice.id, previous: notice.previous, current: notice.current, delivery: notice.delivery }, run);
        }
        run.status = "monitoring";
      }
      if (c.event === "quote-expire") { state.now = Math.max(state.now + 1, state.bank.quote.expiresAt + 1); audit("gold", "event", "Kontrollü saat teklif süresini geçti"); }
      if (c.event === "gold-narrow" || c.event === "gold-wide") {
        state.bank.quote = { id: id("quote"), bid: c.event === "gold-narrow" ? 396800 : 391600, ask: 400000, at: state.now, expiresAt: state.now + A.CONFIG.quoteTtlMs };
        audit("gold", "event", "Kotasyon yenilendi", { quote: clone(state.bank.quote), spreadBps: spread() });
      }
      state.dataVersion++; return replan("Senaryo olayı: " + c.event, true);
    }
    return invalid("Komut desteklenmiyor.");
  }
  function reset(preset) {
    preset = preset || "main";
    if (!A.PRESETS.some(function (p) { return p.id === preset; })) throw new Error("Bilinmeyen başlangıç durumu");
    generation++; timers.forEach(function (entry) { clearTimeout(entry.handle); entry.resolve(false); }); timers.clear();
    var isLegacy = (preset === "legacy" || (A.CONFIG && A.CONFIG.useLegacyStartingCash));
    state = { schemaVersion: 1, generation: generation, preset: preset, now: Date.parse(A.CONFIG.date), dataVersion: 1, permissionVersion: 1,
      bank: A.createFixture(preset), permissions: { autoSave: false, perAction: (preset === "security" ? 30000000 : (isLegacy ? 100000 : 10000000)), monthlyLimit: (preset === "security" ? 30000000 : (isLegacy ? 150000 : 10000000)), buffer: (isLegacy ? 100000 : 0), bufferAuto: !isLegacy, source: "cash", target: "savings", expiresAt: Date.parse("2026-10-31T23:59:59+03:00") },
      goals: { savings: { requested: true, amount: null }, subscription: { monitoring: true }, bes: { target: isLegacy ? 100000 : 250000, requested: false }, gold: { budget: 80000, thresholdBps: 100, watching: false } },
      tasks: {}, plans: {}, operations: [], events: [], runs: [], nextToolMode: "success", presentationState: { shownSummaryId: null, dismissed: {} } };
    state.bank.occurrences = {};
    state.bank.refundTrackers = (state.bank && state.bank.refundTrackers) || {};
    A.TASKS.forEach(function (d) { state.tasks[d.id] = { id: d.id, paused: false, status: "monitoring", reason: d.rationale, planVersion: 0, lastReceipt: null, needsRetry: false, humanReview: null }; });
    // Kullanıcıya kart olarak gösterilmez; Kayıtlı işlemler transferinin plan/işlem kaydı için iç kimliktir.
    state.tasks.transfer = { id: "transfer", paused: false, status: "monitoring", reason: "Kayıtlı işlem seçilmedi.", planVersion: 0, lastReceipt: null, needsRetry: false, humanReview: null };
    state.tasks.fund = { id: "fund", paused: false, status: "monitoring", reason: "Birikim bozdurma işlemleri.", planVersion: 0, lastReceipt: null, needsRetry: false, humanReview: null };
    state.tasks.liquidity = { id: "liquidity", paused: false, status: "monitoring", reason: "Günlük nakit akışı izleniyor.", planVersion: 0, lastReceipt: null, needsRetry: false, humanReview: null };
    state.tasks.card = { id: "card", paused: false, status: "monitoring", reason: "Kart ekstresi ve son ödeme günü izleniyor.", planVersion: 0, lastReceipt: null, needsRetry: false, humanReview: null };
    state.bank.cardStatement = null; state.bank.cardAutopay = false;
    state.tasks.trial = { id: "trial", paused: false, status: "monitoring", reason: "Kart provizyonlarından ücretsiz denemeler izleniyor.", planVersion: 0, lastReceipt: null, needsRetry: false, humanReview: null };
    state.device = { call: { active: false } };
    state.preferences = { fundCode: "ALE" };
    // Gider verisi geçersizse tahmin zaten hata verir; başlangıç yine de kurulsun diye eski 2.500 TL yedek değer kalır.
    if (state.permissions.bufferAuto) { try { state.permissions.buffer = forecast().bufferFor.ALE; } catch (e) { state.permissions.buffer = 250000; } }
    state.shield = null; state.shieldFlow = shieldFlowFor(); state.reviewHolds = [];
    state.protection = { newPayeeLocked: false, reference: null };
    if (A.telemetry) A.telemetry.reset();
    audit(null, "session", "Çevrimdışı simülasyon başladı", { date: day(), preset: preset, legalAuthorization: false });
    scan("Başlangıç dönem kontrolü", false);
    return snapshot();
  }
  A.agent = {
    dispatch: dispatch, getSnapshot: snapshot, previewSavings: previewSavings, reset: reset,
    previewCardPayment: function (amount) { return freeze(clone(previewCardPayment(amount))); },
    canTrackRefund: function (reference) { return !!refundSource(reference); },
    validateIban: function (raw) { return normalizeIban(raw); },
    simulateCashFlow30Days: function () { return freeze(clone(simulateCashFlow30Days())); },
    assessTransferRisk: function (input) {
      if (!input || !Number.isSafeInteger(input.amount) || input.amount <= 0 || typeof input.ibanMask !== "string") return freeze({ valid: false });
      return freeze(Object.assign({ valid: true }, clone(assessTransferRisk(input))));
    },
    buildHumanReviewSummary: function (taskId, custom) { return buildHumanReviewSummary(taskId, state, custom); },
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    setToolDelayForTests: function (ms) { if (!Number.isInteger(ms) || ms < 0 || ms > 2000) throw new Error("Geçersiz test gecikmesi"); delayMs = ms; },
    setTransferUndoForTests: function (ms) { if (busy() || !Number.isInteger(ms) || ms < 0 || ms > 10000) throw new Error("Geçersiz test iptal süresi"); undoMs = ms; }
  };
  reset("main");
})(window.ARTI);
