"use strict";
/* =====================================================================
   Telas do sistema (rotas por hash) — Bootstrap 5.3 + IMask (máscaras)
   ===================================================================== */
let USER = null;

/* ---------- Preferências e acessibilidade ---------- */
function aplicaTema(t) {
  document.documentElement.dataset.bsTheme = t;
  $("#btn-tema").innerHTML = icone(t === "dark" ? "sun" : "moon-stars");
  $("#btn-tema").title = t === "dark" ? "Usar tema claro" : "Usar tema escuro";
  store.set("tema", t);
}
function aplicaFonte(px) {
  document.documentElement.style.fontSize = px + "px";
  $$("[data-fonte]").forEach(b => {
    const ativo = b.dataset.fonte === String(px);
    b.classList.toggle("active", ativo); b.setAttribute("aria-pressed", String(ativo));
  });
  store.set("fonte", px);
}
$("#btn-tema").addEventListener("click", () => aplicaTema(document.documentElement.dataset.bsTheme === "dark" ? "light" : "dark"));
$$("[data-fonte]").forEach(b => b.addEventListener("click", () => aplicaFonte(b.dataset.fonte)));
$("#btn-ouvir").addEventListener("click", () => {
  const b = $("#btn-ouvir");
  if (!("speechSynthesis" in window)) return toast("Seu navegador não tem leitura em voz alta.", true);
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); b.setAttribute("aria-pressed", "false"); b.classList.remove("active"); return; }
  const fala = new SpeechSynthesisUtterance($("#conteudo").innerText.replace(/\s+/g, " ").slice(0, 4000));
  fala.lang = "pt-BR";
  fala.onend = () => { b.setAttribute("aria-pressed", "false"); b.classList.remove("active"); };
  b.setAttribute("aria-pressed", "true"); b.classList.add("active");
  speechSynthesis.speak(fala);
});
$("#btn-sair").addEventListener("click", async () => {
  await api("POST", "/api/logout").catch(() => {});
  USER = null; ir("login");
});

/* ---------- Rotas ---------- */
const MENUS = {
  aluno: [["meus", "Meus pedidos", "inbox"], ["nova", "Nova solicitação", "plus-circle"]],
  coordenador: [["agenda", "Agenda", "calendar-week"], ["reunioes", "Reuniões", "table"], ["escala", "Escala", "clock"], ["motivos", "Motivos", "list-check"]],
};
const VIEWS = {};
/* Enquanto a tela carrega: "esqueleto" com placeholders do Bootstrap */
const ESQUELETO = `<div aria-busy="true"><span class="visually-hidden" role="status">Carregando…</span>
  <div class="placeholder-glow mb-4" aria-hidden="true"><span class="placeholder col-4 col-md-3 placeholder-lg"></span><br><span class="placeholder col-7 col-md-5 placeholder-sm"></span></div>
  ${[1, 2, 3].map(() => `<div class="card mb-3" aria-hidden="true"><div class="card-body placeholder-glow">
    <span class="placeholder col-6"></span><span class="placeholder col-3 offset-3 rounded-pill"></span><br><span class="placeholder col-8 placeholder-sm"></span></div></div>`).join("")}</div>`;
function ir(rota) { if (location.hash.slice(1) === rota) render(); else location.hash = rota; }

async function render() {
  speechSynthesis?.cancel?.();
  let rota = location.hash.slice(1) || "inicio";
  if (!USER && !["login", "cadastro"].includes(rota)) rota = "login";
  if (USER && ["login", "cadastro", "inicio"].includes(rota)) rota = USER.perfil === "aluno" ? "meus" : "agenda";
  if (USER && !MENUS[USER.perfil].some(([r]) => r === rota)) rota = MENUS[USER.perfil][0][0];

  $("#menu").innerHTML = USER ? MENUS[USER.perfil].map(([r, t, ic]) =>
    `<li class="nav-item"><a href="#${r}" class="nav-link ${r === rota ? "active" : ""}" ${r === rota ? 'aria-current="page"' : ""}>${icone(ic, "me-1")}${t}</a></li>`).join("") : "";
  bootstrap.Collapse.getInstance($("#nav-principal"))?.hide();
  $("#btn-sair").hidden = !USER;
  $("#btn-menu").hidden = false;

  const main = $("#conteudo");
  main.innerHTML = ESQUELETO;
  try { await VIEWS[rota](main); }
  catch (e) {
    if (e.status === 401) { USER = null; return ir("login"); }
    main.innerHTML = `<div class="alert alert-danger">${icone("exclamation-triangle-fill", "me-2")}${esc(erroTexto(e))}</div>`;
  }
  main.firstElementChild?.classList.add("entra");
  main.focus({ preventScroll: true });
}
window.addEventListener("hashchange", render);

const cabecalho = (titulo, sub, acao = "") => `
  <div class="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-4">
    <div><h1 class="titulo-pagina">${titulo}</h1>${sub ? `<p class="text-body-secondary mb-0">${sub}</p>` : ""}</div>${acao}</div>`;
const statusBadge = s => `<span class="badge rounded-pill status status-${esc(s)}">${esc(s === "Aprovada" ? "Confirmada" : s)}</span>`;
const vazio = (ic, texto) => `<div class="card"><div class="vazio">${icone(ic)}${texto}</div></div>`;

/* =====================================================================
   Login e cadastro
   ===================================================================== */
VIEWS.login = async main => {
  let perfil = store.get("perfil", "aluno");
  main.innerHTML = `
  <div class="tela-login mx-auto py-lg-4">
    <div class="text-center mb-4"><div class="marca-icone" aria-hidden="true"><i class="bi bi-calendar2-check"></i></div>
      <h1 class="h3 fw-bold mb-1">Agenda da Coordenação</h1>
      <p class="text-body-secondary mb-0">Marque seu atendimento com a coordenação do curso.</p></div>
    <form class="card shadow-sm" id="f-login" novalidate><div class="card-body p-4">
      <div class="btn-group w-100 mb-3" role="group" aria-label="Entrar como">
        <input type="radio" class="btn-check" name="perfil" id="p-aluno" value="aluno">
        <label class="btn btn-outline-primary" for="p-aluno">${icone("mortarboard", "me-1")}Sou aluno</label>
        <input type="radio" class="btn-check" name="perfil" id="p-coord" value="coordenador">
        <label class="btn btn-outline-primary" for="p-coord">${icone("person-badge", "me-1")}Sou coordenador</label>
      </div>
      <div class="form-floating mb-3"><input class="form-control" id="l-login" autocomplete="username" placeholder=" " required maxlength="254">
        <label for="l-login" id="l-rot"></label></div>
      <div class="input-group mb-3">
        <div class="form-floating"><input class="form-control" id="l-senha" type="password" autocomplete="current-password" placeholder=" " required maxlength="72">
          <label for="l-senha">Senha</label></div>
        <button class="btn btn-outline-secondary" type="button" id="l-ver" aria-label="Mostrar senha">${icone("eye")}</button>
      </div>
      <div id="l-erro" class="alert alert-danger py-2 small" role="alert" hidden></div>
      <button class="btn btn-primary w-100" type="submit">Entrar</button>
      <p class="small text-body-secondary mt-3 mb-0" id="l-extra"></p>
    </div></form>
    ${DEMO ? `<div class="alert alert-info small mt-3 mb-0"><b>Demonstração:</b> aluno <b>1234567</b> / <b>Aluno2026!</b> · coordenador <b>coordenacao@demo.edu</b> / <b>Coord2026!</b></div>` : ""}
  </div>`;
  const marca = () => {
    $(`input[value="${perfil}"]`).checked = true;
    $("#l-rot").textContent = perfil === "aluno" ? "RA ou e-mail" : "E-mail institucional";
    $("#l-login").inputMode = perfil === "aluno" ? "text" : "email";
    $("#l-extra").innerHTML = perfil === "aluno" ? `Primeiro acesso? <a href="#cadastro">Criar conta</a>` : "O acesso do coordenador é criado pela instituição.";
  };
  $$("input[name=perfil]").forEach(r => r.addEventListener("change", () => { perfil = r.value; store.set("perfil", perfil); marca(); }));
  marca();
  $("#l-ver").addEventListener("click", () => {
    const s = $("#l-senha"), ver = s.type === "password";
    s.type = ver ? "text" : "password";
    $("#l-ver").innerHTML = icone(ver ? "eye-slash" : "eye");
    $("#l-ver").setAttribute("aria-label", ver ? "Esconder senha" : "Mostrar senha");
  });
  $("#f-login").addEventListener("submit", async e => {
    e.preventDefault();
    const login = $("#l-login").value.trim(), senha = $("#l-senha").value;
    if (!login || !senha) return mostraErro($("#l-erro"), "Preencha o login e a senha.");
    await comCarregando($("button[type=submit]", e.target), async () => {
      try {
        USER = await api("POST", "/api/login", { perfil, login, senha });
        ir(USER.perfil === "aluno" ? "meus" : "agenda");
      } catch (er) {
        mostraErro($("#l-erro"), erroTexto(er));
        $("#f-login").classList.add("sacode");
        setTimeout(() => $("#f-login")?.classList.remove("sacode"), 800);
      }
    });
  });
};
VIEWS.inicio = VIEWS.login;

VIEWS.cadastro = async main => {
  const cursos = await api("GET", "/api/cursos");
  main.innerHTML = `
  <div class="tela-login mx-auto">
    <form class="card shadow-sm" id="f-cad" novalidate><div class="card-body p-4">
      <h1 class="h4 fw-bold">Criar conta</h1><p class="text-body-secondary small">Use o RA e o e-mail da faculdade.</p>
      <div class="form-floating mb-3"><input class="form-control" id="c-nome" required maxlength="100" autocomplete="name" placeholder=" "><label for="c-nome">Nome completo</label>
        <div class="invalid-feedback">Escreva o nome completo.</div></div>
      <div class="form-floating mb-3"><input class="form-control" id="c-ra" required inputmode="numeric" maxlength="20" placeholder=" "><label for="c-ra">RA (somente números)</label>
        <div class="invalid-feedback">O RA tem pelo menos 4 números.</div></div>
      <div class="form-floating mb-3"><input class="form-control" id="c-email" type="email" required autocomplete="email" maxlength="254" placeholder=" "><label for="c-email">E-mail</label>
        <div class="invalid-feedback">Informe um e-mail válido.</div></div>
      <div class="form-floating mb-3"><select class="form-select" id="c-curso">${cursos.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join("")}</select><label for="c-curso">Curso</label></div>
      <div class="form-floating mb-2"><input class="form-control" id="c-cel" inputmode="tel" placeholder=" " autocomplete="tel-national"><label for="c-cel">Celular com DDD (opcional)</label>
        <div class="invalid-feedback">Celular incompleto: (11) 99999-0000.</div></div>
      <div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="c-wpp"><label class="form-check-label small" for="c-wpp">Aceito receber respostas da coordenação por WhatsApp</label></div>
      <div class="form-floating mb-1"><input class="form-control" id="c-senha" type="password" minlength="8" maxlength="72" required autocomplete="new-password" placeholder=" "><label for="c-senha">Senha</label></div>
      <div class="form-text mb-3" id="c-forca">Mínimo 8 caracteres, com letras e números.</div>
      <div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="c-lgpd"><label class="form-check-label small" for="c-lgpd">Li e aceito que meus dados (nome, RA, e-mail e curso) sejam usados só para agendar atendimentos, conforme a LGPD.</label>
        <div class="invalid-feedback">Obrigatório para criar a conta.</div></div>
      <div id="c-erro" class="alert alert-danger py-2 small" role="alert" hidden></div>
      <button class="btn btn-primary w-100" type="submit">Criar conta</button>
      <p class="small text-body-secondary mt-3 mb-0">Já tem conta? <a href="#login">Entrar</a></p>
    </div></form>
  </div>`;
  const ra = Mascaras.ra($("#c-ra")), cel = Mascaras.celular($("#c-cel"));
  Mascaras.email($("#c-email"));
  const senhaOk = v => v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v);
  $("#c-senha").addEventListener("input", e => {
    const ok = senhaOk(e.target.value);
    e.target.classList.toggle("is-valid", ok);
    $("#c-forca").className = "form-text mb-3 " + (ok ? "text-success" : "");
  });
  $("#f-cad").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("#c-erro");
    const campos = { "c-nome": $("#c-nome").value.trim().length >= 3, "c-ra": ra.unmaskedValue.length >= 4,
      "c-email": $("#c-email").checkValidity() && $("#c-email").value, "c-senha": senhaOk($("#c-senha").value),
      "c-cel": !cel.unmaskedValue || cel.unmaskedValue.length === 11, "c-lgpd": $("#c-lgpd").checked };
    Object.entries(campos).forEach(([id, ok]) => $("#" + id).classList.toggle("is-invalid", !ok));
    $("#c-forca").classList.toggle("text-danger", !campos["c-senha"]);
    if (Object.values(campos).some(ok => !ok)) { $(".is-invalid", e.target).focus(); return mostraErro(err, "Confira os campos destacados."); }
    await comCarregando($("button[type=submit]", e.target), async () => {
      try {
        USER = await api("POST", "/api/alunos", {
          nome: $("#c-nome").value.trim(), ra: ra.unmaskedValue, email: $("#c-email").value.trim().toLowerCase(),
          id_curso: Number($("#c-curso").value), senha: $("#c-senha").value, celular: cel.unmaskedValue || null,
          aceita_whatsapp: $("#c-wpp").checked, aceite_lgpd: true,
        });
        toast("Conta criada. Bem-vindo(a)!"); ir("meus");
      } catch (er) { mostraErro(err, erroTexto(er)); }
    });
  });
};

/* =====================================================================
   Aluno: Meus pedidos
   ===================================================================== */
VIEWS.meus = async main => {
  const [ags, notifs] = await Promise.all([api("GET", "/api/agendamentos/meus"), api("GET", "/api/notificacoes")]);
  const novas = notifs.filter(n => !n.lida);
  const proxima = ags.filter(a => a.status === "Aprovada" && a.inicio && parse(a.inicio) > new Date())
    .sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
  main.innerHTML = `<div>
  ${cabecalho(`Olá, ${esc(USER.nome.split(" ")[0])}`, "Seus atendimentos com a coordenação.",
    `<a class="btn btn-primary" href="#nova">${icone("plus-lg", "me-1")}Nova solicitação</a>`)}
  ${novas.length ? `<div class="alert alert-info" role="status">
    <div class="d-flex align-items-center gap-2 mb-1"><b>${icone("bell-fill", "me-1")}${novas.length} aviso(s) novo(s)</b>
      <button class="btn btn-sm btn-link ms-auto p-0" id="b-lidas">Marcar como lidos</button></div>
    <ul class="small mb-0 ps-3">${novas.map(n => `<li>${esc(n.mensagem)}</li>`).join("")}</ul></div>` : ""}
  ${proxima ? `<section class="card card-destaque shadow-sm mb-4" aria-label="Próxima reunião"><div class="card-body">
    <div class="sobretitulo mb-1">Próxima reunião</div>
    <div class="data-grande">${esc(fmtQuando(proxima.inicio))} – ${fmtHora(proxima.fim)}</div>
    <div class="meta mt-1"><span>${icone("geo-alt", "me-1")}${esc(proxima.local)}</span><span>${icone("person", "me-1")}${esc(proxima.gestor)}</span><span>${icone("tag", "me-1")}${esc(proxima.motivo)}</span></div>
  </div></section>` : ""}
  <div class="d-flex flex-wrap align-items-center gap-2 mb-3"><h2 class="h5 mb-0 me-auto">Histórico</h2>
    <div class="input-group input-group-sm w-auto"><span class="input-group-text">${icone("search")}</span>
      <input class="form-control" id="busca" placeholder="Buscar por palavra-chave" aria-label="Buscar no histórico" maxlength="60"></div></div>
  <div id="lista"></div></div>`;

  const desenha = lista => {
    $("#lista").innerHTML = lista.length ? `<div class="list-group shadow-sm">${lista.map(a => `
      <div class="list-group-item py-3">
        <div class="d-flex gap-2 align-items-start"><div class="me-auto">
          <h3 class="h6 mb-0">${esc(a.titulo)}</h3>
          <div class="small text-body-secondary">${esc(a.motivo)}${a.disciplina ? " · " + esc(a.disciplina) : ""}</div></div>
          ${statusBadge(a.status)}</div>
        <div class="meta mt-2">${a.inicio ? `<span>${icone("calendar-event", "me-1")}${esc(fmtQuando(a.inicio))}</span><span>${icone("geo-alt", "me-1")}${esc(a.local)}</span>`
          : `<span>${icone("cloud-arrow-up", "me-1")}Pedido online · enviado em ${esc(fmtData(a.criado_em))}</span>`}
          ${a.anexos.length ? `<span>${icone("paperclip", "me-1")}${a.anexos.map(x => esc(x.arquivo)).join(", ")}</span>` : ""}</div>
        ${a.observacao ? `<div class="small mt-2"><b>Observação:</b> ${esc(a.observacao)}</div>` : ""}
        ${a.avaliacao ? `<div class="small text-body-secondary mt-1">${icone("star-fill", "text-warning me-1")}Sua nota: <b>${a.avaliacao.nota}</b>/10</div>` : ""}
        <div class="d-flex flex-wrap gap-2 mt-2">
          ${["Pendente", "Aprovada"].includes(a.status) && (!a.inicio || parse(a.inicio) > new Date()) ? `<button class="btn btn-sm btn-outline-danger" data-cancelar="${a.id}">Cancelar</button>` : ""}
          ${a.status === "Realizada" && !a.avaliacao ? `<button class="btn btn-sm btn-primary" data-avaliar="${a.id}">${icone("star", "me-1")}Avaliar de 1 a 10</button>` : ""}
          ${a.status === "Cancelada" && a.cancelado_por === "GESTOR" ? `<a class="btn btn-sm btn-outline-primary" href="#nova">Escolher outro horário</a>` : ""}
        </div>
      </div>`).join("")}</div>`
      : vazio("inbox", "Nenhum pedido encontrado. Use <b>Nova solicitação</b> para marcar seu primeiro atendimento.");
    $$("[data-cancelar]").forEach(b => b.addEventListener("click", () => confirmaCancelar(Number(b.dataset.cancelar))));
    $$("[data-avaliar]").forEach(b => b.addEventListener("click", () => avaliar(Number(b.dataset.avaliar))));
  };
  desenha(ags);
  let t;
  $("#busca").addEventListener("input", e => { clearTimeout(t); t = setTimeout(async () => desenha(await api("GET", "/api/agendamentos/meus?q=" + encodeURIComponent(e.target.value))), 300); });
  $("#b-lidas")?.addEventListener("click", async () => { await api("PATCH", "/api/notificacoes/lidas"); render(); });
};

function confirmaCancelar(id) {
  dialogo({
    titulo: "Cancelar este pedido?",
    corpo: `<p class="mb-0 text-body-secondary">O horário volta a ficar livre para outros alunos.</p>`,
    rodape: `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Voltar</button><button class="btn btn-danger" id="ok">Cancelar pedido</button>`,
    aoAbrir: (d, fechar) => $("#ok", d).addEventListener("click", e => comCarregando(e.currentTarget, async () => {
      try { await api("PATCH", `/api/agendamentos/${id}/cancelar`, {}); fechar(); toast("Pedido cancelado."); render(); }
      catch (er) { fechar(); toast(erroTexto(er), true); }
    })),
  });
}

function avaliar(id) {
  let nota = 0;
  dialogo({
    titulo: "Como foi o atendimento?",
    corpo: `<p class="text-body-secondary">Escolha uma nota de 1 a 10.</p>
      <div class="notas mb-3" role="radiogroup" aria-label="Nota">${[...Array(10)].map((_, i) => `
        <input type="radio" class="btn-check" name="nota" id="n${i + 1}" value="${i + 1}"><label class="btn btn-outline-primary" for="n${i + 1}">${i + 1}</label>`).join("")}</div>
      <label for="av-com" class="form-label">Comentário (opcional)</label><textarea class="form-control" id="av-com" maxlength="500" rows="3"></textarea>`,
    rodape: `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Agora não</button><button class="btn btn-primary" id="ok" disabled>Enviar avaliação</button>`,
    aoAbrir: (d, fechar) => {
      $$("[name=nota]", d).forEach(r => r.addEventListener("change", () => { nota = Number(r.value); $("#ok", d).disabled = false; }));
      $("#ok", d).addEventListener("click", e => comCarregando(e.currentTarget, async () => {
        try { await api("POST", `/api/agendamentos/${id}/avaliacao`, { nota, comentario: $("#av-com", d).value || null }); fechar(); toast("Obrigado pela avaliação!"); render(); }
        catch (er) { toast(erroTexto(er), true); }
      }));
    },
  });
}

/* =====================================================================
   Aluno: Nova solicitação (motivo → detalhes → horário → confirmar)
   ===================================================================== */
VIEWS.nova = async main => {
  const [motivos, disciplinas] = await Promise.all([api("GET", "/api/motivos"), api("GET", "/api/disciplinas")]);
  const s = { motivo: null, dia: null, horario: null, livres: [] };
  const etiqueta = m => m.destino === "SECRETARIA" ? `<span class="badge text-bg-secondary">Secretaria</span>`
    : m.atendimento === "ONLINE" ? `<span class="badge text-bg-info">Online, sem reunião</span>`
    : `<span class="badge text-bg-light border">${icone("clock", "me-1")}${m.duracao_min} min · presencial</span>`;
  main.innerHTML = `<div>
  ${cabecalho("Nova solicitação", "Reuniões presenciais são confirmadas na hora, sem esperar aprovação.")}
  <ol class="etapas p-0 mb-4" aria-hidden="true"><li data-p="1">1. Motivo</li><li data-p="2">2. Detalhes</li><li data-p="3">3. Horário</li><li data-p="4">4. Confirmar</li></ol>
  <section class="card shadow-sm"><div class="card-body">
    <h2 class="h5 mb-3">Qual é o assunto?</h2>
    <div class="row g-2" role="radiogroup" aria-label="Motivo do contato">${motivos.map(m => `
      <div class="col-sm-6 col-lg-4"><input type="radio" class="btn-check" name="motivo" id="m${m.id}" value="${m.id}">
        <label class="btn btn-outline-secondary opcao" for="m${m.id}"><span class="d-block fw-semibold mb-1">${esc(m.nome)}</span>${etiqueta(m)}</label></div>`).join("")}
    </div></div></section>
  <div id="resto"></div></div>`;
  const etapa = n => $$(".etapas li").forEach(li => { const i = Number(li.dataset.p); li.className = i < n ? "feito" : i === n ? "ativo" : ""; });
  etapa(1);
  $$("[name=motivo]").forEach(r => r.addEventListener("change", () => {
    s.motivo = motivos.find(m => m.id === Number(r.value)); s.dia = s.horario = null;
    desenhaResto();
  }));

  async function desenhaResto() {
    const m = s.motivo, resto = $("#resto");
    if (m.destino === "SECRETARIA") {
      etapa(1);
      resto.innerHTML = `<div class="alert alert-warning mt-3 entra" role="alert">
        ${icone("signpost-split", "me-2")}<b>Esse assunto não é com a coordenação.</b><br>${esc(m.orientacao || "Procure a secretaria acadêmica.")}</div>`;
      return;
    }
    etapa(2);
    const docs = m.documentos || [];
    resto.innerHTML = `
    <section class="card shadow-sm mt-3 entra"><div class="card-body">
      <h2 class="h5 mb-3">Detalhes</h2>
      ${m.orientacao ? `<div class="alert alert-info small py-2">${icone("info-circle", "me-1")}${esc(m.orientacao)}</div>` : ""}
      <div class="row g-3">
        ${m.exige_disciplina ? `<div class="col-md-6"><label for="n-disc" class="form-label">Disciplina</label>
          <select class="form-select" id="n-disc"><option value="">Escolha…</option>${disciplinas.map(d => `<option value="${d.id}">${esc(d.nome)}</option>`).join("")}</select></div>` : ""}
        <div class="col-md-6"><label for="n-tit" class="form-label">Título</label><input class="form-control" id="n-tit" maxlength="100" placeholder="Ex.: Nota da AV1 não apareceu"></div>
        <div class="col-12"><label for="n-desc" class="form-label">Descrição <span class="text-body-secondary">(opcional)</span></label>
          <textarea class="form-control" id="n-desc" maxlength="500" rows="3" placeholder="Conte em poucas linhas o que precisa."></textarea>
          <div class="form-text text-end" id="n-cont">0/500</div></div>
      </div>
      ${docs.length ? `<h3 class="h6 mt-3">Documentos</h3>${docs.map(d => `<div class="mb-2">
        <label for="doc-${d.id}" class="form-label">${esc(d.nome)} ${d.obrigatorio ? `<span class="badge text-bg-danger">obrigatório</span>` : `<span class="badge text-bg-secondary">opcional</span>`}</label>
        <input class="form-control" type="file" id="doc-${d.id}" data-doc="${d.id}" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"></div>`).join("")}
        <div class="form-text">PDF, JPG ou PNG de até 5 MB.</div>` : ""}
    </div></section>
    ${m.atendimento === "PRESENCIAL" ? `<section class="card shadow-sm mt-3 entra"><div class="card-body">
      <h2 class="h5">Escolha o dia e o horário</h2><p class="small text-body-secondary" id="h-info">Carregando horários livres…</p>
      <div class="dias" id="dias" role="radiogroup" aria-label="Dia"></div><div class="slots mt-3" id="slots" role="radiogroup" aria-label="Horário"></div>
    </div></section>` : ""}
    <div id="h-erro" class="alert alert-danger mt-3" role="alert" hidden></div>
    <div class="d-flex justify-content-end mt-3"><button class="btn btn-primary btn-lg" id="enviar">${m.atendimento === "ONLINE" ? icone("send", "me-2") + "Enviar pedido" : icone("check2-circle", "me-2") + "Confirmar reunião"}</button></div>`;
    $("#n-desc").addEventListener("input", e => { $("#n-cont").textContent = `${e.target.value.length}/500`; });
    $("#enviar").addEventListener("click", enviar);
    if (m.atendimento === "PRESENCIAL") {
      $("#n-disc")?.addEventListener("change", carregaHorarios);
      await carregaHorarios();
    }
  }

  async function carregaHorarios() {
    const disc = $("#n-disc")?.value;
    s.livres = await api("GET", `/api/horarios/livres?id_motivo=${s.motivo.id}${disc ? "&id_disciplina=" + disc : ""}`);
    if (!s.livres.some(d => d.data === s.dia)) s.dia = s.livres[0]?.data || null;
    s.horario = null;
    desenhaHorarios();
  }

  function desenhaHorarios() {
    const m = s.motivo;
    $("#h-info").textContent = s.livres.length ? `Reuniões de ${m.duracao_min} min. Só aparecem horários com pelo menos 24 h de antecedência.`
      : "Não há horários livres nos próximos dias. Tente mais tarde.";
    $("#dias").innerHTML = s.livres.map(d => { const x = parse(d.data); return `
      <input type="radio" class="btn-check" name="dia" id="d${d.data}" value="${d.data}" ${d.data === s.dia ? "checked" : ""}>
      <label class="btn btn-outline-primary" for="d${d.data}"><span>${SEMANA[x.getDay()]}</span><b>${pad(x.getDate())}</b><span>${pad(x.getMonth() + 1)}/${String(x.getFullYear()).slice(2)}</span></label>`; }).join("");
    const dia = s.livres.find(d => d.data === s.dia);
    $("#slots").innerHTML = dia ? dia.horarios.map((h, i) => `
      <input type="radio" class="btn-check" name="slot" id="s${i}" value="${i}" ${s.horario === h ? "checked" : ""}>
      <label class="btn btn-outline-secondary fw-semibold" for="s${i}">${fmtHora(h.inicio)}</label>`).join("") : "";
    $$("[name=dia]").forEach(r => r.addEventListener("change", () => { s.dia = r.value; s.horario = null; desenhaHorarios(); }));
    $$("[name=slot]").forEach(r => r.addEventListener("change", () => { s.horario = dia.horarios[Number(r.value)]; etapa(4); }));
    if (!s.horario) etapa(3);
  }

  async function enviar() {
    const m = s.motivo, err = $("#h-erro");
    const falha = t => mostraErro(err, t);
    const titulo = $("#n-tit").value.trim();
    $("#n-disc")?.classList.toggle("is-invalid", m.exige_disciplina && !$("#n-disc").value);
    $("#n-tit").classList.toggle("is-invalid", titulo.length < 3);
    if (m.exige_disciplina && !$("#n-disc").value) return falha("Escolha a disciplina.");
    if (titulo.length < 3) return falha("Escreva um título com pelo menos 3 letras.");
    const fd = new FormData();
    fd.append("id_motivo", m.id); fd.append("titulo", titulo);
    if ($("#n-desc").value.trim()) fd.append("descricao", $("#n-desc").value.trim());
    if (m.exige_disciplina) fd.append("id_disciplina", $("#n-disc").value);
    for (const inp of $$("[data-doc]")) {
      const d = (m.documentos || []).find(x => x.id === Number(inp.dataset.doc));
      const f = inp.files[0];
      inp.classList.toggle("is-invalid", !f && d.obrigatorio);
      if (!f && d.obrigatorio) return falha(`Anexe: ${d.nome}.`);
      if (f) {
        if (f.size > 5 * 1024 * 1024) return falha(`${f.name} passa de 5 MB.`);
        fd.append("documentos", d.id); fd.append("arquivos", f);
      }
    }
    if (m.atendimento === "PRESENCIAL") {
      if (!s.horario) return falha("Escolha um horário.");
      fd.append("inicio", s.horario.inicio); fd.append("id_gestor", s.horario.gestor_id);
    }
    falha("");
    await comCarregando($("#enviar"), async () => {
      try {
        const ag = await api("POST", "/api/agendamentos", fd);
        const ok = ag.status === "Aprovada";
        dialogo({
          titulo: ok ? "Reunião confirmada" : "Pedido enviado",
          corpo: `<div class="text-center"><div class="display-5 mb-2 surge ${ok ? "text-success" : "text-primary"}">${icone(ok ? "check-circle-fill" : "envelope-check-fill")}</div>
            ${ag.inicio ? `<p class="data-grande mb-1">${esc(fmtQuando(ag.inicio))} – ${fmtHora(ag.fim)}</p>
              <p class="text-body-secondary mb-2">${icone("geo-alt", "me-1")}${esc(ag.local)}<br>${icone("person", "me-1")}${esc(ag.gestor)}</p>
              <p class="small text-body-secondary mb-0">Você recebe um lembrete 1 dia e 1 hora antes.</p>`
              : `<p class="text-body-secondary mb-0">Você será avisado assim que a coordenação responder.</p>`}</div>`,
          rodape: `<button class="btn btn-primary w-100" data-bs-dismiss="modal">Ver meus pedidos</button>`,
        });
        ir("meus");
      } catch (e) {
        falha(erroTexto(e));
        if (e.status === 409 && m.atendimento === "PRESENCIAL") await carregaHorarios();  // mantém a disciplina escolhida
      }
    });
  }
};

/* =====================================================================
   Coordenador: Agenda
   ===================================================================== */
VIEWS.agenda = async main => {
  const hoje = new Date(), fimSemana = new Date(); fimSemana.setDate(hoje.getDate() + 6);
  const [ags, pend, reservas] = await Promise.all([
    api("GET", `/api/agenda?inicio=${isoDia(hoje)}&fim=${isoDia(fimSemana)}&id_status=2`),
    api("GET", "/api/pendentes"), api("GET", "/api/reservas"),
  ]);
  const reunioes = ags.filter(a => a.inicio);
  const porDia = {};
  reunioes.forEach(a => (porDia[a.inicio.slice(0, 10)] ||= []).push(a));
  main.innerHTML = `<div>
  ${cabecalho("Agenda", "Reuniões confirmadas nos próximos 7 dias. Os alunos marcam direto nos horários da sua escala.",
    `<button class="btn btn-primary" id="b-reservar">${icone("calendar-x", "me-1")}Reservar horário</button>`)}
  <div class="row g-4">
    <section class="col-lg-7"><h2 class="h5 mb-3">Próximas reuniões <span class="badge text-bg-secondary">${reunioes.length}</span></h2>
      ${reunioes.length ? Object.entries(porDia).map(([d, lista]) => `
        <div class="sobretitulo mt-3 mb-2">${esc(fmtQuando(d + "T00:00").split(" às")[0])}</div>
        <div class="list-group shadow-sm">${lista.map(a => `<div class="list-group-item py-3">
          <div class="d-flex gap-3 align-items-start">
            <div class="text-center flex-shrink-0"><div class="data-grande">${fmtHora(a.inicio)}</div><div class="small text-body-secondary">até ${fmtHora(a.fim)}</div></div>
            <div class="flex-grow-1 min-w-0">
              <div class="fw-semibold">${esc(a.aluno.nome)} <span class="small text-body-secondary fw-normal">RA ${esc(a.aluno.ra)}</span></div>
              <div class="small">${esc(a.titulo)}${a.disciplina ? ` · ${esc(a.disciplina)}` : ""}</div>
              ${a.descricao ? `<div class="small text-body-secondary">${esc(a.descricao)}</div>` : ""}
              <span class="badge text-bg-light border mt-1">${esc(a.motivo)}</span>
            </div>
            <div class="dropdown"><button class="btn btn-sm btn-outline-secondary" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Ações">${icone("three-dots-vertical")}</button>
              <ul class="dropdown-menu dropdown-menu-end">
                ${a.aluno.whatsapp ? `<li><button class="dropdown-item" data-wpp="${a.id}">${icone("whatsapp", "me-2")}Responder no WhatsApp</button></li>` : ""}
                <li><button class="dropdown-item text-danger" data-canc="${a.id}">${icone("x-circle", "me-2")}Cancelar reunião</button></li></ul></div>
          </div></div>`).join("")}</div>`).join("") : vazio("calendar2", "Nenhuma reunião confirmada nos próximos 7 dias.")}
    </section>
    <section class="col-lg-5">
      <h2 class="h5 mb-1">Pedidos online <span class="badge text-bg-warning">${pend.length}</span></h2>
      <p class="small text-body-secondary">Ordenados por prazo, prioridade e chegada.</p>
      ${pend.length ? `<div class="list-group shadow-sm">${pend.map(a => `<div class="list-group-item py-3">
        <div class="d-flex gap-2"><h3 class="h6 mb-0 me-auto">${esc(a.titulo)}</h3>${a.prioridade === 1 ? `<span class="badge text-bg-danger">Prioridade alta</span>` : ""}</div>
        <div class="small text-body-secondary">${esc(a.aluno.nome)} · RA ${esc(a.aluno.ra)} · ${esc(a.motivo)}${a.disciplina ? " · " + esc(a.disciplina) : ""}</div>
        <div class="meta small mt-1"><span>Enviado ${esc(fmtQuando(a.criado_em))}</span>${a.data_limite ? `<span class="text-warning-emphasis">${icone("hourglass-split", "me-1")}prazo ${esc(fmtData(a.data_limite))}</span>` : ""}</div>
        ${a.anexos.map(x => `<div class="small mt-1">${icone("paperclip", "me-1")}${DEMO ? esc(x.arquivo) : `<a href="/api/anexos/${x.id}" target="_blank" rel="noopener">${esc(x.arquivo)}</a>`} <span class="text-body-secondary">(${esc(x.documento)})</span></div>`).join("")}
        <div class="d-flex flex-wrap gap-2 mt-2"><button class="btn btn-sm btn-success" data-dec="${a.id}" data-ok="1">${icone("check-lg", "me-1")}Aceitar</button>
          <button class="btn btn-sm btn-outline-danger" data-dec="${a.id}" data-ok="0">Recusar</button>
          ${a.aluno.whatsapp ? `<button class="btn btn-sm btn-outline-secondary" data-wpp="${a.id}">${icone("whatsapp", "me-1")}WhatsApp</button>` : ""}</div>
      </div>`).join("")}</div>` : vazio("check2-all", "Nenhum pedido aguardando resposta.")}
      <h2 class="h5 mt-4 mb-3">Minhas reservas</h2>
      ${reservas.length ? `<ul class="list-group shadow-sm">${reservas.map(r => `<li class="list-group-item d-flex align-items-center gap-2">
        <div class="me-auto"><div class="fw-semibold small">${esc(fmtQuando(r.inicio))} – ${fmtHora(r.fim)}</div><div class="small text-body-secondary">${esc(r.motivo || "")}</div></div>
        <button class="btn btn-sm btn-outline-secondary" data-rr="${r.id}" aria-label="Remover reserva">${icone("trash")}</button></li>`).join("")}</ul>`
        : `<p class="small text-body-secondary">Nenhuma reserva futura.</p>`}
    </section>
  </div></div>`;
  $("#b-reservar").addEventListener("click", reservar);
  $$("[data-canc]").forEach(b => b.addEventListener("click", () => cancelarGestor(Number(b.dataset.canc))));
  $$("[data-dec]").forEach(b => b.addEventListener("click", () => decidir(Number(b.dataset.dec), b.dataset.ok === "1")));
  $$("[data-wpp]").forEach(b => b.addEventListener("click", () => whatsapp(Number(b.dataset.wpp))));
  $$("[data-rr]").forEach(b => b.addEventListener("click", async () => { await api("DELETE", `/api/reservas/${b.dataset.rr}`); toast("Reserva removida."); render(); }));
};

function reservar() {
  const ini = new Date(); ini.setMinutes(ini.getMinutes() < 30 ? 30 : 60, 0, 0);
  const fim = new Date(ini.getTime() + 3600000);
  dialogo({
    titulo: "Reservar horário para mim",
    corpo: `<p class="text-body-secondary small">Nesse período os alunos não conseguem marcar. Serve para almoço, compromissos ou emergências.</p>
      <label for="r-mot" class="form-label">Motivo</label><select class="form-select mb-3" id="r-mot"><option>Almoço</option><option>Compromisso pessoal</option><option>Emergência médica</option><option>Reunião institucional</option></select>
      <div class="row g-2"><div class="col-sm-6"><label for="r-ini" class="form-label">Início</label><input class="form-control" type="datetime-local" id="r-ini" value="${isoLocal(ini)}"></div>
        <div class="col-sm-6"><label for="r-fim" class="form-label">Fim</label><input class="form-control" type="datetime-local" id="r-fim" value="${isoLocal(fim)}"></div></div>
      <div id="r-conf" class="alert alert-warning mt-3 mb-0" hidden></div>`,
    rodape: `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Voltar</button><button class="btn btn-primary" id="ok">Reservar</button>`,
    aoAbrir: (d, fechar) => {
      let confirmar = false;
      $("#ok", d).addEventListener("click", e => comCarregando(e.currentTarget, async () => {
        const corpo = { inicio: $("#r-ini", d).value, fim: $("#r-fim", d).value, motivo: $("#r-mot", d).value, confirmar };
        try {
          const r = await api("POST", "/api/reservas", corpo);
          fechar(); toast(r.canceladas ? `Reservado. ${r.canceladas} reunião(ões) cancelada(s) e aluno(s) avisado(s).` : "Horário reservado."); render();
        } catch (er) {
          if (er.status === 409 && er.detail?.reunioes) {
            confirmar = true;
            const c = $("#r-conf", d); c.hidden = false;
            c.innerHTML = `${icone("exclamation-triangle-fill", "me-1")}<b>${esc(er.detail.mensagem)}</b>
              <ul class="small my-2 ps-3">${er.detail.reunioes.map(x => `<li>${esc(fmtQuando(x.inicio))} · ${esc(x.aluno)}</li>`).join("")}</ul>
              <span class="small">Se continuar, elas serão canceladas e cada aluno receberá o motivo e um atalho para remarcar.</span>`;
            const ok = $("#ok", d); ok.classList.replace("btn-primary", "btn-danger");
            setTimeout(() => { ok.textContent = "Reservar e cancelar reuniões"; });
          } else toast(erroTexto(er), true);
        }
      }));
    },
  });
}

function cancelarGestor(id) {
  dialogo({
    titulo: "Cancelar esta reunião?",
    corpo: `<label for="cg-mot" class="form-label">Motivo (o aluno vai ver)</label><input class="form-control" id="cg-mot" maxlength="200" placeholder="Ex.: imprevisto">`,
    rodape: `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Voltar</button><button class="btn btn-danger" id="ok">Cancelar reunião</button>`,
    aoAbrir: (d, fechar) => $("#ok", d).addEventListener("click", e => comCarregando(e.currentTarget, async () => {
      try { await api("PATCH", `/api/agendamentos/${id}/cancelar`, { motivo: $("#cg-mot", d).value || null }); fechar(); toast("Reunião cancelada e aluno avisado."); render(); }
      catch (er) { toast(erroTexto(er), true); }
    })),
  });
}

function decidir(id, aceitar) {
  dialogo({
    titulo: aceitar ? "Aceitar pedido" : "Recusar pedido",
    corpo: `<label for="dc-obs" class="form-label">Observação ${aceitar ? "(opcional)" : "(motivo da recusa)"}</label><textarea class="form-control" id="dc-obs" maxlength="300" rows="3"></textarea>`,
    rodape: `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Voltar</button><button class="btn ${aceitar ? "btn-success" : "btn-danger"}" id="ok">${aceitar ? "Aceitar" : "Recusar"}</button>`,
    aoAbrir: (d, fechar) => $("#ok", d).addEventListener("click", e => comCarregando(e.currentTarget, async () => {
      try { await api("PATCH", `/api/agendamentos/${id}/decisao`, { aceitar, observacao: $("#dc-obs", d).value || null }); fechar(); toast(aceitar ? "Pedido aceito." : "Pedido recusado."); render(); }
      catch (er) { toast(erroTexto(er), true); }
    })),
  });
}

async function whatsapp(id) {
  try {
    const { link } = await api("GET", `/api/agendamentos/${id}/whatsapp`);
    if (!/^https:\/\/wa\.me\//.test(link)) throw { detail: "Link inválido." };
    dialogo({
      titulo: "Responder pelo WhatsApp",
      corpo: `<p class="text-body-secondary small">O link abre o WhatsApp com a mensagem pronta para você completar e enviar.</p>
        <a class="btn btn-success w-100" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icone("whatsapp", "me-2")}Abrir WhatsApp</a>`,
    });
  } catch (e) { toast(erroTexto(e), true); }
}

/* =====================================================================
   Coordenador: Reuniões (filtros)
   ===================================================================== */
VIEWS.reunioes = async main => {
  const motivos = await api("GET", "/api/motivos?todos=1");
  const ini = new Date(); ini.setDate(1);
  const fim = new Date(ini.getFullYear(), ini.getMonth() + 1, 0);
  main.innerHTML = `<div>
  ${cabecalho("Reuniões", "Consulte os atendimentos por período, status e motivo.")}
  <form class="card shadow-sm" id="f-filtro"><div class="card-body"><div class="row g-2 align-items-end">
    <div class="col-6 col-md-2"><label for="f-ini" class="form-label small">De</label><input class="form-control" type="date" id="f-ini" value="${isoDia(ini)}"></div>
    <div class="col-6 col-md-2"><label for="f-fim" class="form-label small">Até</label><input class="form-control" type="date" id="f-fim" value="${isoDia(fim)}"></div>
    <div class="col-6 col-md-2"><label for="f-st" class="form-label small">Status</label><select class="form-select" id="f-st"><option value="">Todos</option><option value="2">Confirmada</option><option value="1">Pendente</option><option value="5">Realizada</option><option value="4">Cancelada</option><option value="3">Recusada</option></select></div>
    <div class="col-6 col-md-2"><label for="f-mot" class="form-label small">Motivo</label><select class="form-select" id="f-mot"><option value="">Todos</option>${motivos.filter(m => m.destino === "COORDENACAO").map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join("")}</select></div>
    <div class="col-md-2"><label for="f-q" class="form-label small">Palavra-chave</label><input class="form-control" id="f-q" placeholder="Título ou descrição" maxlength="60"></div>
    <div class="col-md-2"><button class="btn btn-primary w-100" type="submit">${icone("funnel", "me-1")}Filtrar</button></div>
  </div></div></form>
  <div id="res" class="mt-3"></div></div>`;
  const busca = async () => {
    const p = new URLSearchParams({ inicio: $("#f-ini").value, fim: $("#f-fim").value });
    if ($("#f-st").value) p.set("id_status", $("#f-st").value);
    if ($("#f-mot").value) p.set("id_motivo", $("#f-mot").value);
    if ($("#f-q").value.trim()) p.set("q", $("#f-q").value.trim());
    const lista = await api("GET", "/api/agenda?" + p);
    $("#res").innerHTML = lista.length ? `<div class="card shadow-sm"><div class="card-body p-2 p-md-3"><table class="table table-hover align-middle mb-0 tabela-responsiva">
      <thead><tr><th>Quando</th><th>Aluno</th><th>Motivo</th><th>Assunto</th><th>Status</th><th></th></tr></thead><tbody>
      ${lista.map(a => `<tr>
        <td data-l="Quando">${a.inicio ? esc(fmtQuando(a.inicio)) : `Online · ${esc(fmtData(a.criado_em))}`}</td>
        <td data-l="Aluno">${esc(a.aluno.nome)}<div class="small text-body-secondary">RA ${esc(a.aluno.ra)}</div></td>
        <td data-l="Motivo">${esc(a.motivo)}${a.disciplina ? `<div class="small text-body-secondary">${esc(a.disciplina)}</div>` : ""}</td>
        <td data-l="Assunto">${esc(a.titulo)}${a.avaliacao ? `<div class="small text-body-secondary">${icone("star-fill", "text-warning me-1")}${a.avaliacao.nota}/10</div>` : ""}</td>
        <td>${statusBadge(a.status)}</td>
        <td class="text-end">${a.status === "Aprovada" && a.inicio && parse(a.inicio) <= new Date() ? `<button class="btn btn-sm btn-success" data-real="${a.id}">Marcar realizada</button>` : ""}</td>
      </tr>`).join("")}</tbody></table></div></div><p class="small text-body-secondary mt-2">${lista.length} resultado(s).</p>`
      : vazio("search", "Nada encontrado com esses filtros.");
    $$("[data-real]").forEach(b => b.addEventListener("click", async () => {
      try { await api("PATCH", `/api/agendamentos/${b.dataset.real}/realizada`); toast("Reunião concluída. O aluno foi convidado a avaliar."); busca(); }
      catch (e) { toast(erroTexto(e), true); }
    }));
  };
  $("#f-filtro").addEventListener("submit", e => { e.preventDefault(); busca(); });
  await busca();
};

/* =====================================================================
   Coordenador: Escala
   ===================================================================== */
VIEWS.escala = async main => {
  const [escalas, minhas, todas] = await Promise.all([api("GET", "/api/escalas"), api("GET", "/api/minhas-disciplinas"), api("GET", "/api/disciplinas")]);
  main.innerHTML = `<div>
  ${cabecalho("Escala de atendimento", "Os alunos só veem horários dentro destes blocos. Um intervalo fixo, como o almoço, vira dois blocos no mesmo dia.")}
  <div class="row row-cols-1 row-cols-sm-2 row-cols-lg-4 g-3">${[1, 2, 3, 4, 5, 6, 7].map(d => {
    const blocos = escalas.filter(e => e.dia_semana === d);
    return `<div class="col"><div class="card h-100 shadow-sm"><div class="card-header fw-semibold">${DIAS_LONGOS[d]}</div>
      ${blocos.length ? `<ul class="list-group list-group-flush">${blocos.map(e => `<li class="list-group-item d-flex align-items-center gap-2">
        <div class="me-auto"><div class="fw-semibold">${esc(e.hora_inicio)}–${esc(e.hora_fim)}</div><div class="small text-body-secondary">${esc(e.local)}</div></div>
        <button class="btn btn-sm btn-outline-secondary" data-del="${e.id}" aria-label="Remover bloco de ${DIAS_LONGOS[d]} ${esc(e.hora_inicio)}">${icone("trash")}</button></li>`).join("")}</ul>`
        : `<div class="card-body small text-body-secondary">Sem atendimento</div>`}</div></div>`;
  }).join("")}</div>
  <form class="card shadow-sm mt-4" id="f-esc"><div class="card-body"><h2 class="h5 mb-3">Adicionar bloco</h2><div class="row g-2 align-items-end">
    <div class="col-6 col-md-2"><label for="e-dia" class="form-label small">Dia</label><select class="form-select" id="e-dia">${[1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}">${DIAS_LONGOS[d]}</option>`).join("")}</select></div>
    <div class="col-3 col-md-2"><label for="e-ini" class="form-label small">Início</label><input class="form-control" type="time" id="e-ini" value="14:00" required></div>
    <div class="col-3 col-md-2"><label for="e-fim" class="form-label small">Fim</label><input class="form-control" type="time" id="e-fim" value="18:00" required></div>
    <div class="col-md-4"><label for="e-loc" class="form-label small">Local</label><input class="form-control" id="e-loc" maxlength="100" value="${esc(escalas[0]?.local || "Bloco A, 2º andar, sala 204")}" required></div>
    <div class="col-md-2"><button class="btn btn-primary w-100" type="submit">${icone("plus-lg", "me-1")}Adicionar</button></div></div></div></form>
  <section class="card shadow-sm mt-4"><div class="card-body"><h2 class="h5">Disciplinas que atendo</h2>
    <p class="small text-body-secondary">Limite definido pela coordenação: ${minhas.max ?? "sem limite"}.</p>
    <div class="row g-2">${todas.map(d => `<div class="col-sm-6 col-lg-3"><div class="form-check"><input class="form-check-input" type="checkbox" id="disc${d.id}" value="${d.id}" data-disc ${minhas.disciplinas.some(x => x.id === d.id) ? "checked" : ""}>
      <label class="form-check-label" for="disc${d.id}">${esc(d.nome)}</label></div></div>`).join("")}</div>
    <button class="btn btn-outline-primary mt-3" id="b-disc">Salvar disciplinas</button></div></section></div>`;
  $$("[data-del]").forEach(b => b.addEventListener("click", async () => { await api("DELETE", `/api/escalas/${b.dataset.del}`); toast("Bloco removido."); render(); }));
  $("#f-esc").addEventListener("submit", async e => {
    e.preventDefault();
    try { await api("POST", "/api/escalas", { dia_semana: Number($("#e-dia").value), hora_inicio: $("#e-ini").value, hora_fim: $("#e-fim").value, local: $("#e-loc").value.trim() }); toast("Bloco adicionado."); render(); }
    catch (er) { toast(erroTexto(er), true); }
  });
  $("#b-disc").addEventListener("click", e => comCarregando(e.currentTarget, async () => {
    try { await api("PUT", "/api/minhas-disciplinas", { ids: $$("[data-disc]:checked").map(i => Number(i.value)) }); toast("Disciplinas salvas."); }
    catch (er) { toast(erroTexto(er), true); }
  }));
};

/* =====================================================================
   Coordenador: Motivos
   ===================================================================== */
VIEWS.motivos = async main => {
  const [motivos, docs] = await Promise.all([api("GET", "/api/motivos?todos=1"), api("GET", "/api/documentos")]);
  const prio = { 1: ["Alta", "danger"], 2: ["Média", "warning"], 3: ["Baixa", "secondary"] };
  main.innerHTML = `<div>
  ${cabecalho("Motivos de contato", "Definem a duração da reunião, a prioridade e os documentos pedidos.",
    `<button class="btn btn-primary" id="b-novo">${icone("plus-lg", "me-1")}Novo motivo</button>`)}
  <div class="card shadow-sm"><div class="card-body p-2 p-md-3"><table class="table table-hover align-middle mb-0 tabela-responsiva">
    <thead><tr><th>Motivo</th><th>Destino</th><th>Atendimento</th><th>Prioridade</th><th>Documentos</th><th></th></tr></thead><tbody>
  ${motivos.map(m => `<tr>
    <td data-l="Motivo"><span class="fw-semibold">${esc(m.nome)}</span>${m.ativo ? "" : ` <span class="badge text-bg-secondary">inativo</span>`}${m.data_limite ? `<div class="small text-body-secondary">prazo ${esc(fmtData(m.data_limite))}</div>` : ""}</td>
    <td data-l="Destino">${m.destino === "SECRETARIA" ? "Secretaria" : "Coordenação"}</td>
    <td data-l="Atendimento">${m.atendimento === "ONLINE" ? "Online" : `Presencial · ${m.duracao_min} min`}</td>
    <td data-l="Prioridade"><span class="badge text-bg-${prio[m.prioridade][1]}">${prio[m.prioridade][0]}</span></td>
    <td data-l="Documentos" class="small">${m.documentos.map(d => esc(d.nome) + (d.obrigatorio ? " *" : "")).join(", ") || "—"}</td>
    <td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-ed="${m.id}">${icone("pencil", "me-1")}Editar</button></td></tr>`).join("")}
  </tbody></table><p class="small text-body-secondary mt-2 mb-0">* documento obrigatório</p></div></div></div>`;
  const form = m => dialogo({
    titulo: m ? "Editar motivo" : "Novo motivo", tamanho: "modal-lg",
    corpo: `<form id="f-mot" novalidate><div class="row g-3">
      <div class="col-12"><label for="m-nome" class="form-label">Nome</label><input class="form-control" id="m-nome" value="${esc(m?.nome || "")}" required maxlength="100"></div>
      <div class="col-sm-6"><label for="m-dest" class="form-label">Destino</label><select class="form-select" id="m-dest"><option value="COORDENACAO">Coordenação</option><option value="SECRETARIA">Secretaria</option></select></div>
      <div class="col-sm-6"><label for="m-at" class="form-label">Atendimento</label><select class="form-select" id="m-at"><option value="PRESENCIAL">Presencial</option><option value="ONLINE">Online (sem reunião)</option></select></div>
      <div class="col-sm-4"><label for="m-dur" class="form-label">Duração (min)</label><input class="form-control" type="number" id="m-dur" min="5" max="240" step="5" value="${m?.duracao_min ?? 30}"></div>
      <div class="col-sm-4"><label for="m-prio" class="form-label">Prioridade</label><select class="form-select" id="m-prio"><option value="1">Alta</option><option value="2">Média</option><option value="3">Baixa</option></select></div>
      <div class="col-sm-4"><label for="m-lim" class="form-label">Prazo limite</label><input class="form-control" type="date" id="m-lim" value="${esc(m?.data_limite || "")}"></div>
      <div class="col-12"><label for="m-ori" class="form-label">Orientação ao aluno</label><textarea class="form-control" id="m-ori" maxlength="300" rows="2">${esc(m?.orientacao || "")}</textarea></div>
      <div class="col-sm-6"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="m-disc" ${m?.exige_disciplina ? "checked" : ""}><label class="form-check-label" for="m-disc">Pedir a disciplina</label></div></div>
      <div class="col-sm-6"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="m-ativo" ${m?.ativo !== false ? "checked" : ""}><label class="form-check-label" for="m-ativo">Ativo</label></div></div>
      <div class="col-12"><h3 class="h6">Documentos</h3>${docs.map(d => { const sel = m?.documentos.find(x => x.id === d.id); return `
        <div class="d-flex align-items-center gap-3 py-1 border-bottom"><div class="form-check me-auto"><input class="form-check-input" type="checkbox" id="doc${d.id}" data-doc="${d.id}" ${sel ? "checked" : ""}><label class="form-check-label" for="doc${d.id}">${esc(d.nome)}</label></div>
          <div class="form-check"><input class="form-check-input" type="checkbox" id="obr${d.id}" data-obr="${d.id}" ${sel?.obrigatorio ? "checked" : ""}><label class="form-check-label small" for="obr${d.id}">obrigatório</label></div></div>`; }).join("")}</div>
    </div></form>`,
    rodape: `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Voltar</button><button class="btn btn-primary" id="ok">Salvar</button>`,
    aoAbrir: (d, fechar) => {
      if (m) { $("#m-dest", d).value = m.destino; $("#m-at", d).value = m.atendimento; $("#m-prio", d).value = m.prioridade; }
      const ajustaDuracao = () => { $("#m-dur", d).disabled = $("#m-at", d).value === "ONLINE"; };
      $("#m-at", d).addEventListener("change", ajustaDuracao); ajustaDuracao();
      $("#ok", d).addEventListener("click", e => comCarregando(e.currentTarget, async () => {
        const corpo = {
          nome: $("#m-nome", d).value.trim(), destino: $("#m-dest", d).value, atendimento: $("#m-at", d).value,
          duracao_min: $("#m-at", d).value === "ONLINE" ? null : Number($("#m-dur", d).value), prioridade: Number($("#m-prio", d).value),
          data_limite: $("#m-lim", d).value || null, orientacao: $("#m-ori", d).value || null, exige_disciplina: $("#m-disc", d).checked, ativo: $("#m-ativo", d).checked,
          documentos: $$("[data-doc]:checked", d).map(i => ({ id: Number(i.dataset.doc), obrigatorio: $(`[data-obr="${i.dataset.doc}"]`, d).checked })),
        };
        $("#m-nome", d).classList.toggle("is-invalid", corpo.nome.length < 3);
        if (corpo.nome.length < 3) return;
        try { await api(m ? "PUT" : "POST", m ? `/api/motivos/${m.id}` : "/api/motivos", corpo); fechar(); toast("Motivo salvo."); render(); }
        catch (er) { toast(erroTexto(er), true); }
      }));
    },
  });
  $("#b-novo").addEventListener("click", () => form(null));
  $$("[data-ed]").forEach(b => b.addEventListener("click", () => form(motivos.find(m => m.id === Number(b.dataset.ed)))));
};

/* =====================================================================
   Início
   ===================================================================== */
(async () => {
  aplicaTema(store.get("tema", "dark"));      // escuro por padrão
  aplicaFonte(Number(store.get("fonte", 16)));
  DEMO = await detectaModo();
  $("#faixa-demo").hidden = !DEMO;
  try { USER = await api("GET", "/api/me"); } catch { USER = null; }
  render();
})();
