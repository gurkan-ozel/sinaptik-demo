/* Optional, consent-led local research recording. No network or persistent storage. */
(function (A) {
  "use strict";
  var toolsEnabled = new URLSearchParams(location.search).get("test") === "1";
  var session = null, startedAt = 0, sessionSerial = 0;
  var phases = ["session", "perception", "tool", "reasoning", "guardrail", "approval", "authorization", "pending", "cancel", "action", "tool-result", "verified", "event", "replan", "error", "uncertainty", "monitor", "goal", "permission", "control", "review", "notification"];
  var eventTypes = ["user-command", "navigation", "reference-change", "point-selected", "comparison-reference", "comparison-point", "offer-open", "why-open", "amount-edit", "skip-offer"].concat(phases.map(function (p) { return "agent-" + p; }));
  var commandTypes = ["set-price-alert", "read-automatic-payments", "prepare-saved-transfer", "approve", "reconcile", "cancel-transfer", "share-receipt", "check", "set-savings-amount", "set-bes-target", "watch-gold", "permissions", "revoke", "pause", "resume", "cancel-plan", "human-review", "clear-human-review", "tool-mode", "acknowledge-result", "mark-summary-shown", "dismiss-summary", "set-refund-tracker", "close-refund-tracker", "receive-refund", "redeem-savings", "deposit-savings", "event"];
  var tasks = ["savings", "shock", "comparison", "subscription", "bes", "gold", "transfer"];
  var taskOutcomes = ["unassisted", "assisted", "abandoned", "declined-informed"];
  var pages = ["home", "detail", "comparison", "accounts", "activity"];
  var references = ["deposit", "participation", "inflation", "fund", "none"];
  var demoEvents = ["expense", "subscription-price", "gold-narrow", "gold-wide", "refund-partial", "refund-full", "advance-day"];
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function clock() { return performance.now(); }
  function elapsed() { return Math.max(0, Math.round(clock() - startedAt)); }
  function recording() { return !!session && session.status === "recording"; }
  function failure(reason) { return { ok: false, reason: reason }; }
  function localSessionId() {
    var nonce = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    return "local-session-" + nonce + "-" + (++sessionSerial);
  }
  function metadata() {
    var p = A.presentation || {};
    return { profile: ["development", "research", "jury"].includes(p.profile) ? p.profile : "unknown", build: typeof p.build === "string" && /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,63}$/.test(p.build) ? p.build : "unknown" };
  }
  function sanitise(detail) {
    var input = detail && typeof detail === "object" ? detail : {}, clean = {};
    if (commandTypes.includes(input.type)) clean.type = input.type;
    if (tasks.includes(input.taskId)) clean.taskId = input.taskId;
    if (typeof input.eventId === "string" && (/^log-\d{1,8}-\d{1,8}$/.test(input.eventId) || demoEvents.includes(input.eventId))) clean.eventId = input.eventId;
    if (pages.includes(input.page)) clean.page = input.page;
    if (references.includes(input.referenceId)) clean.referenceId = input.referenceId;
    if (Number.isInteger(input.index) && input.index >= 0 && input.index <= 6) clean.index = input.index;
    return clean;
  }
  function updatePanel() {
    var count = document.getElementById("test-count"), state = document.getElementById("research-recording-state");
    if (count) count.textContent = session ? session.events.length : 0;
    if (state) state.textContent = !session ? "Kayıt başlamadı." : recording() ? "Kayıt açık · " + session.participantId : "Kayıt durduruldu · " + session.participantId;
    var start = document.getElementById("research-recording-start"), stop = document.getElementById("research-recording-stop"), download = document.getElementById("test-dl"), result = document.getElementById("research-task-record");
    if (start) start.disabled = !!session;
    if (stop) stop.disabled = !recording();
    if (download) download.disabled = !session;
    if (result) result.disabled = !recording();
    ["research-participant-code", "research-session-code", "research-recording-consent"].forEach(function (id) { var input = document.getElementById(id); if (input) input.disabled = !!session; });
    var list = document.getElementById("research-task-results");
    if (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      (session ? session.taskResults : []).forEach(function (r) {
        var row = document.createElement("li");
        row.textContent = { savings: "Birikim önerisi", shock: "Beklenmedik gider", comparison: "Grafik karşılaştırması" }[r.taskId] + " · " + { unassisted: "Yardımsız tamamlandı", assisted: "Yardımla tamamlandı", abandoned: "Tamamlanmadı", "declined-informed": "Doğru anlayarak işlemi yapmadı" }[r.outcome] + " · " + { observed: "Kritik yanlış anlama gözlendi", "not-observed": "Kritik yanlış anlama gözlenmedi", "not-assessed": "Kritik yanlış anlama değerlendirilemedi" }[r.criticalAssessment];
        list.appendChild(row);
      });
    }
  }
  function append(type, detail) {
    session.events.push({ type: type, elapsedMs: elapsed(), sessionId: session.sessionId, profile: session.profile, build: session.build, detail: detail });
    updatePanel();
  }
  A.telemetry = {
    enabled: toolsEnabled,
    start: function (options) {
      var o = options || {};
      if (!toolsEnabled) return failure("Araştırma araçları için ?test=1 kullan.");
      if (o.consent !== true) return failure("Araştırma bilgisi ve katılımcının onayı olmadan kayıt başlamaz.");
      if (typeof o.participantId !== "string" || !/^[A-Z][A-Z0-9]{0,7}-P\d{2,3}$/.test(o.participantId)) return failure("İsim veya e-posta yerine R1-P01 gibi bir katılımcı kodu kullan.");
      if (o.sessionCode !== undefined && o.sessionCode !== "" && (typeof o.sessionCode !== "string" || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(o.sessionCode) || o.sessionCode.length > 32)) return failure("Oturum kodu yalnız büyük harf, sayı ve kısa çizgi içerebilir.");
      if (session) return failure("Önce mevcut kaydı indir; yeni oturum için demoyu sıfırla.");
      var m = metadata(); startedAt = clock();
      session = { schemaVersion: 1, participantId: o.participantId, sessionCode: o.sessionCode || null, sessionId: localSessionId(), consent: true, profile: m.profile, build: m.build, status: "recording", startedElapsedMs: 0, endedElapsedMs: null, events: [], taskResults: [] };
      append("research-start", {}); return { ok: true, sessionId: session.sessionId };
    },
    end: function () {
      if (!recording()) return failure("Etkin bir araştırma kaydı yok.");
      append("research-end", {}); session.status = "ended"; session.endedElapsedMs = elapsed();
      updatePanel(); return { ok: true };
    },
    log: function (type, detail) {
      if (!recording() || !eventTypes.includes(type)) return false;
      append(type, sanitise(detail)); return true;
    },
    recordTask: function (result) {
      var r = result || {};
      if (!recording()) return failure("Önce araştırma kaydını başlat.");
      if (!["savings", "shock", "comparison"].includes(r.taskId) || !taskOutcomes.includes(r.outcome) || (typeof r.criticalMisunderstanding !== "boolean" && r.criticalMisunderstanding !== null)) return failure("Görev, gözlenen sonuç ve kritik yanlış anlama değerlendirmesi gerekli.");
      if (r.taskId === "comparison" && r.outcome === "declined-informed") return failure("İşlem yapmama kararı birikim ve beklenmedik gider görevleri içindir; grafik görevinin sonucunu seç.");
      if (r.outcome === "declined-informed" && r.criticalMisunderstanding) return failure("Doğru anlayarak işlemi yapmama sonucu kritik yanlış anlama ile birlikte kaydedilemez.");
      if (session.taskResults.some(function (existing) { return existing.taskId === r.taskId; })) return failure("Bu görevin sonucu zaten kayıtlı. Sonucu değiştirmek için önce JSON dosyasını indir, sonra demoyu sıfırla; kayıt otomatik değiştirilmez.");
      session.taskResults.push({ taskId: r.taskId, outcome: r.outcome, criticalMisunderstanding: r.criticalMisunderstanding, criticalAssessment: r.criticalMisunderstanding === true ? "observed" : r.criticalMisunderstanding === false ? "not-observed" : "not-assessed", elapsedMs: elapsed() });
      append("task-result", { taskId: r.taskId }); return { ok: true };
    },
    getEvents: function () { return session ? clone(session.events) : []; },
    getSession: function () { return session ? clone(session) : null; },
    reset: function () {
      session = null; startedAt = 0;
      ["research-participant-code", "research-session-code", "research-task-id", "research-task-outcome"].forEach(function (id) { var input = document.getElementById(id); if (input) input.value = ""; });
      var consent = document.getElementById("research-recording-consent"); if (consent) consent.checked = false;
      var critical = document.getElementById("research-task-critical"); if (critical) critical.value = "";
      var declined = document.querySelector('#research-task-outcome option[value="declined-informed"]'); if (declined) declined.disabled = true;
      var notice = document.getElementById("research-recording-feedback"); if (notice) notice.textContent = "";
      updatePanel();
    },
    download: function () {
      if (!session) return failure("İndirilecek araştırma kaydı yok.");
      var url = URL.createObjectURL(new Blob([JSON.stringify(A.telemetry.getSession(), null, 2)], { type: "application/json" }));
      var a = document.createElement("a"); a.href = url; a.download = "arti-" + session.participantId + "-" + session.sessionId + ".json"; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000); return { ok: true };
    }
  };
  document.addEventListener("DOMContentLoaded", function () {
    if (!toolsEnabled) return;
    var host = document.querySelector("#demo > .wrap"); if (!host) return;
    var box = document.createElement("details"); box.className = "research-recording-panel"; box.id = "research-recording-panel";
    box.innerHTML = '<summary>Araştırmacı için oturum kaydı</summary><p class="agent-muted">Bu araç yalnızca bu sayfadaki adımları, geçen süreyi ve senin girdiğin görev sonuçlarını kaydeder. Gerçek hesap bilgisi veya sohbet metni toplamaz; veriyi dışarı göndermez. Katılım gönüllüdür. Katılımcıya amacı, toplanan veriyi, kullanım ve saklama süresini açıklayıp onayını aldıktan sonra başlat.</p><p class="agent-muted">Yenileme veya demo sıfırlaması kaydı siler. Önce JSON dosyasını indir; katılımcının kodunu iletişim bilgilerinden ayrı tut.</p><div class="research-recording-fields"><label for="research-participant-code">Katılımcı kodu</label><input id="research-participant-code" type="text" maxlength="12" placeholder="R1-P01" autocomplete="off" spellcheck="false"><label for="research-session-code">Oturum kodu (isteğe bağlı)</label><input id="research-session-code" type="text" maxlength="32" placeholder="ROUND1" autocomplete="off" spellcheck="false"><label class="research-recording-consent" for="research-recording-consent"><input id="research-recording-consent" type="checkbox">Katılımcı araştırma bilgilerini aldı ve bu yerel kayda onay verdi.</label></div><div class="research-recording-actions"><button type="button" id="research-recording-start" class="btn line-dark small">Kaydı başlat</button><button type="button" id="research-recording-stop" class="btn line-dark small" disabled>Kaydı durdur</button><button type="button" id="test-dl" class="btn line-dark small" disabled>JSON indir</button></div><p id="research-recording-state" class="agent-muted" role="status">Kayıt başlamadı.</p><p class="agent-muted"><span id="test-count">0</span> olay</p><div class="research-task-recording"><label for="research-task-id">Gözlenen görev</label><select id="research-task-id"><option value="">Görev seç</option><option value="savings">Birikim önerisi</option><option value="shock">Beklenmedik gider</option><option value="comparison">Grafik karşılaştırması</option></select><label for="research-task-outcome">Gözlenen sonuç</label><select id="research-task-outcome"><option value="">Sonuç seç</option><option value="unassisted">Yardımsız tamamlandı</option><option value="assisted">Yardımla tamamlandı</option><option value="abandoned">Tamamlanmadı</option></select><label for="research-task-critical">Kritik yanlış anlama</label><select id="research-task-critical" required><option value="">Değerlendirme seç</option><option value="yes">Gözlendi</option><option value="no">Gözlenmedi</option><option value="not-assessed">Değerlendirilemedi</option></select><button type="button" id="research-task-record" class="btn line-dark small" disabled>Görev gözlemini kaydet</button><ul id="research-task-results"></ul></div><p id="research-recording-feedback" class="agent-muted" role="status" aria-live="polite"></p>';
    host.appendChild(box);
    var decline = document.createElement("option"); decline.value = "declined-informed"; decline.textContent = "Doğru anlayarak işlemi yapmadı"; decline.disabled = true;
    document.getElementById("research-task-outcome").appendChild(decline);
    function updateDeclineOption() {
      var task = document.getElementById("research-task-id").value;
      decline.disabled = task !== "savings" && task !== "shock";
      if (decline.disabled && document.getElementById("research-task-outcome").value === decline.value) document.getElementById("research-task-outcome").value = "";
    }
    document.getElementById("research-task-id").onchange = updateDeclineOption;
    function show(result, success) { document.getElementById("research-recording-feedback").textContent = result.ok ? success : result.reason; }
    document.getElementById("research-recording-start").onclick = function () { show(A.telemetry.start({ participantId: document.getElementById("research-participant-code").value.trim(), sessionCode: document.getElementById("research-session-code").value.trim(), consent: document.getElementById("research-recording-consent").checked }), "Yerel araştırma kaydı başladı."); };
    document.getElementById("research-recording-stop").onclick = function () { show(A.telemetry.end(), "Kayıt durdu. JSON dosyasını sıfırlamadan önce indirebilirsin."); };
    document.getElementById("test-dl").onclick = A.telemetry.download;
    document.getElementById("research-task-record").onclick = function () {
      var criticalValue = document.getElementById("research-task-critical").value;
      var result = A.telemetry.recordTask({ taskId: document.getElementById("research-task-id").value, outcome: document.getElementById("research-task-outcome").value, criticalMisunderstanding: criticalValue === "yes" ? true : criticalValue === "no" ? false : criticalValue === "not-assessed" ? null : undefined });
      show(result, "Görev gözlemin kaydedildi.");
      if (result.ok) { document.getElementById("research-task-id").value = ""; document.getElementById("research-task-outcome").value = ""; document.getElementById("research-task-critical").value = ""; updateDeclineOption(); }
    };
    updatePanel();
  });
})(window.ARTI);
