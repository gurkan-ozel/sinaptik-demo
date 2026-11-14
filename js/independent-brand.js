/* Optional Sinaptik identity for the public short preview. No engine or authority changes. */
(function (A) {
  "use strict";
  if (new URLSearchParams(location.search).get("brand") !== "independent") return;
  document.documentElement.dataset.independent = "true";
  function copy(value) {
    return value
      .replace(/Akbank iştiraki Ak Portföy/g, "Kurgusal yatırım aracı")
      .replace(/Akbank Mobil/g, "Sinaptik")
      .replace(/Akbank Asistan/g, "Sinaptik asistanı")
      .replace(/Ak Portföy/g, "Örnek")
      .replace(/Ak Yatırım/g, "örnek yatırım kuruluşu")
      .replace(/Banking IQ/g, "Nakit akışı")
      .replace(/AgeSA/g, "Örnek")
      .replace(/Stablex/g, "Örnek platform")
      .replace(/Temsilciyi sen ara:/g, "Bankana kendin ulaş:")
      .replace(/444 25 25/g, "bankanın resmî destek kanalı")
      .replace(/“Akbank’tan arıyoruz” denirse: Güvenlik Merkezi → “Beni arayan Akbank mı\?”/g, "Arayanı bankanın resmî uygulamasından doğrula.")
      .replace(/Güvenlik Merkezi → “Beni arayan Akbank mı\?”/g, "bankanın resmî uygulaması")
      .replace(/Akbank’tan/g, "bankadan")
      .replace(/Akbank'ın/g, "bankanın")
      .replace(/Akbank’ın/g, "bankanın")
      .replace(/Akbank'ta/g, "Bağlı bankanda")
      .replace(/Akbank’ta/g, "Bağlı bankanda")
      .replace(/Akbank/g, "bağlı bankan")
      .replace(/akbank/g, "sinaptik")
      .replace(/\bALE\b/g, "F1")
      .replace(/\bAIS\b/g, "F2")
      .replace(/\bAFO\b/g, "F3");
  }
  A.applyIndependentBrand = function () {
    [document.getElementById("phone"), document.getElementById("tour")].forEach(function (root) {
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var next = copy(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
    root.querySelectorAll("[aria-label], [title]").forEach(function (element) {
      ["aria-label", "title"].forEach(function (attribute) {
        if (element.hasAttribute(attribute)) {
          var previous = element.getAttribute(attribute), next = copy(previous);
          if (next !== previous) element.setAttribute(attribute, next);
        }
      });
    });
    root.querySelectorAll(".contrast-tag").forEach(function (element) { element.hidden = true; });
    root.querySelectorAll('a[href*="akbank.com"], a[href*="akportfoy.com"], a[href*="agesa.com"]').forEach(function (link) {
      link.removeAttribute("href");
      link.removeAttribute("target");
      link.setAttribute("tabindex", "-1");
    });
    });
  };
})(window.ARTI);
