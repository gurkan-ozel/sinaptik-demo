/* Tarayıcı açılış duman kontrolü. Kapsamlı kabul testleri: tests ve kökte test.js. */
(function (A) {
  document.addEventListener("DOMContentLoaded", function () {
    if (location.hash !== "#selftest") return;
    var s = A.agent.getSnapshot();
    var checks = [
      { name: "Dört görev bağlandı", pass: document.querySelectorAll("[data-open]").length === 4 },
      { name: "Başlangıç nakit hesabı", pass: (s.balances.cash === 4600000 && (s.forecast.available === 2000000 || s.forecast.available === 4005000)) || (s.balances.cash === 715000 && s.forecast.available === 120000) },
      { name: "Ön yetki kapalı", pass: !s.permissions.autoSave && !document.getElementById("permission-auto").checked },
      { name: "Yerel veri/araç modu", pass: s.authority.mode === "simulation-only" && !s.authority.productionEnabled }
    ];
    A.selftestResult = { suite: "Açılış duman kontrolü", total: checks.length, passed: checks.filter(function (c) { return c.pass; }).length, checks: checks };
    var box = document.createElement("div"); box.className = "test-box"; box.textContent = "Açılış: " + A.selftestResult.passed + "/" + checks.length; document.body.appendChild(box);
  });
})(window.ARTI);
