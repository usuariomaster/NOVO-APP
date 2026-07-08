/* MedTran — interações do site (vanilla JS, sem dependências) */
(function () {
  "use strict";

  /* --- Header muda ao rolar --- */
  var header = document.querySelector(".site-header");
  function onScroll() {
    if (!header) return;
    header.classList.toggle("scrolled", window.scrollY > 12);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* --- Menu mobile --- */
  var toggle = document.querySelector(".nav-toggle");
  if (toggle && header) {
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    header.querySelectorAll(".nav-links a").forEach(function (a) {
      a.addEventListener("click", function () {
        header.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* --- Reveal ao entrar na viewport --- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealEls.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* --- Contador animado nas estatísticas --- */
  var stats = document.querySelectorAll("[data-count]");
  function animateCount(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    var suffix = el.getAttribute("data-suffix") || "";
    var dur = 1400, start = null;
    function tick(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = target * eased;
      el.textContent = (target % 1 === 0 ? Math.round(val) : val.toFixed(1)) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  if ("IntersectionObserver" in window && stats.length) {
    var sio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { animateCount(e.target); sio.unobserve(e.target); }
      });
    }, { threshold: 0.5 });
    stats.forEach(function (el) { sio.observe(el); });
  }

  /* --- Duplicar marquee para loop contínuo --- */
  document.querySelectorAll(".marquee__track").forEach(function (track) {
    track.innerHTML += track.innerHTML;
  });

  /* --- Formulários (agendamento / contato): validação simples e feedback --- */
  document.querySelectorAll("form[data-mock]").forEach(function (form) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var ok = form.querySelector(".form-ok");
      var btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Enviando…"; }
      setTimeout(function () {
        if (ok) {
          ok.classList.add("show");
          var nome = (form.querySelector('[name="nome"]') || {}).value || "";
          var msg = ok.getAttribute("data-msg") || "Recebemos seu pedido! Em breve confirmaremos por WhatsApp.";
          ok.querySelector("span").textContent = (nome ? nome.split(" ")[0] + ", " : "") + msg;
        }
        form.reset();
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
      }, 700);
    });
  });

  /* --- Ano no rodapé --- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
