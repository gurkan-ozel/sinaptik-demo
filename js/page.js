/* Sayfa düzeyi: marka adı ve problem kartları. */
(function () {
  var E = ARTI.EVIDENCE;

  var CARDS = [
    { title: "Niyete güven", text: "Öneri, kişiye özel değil bankanın hedefine hizmet ediyor gibi okunuyor.", keys: ["sizeOzel", "niyet"] },
    { title: "Artan para", text: "Birikim planlı değil, ay sonunda kalana bırakılıyor ve düzensiz birikiyor.", keys: ["artanPara", "manuel"] },
    { title: "Kontrol", text: "Karar kullanıcıda kalmalı. Katı kurallar değişen nakit akışına uymuyor.", keys: ["kontrol", "kati"] },
    { title: "Öneri yorgunluğu", text: "Akışı kesen pop-up ve chatbot yönlendirmelerinde öfke ve güven kaybı, ürün tasarımında kontrol ihtiyacını destekliyor.", keys: ["popup", "anaPara"] }
  ];

  function stat(key) {
    var e = E[key];
    return '<li><div class="st-top"><span>' + e.label + '</span><b>' + e.n + '/' + ARTI.N + ' <small>(%' + ARTI.pct(e.n) + ')</small></b></div>' +
      '<div class="bar"><i style="width:' + ARTI.pct(e.n) + '%"></i></div></li>';
  }

  document.addEventListener("DOMContentLoaded", function () {
    var name = document.getElementById("brand-name");
    if (name) name.textContent = ARTI.APP_NAME;
    document.title = ARTI.APP_NAME + " — Birikim, artan paraya kalmasın";

    var host = document.getElementById("problem-cards");
    if (!host) return;
    host.innerHTML = CARDS.map(function (c) {
      return '<article class="pcard"><h3>' + c.title + '</h3><p>' + c.text + '</p><ul class="stats">' + c.keys.map(stat).join("") + '</ul></article>';
    }).join("");
  });
})();
