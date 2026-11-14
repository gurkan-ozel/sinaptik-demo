/* Early access: success is shown only after a durable server acknowledgement. */
(function () {
  "use strict";
  var preview = document.getElementById("landing-short-preview");
  if (preview && document.documentElement.dataset.landing === "true") {
    preview.src = preview.dataset.previewSrc;
    var legacy = document.querySelector(".legacy-prototype");
    if (legacy) legacy.hidden = true;
    window.addEventListener("message", function (event) {
      if (event.source !== preview.contentWindow || event.origin !== location.origin || !event.data || event.data.type !== "arti:early-access") return;
      var section = document.getElementById("erken-erisim");
      var input = document.getElementById("early-access-email");
      if (!section || !input) return;
      history.replaceState(null, "", "#erken-erisim");
      var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (section.scrollIntoView) section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      input.focus({ preventScroll: true });
    });
  }
  var form = document.getElementById("early-access-form");
  if (!form || (window.ARTI && ARTI.presentation.phoneOnly)) return;
  var status = document.getElementById("early-access-status");
  var button = document.getElementById("early-access-submit");
  var email = document.getElementById("early-access-email");
  var busy = false;
  var params = new URLSearchParams(location.search);
  // Only a campaign code is retained. Do not collect URL, referrer or bank data.
  var channel = (params.get("utm_source") || "direct").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "direct";
  function message(state, copy) {
    status.dataset.state = state;
    status.textContent = copy;
    status.focus({ preventScroll: true });
  }
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    button.disabled = true;
    form.setAttribute("aria-busy", "true");
    message("pending", "Talebin gönderiliyor…");
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 12000);
    try {
      var response = await fetch(form.action, {
        method: "POST", credentials: "same-origin", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ email: email.value.trim(), consent: form.elements.consent.checked, channel: channel, is_test: params.get("test") === "1" })
      });
      var result = await response.json();
      if (!response.ok || result.ok !== true || result.saved !== true) throw new Error("not-saved");
      form.reset();
      message("success", "Erken erişim talebin alındı. Sinaptik prototipini denemen ve geri bildirim vermen için seninle e-posta üzerinden iletişime geçeceğiz.");
    } catch (_) {
      message("error", "Kaydının alındığını doğrulayamadık. E-posta adresin formda duruyor. Biraz sonra yeniden deneyebilirsin.");
    } finally {
      clearTimeout(timeout);
      busy = false;
      button.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });
})();
