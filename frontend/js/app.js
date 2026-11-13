"use strict";
/* =====================================================================
   Telas do sistema (rotas por hash) — Bootstrap 5.3 + IMask (máscaras)
   ===================================================================== */
let USER = null;

/* ---------- Preferências e acessibilidade ---------- */
function aplicaTema(t) {
  document.documentElement.dataset.bsTheme = t;
  $("#btn-tema").textContent = t === "dark" ? "Tema claro" : "Tema escuro";
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
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); b.setAttribute("aria-pressed", "false"); b.textContent = "Ouvir página"; return; }
  const fala = new SpeechSynthesisUtterance($("#conteudo").innerText.replace(/\s+/g, " ").slice(0, 4000));
  fala.lang = "pt-BR";
  fala.onend = () => { b.setAttribute("aria-pressed", "false"); b.textContent = "Ouvir página"; };
  b.setAttribute("aria-pressed", "true"); b.textContent = "Parar leitura";
  speechSynthesis.speak(fala);
});
$("#btn-sair").addEventListener("click", async () => {
  await api("POST", "/api/logout").catch(() => {});
  USER = null; ir("login");
});

/* ---------- Rotas ---------- */
const MENUS = {
  aluno: [["meus", "Meus pedidos"], ["nova", "Solicitar atendimento"]],
  coordenador: [["agenda", "Agenda"], ["reunioes", "Atendimentos"], ["escala", "Horários de atendimento"], ["motivos", "Motivos"]],
};
const VIEWS = {};
const CARREGANDO = `<div class="placeholder-glow" aria-busy="true"><span class="visually-hidden" role="status">Carregando…</span>
  <span class="placeholder col-3 placeholder-lg mb-4" aria-hidden="true"></span>
  <div class="painel" aria-hidden="true">${[1, 2, 3, 4].map(() => `<div class="p-3 border-bottom"><span class="placeholder col-8"></span></div>`).join("")}</div></div>`;
function ir(rota) { if (location.hash.slice(1) === rota) render(); else location.hash = rota; }

async function render() {
  speechSynthesis?.cancel?.();
  let rota = location.hash.slice(1) || "inicio";
  if (!USER && !["login", "cadastro"].includes(rota)) rota = "login";
  if (USER && ["login", "cadastro", "inicio"].includes(rota)) rota = USER.perfil === "aluno" ? "meus" : "agenda";
  if (USER && !MENUS[USER.perfil].some(([r]) => r === rota)) rota = MENUS[USER.perfil][0][0];

  $("#usuario").hidden = $("#nav").hidden = !USER;
  if (USER) {
    $("#usuario-nome").textContent = USER.nome;
    $("#usuario-perfil").textContent = USER.perfil === "aluno" ? "Aluno" : "Coordenação";
    $("#menu").innerHTML = MENUS[USER.perfil].map(([r, t]) =>
      `<li class="nav-item"><a href="#${r}" class="nav-link ${r === rota ? "active" : ""}" ${r === rota ? 'aria-current="page"' : ""}>${t}</a></li>`).join("");
  }
  const main = $("#conteudo");
  main.innerHTML = CARREGANDO;
  try { await VIEWS[rota](main); }
  catch (e) {
    if (e.status === 401) { USER = null; return ir("login"); }
    main.innerHTML = `<div class="alert alert-danger">${esc(erroTexto(e))}</div>`;
  }
  main.firstElementChild?.classList.add("entra");
  main.focus({ preventScroll: true });
}
window.addEventListener("hashchange", render);

const titulo = (texto, acao = "") => `<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
  <h1 class="titulo">${texto}</h1>${acao}</div>`;
const situacao = s => `<span class="situacao situacao-${esc(s)}">${esc({ Aprovada: "Confirmada" }[s] || s)}</span>`;
const linhaVazia = (colunas, texto) => `<tr><td colspan="${colunas}" class="vazia">${texto}</td></tr>`;

/* =====================================================================
   Acesso: login e cadastro
   ===================================================================== */
VIEWS.login = async main => {
  let perfil = store.get("perfil", "aluno");
  main.innerHTML = `
  <div class="tela-acesso mx-auto py-lg-4">
    <div class="painel">
      <div class="painel-cab pb-0 border-bottom-0">
        <ul class="nav nav-tabs" role="tablist">
          <li class="nav-item"><button type="button" class="nav-link" data-p="aluno" role="tab">Aluno</button></li>
          <li class="nav-item"><button type="button" class="nav-link" data-p="coordenador" role="tab">Coordenação</button></li>
        </ul>
      </div>
      <form class="painel-corpo" id="f-login" novalidate>
        <div class="mb-3"><label for="l-login" class="form-label" id="l-rot"></label>
          <input class="form-control" id="l-login" autocomplete="username" required maxlength="254"></div>
        <div class="mb-3"><label for="l-senha" class="form-label">Senha</label>
          <div class="input-group"><input class="form-control" id="l-senha" type="password" autocomplete="current-password" required maxlength="72">
            <button class="btn btn-outline-secondary" type="button" id="l-ver">Mostrar</button></div></div>
        <div id="l-erro" class="alert alert-danger py-2 small" role="alert" hidden></div>
        <button class="btn btn-primary w-100" type="submit">Entrar</button>
        <p class="small mt-3 mb-0" id="l-extra"></p>
      </form>
    </div>
    <p class="small text-body-secondary mt-3">Problemas para acessar? Procure a coordenação do seu curso.</p>
    ${DEMO ? `<div class="alert alert-secondary small">Demonstração: aluno <b>1234567</b> / <b>Aluno2026!</b> · coordenação <b>coordenacao@demo.edu</b> / <b>Coord2026!</b></div>` : ""}
  </div>`;
  const marca = () => {
    $$("[data-p]").forEach(b => { const a = b.dataset.p === perfil; b.classList.toggle("active", a); b.setAttribute("aria-selected", String(a)); });
    $("#l-rot").textContent = perfil === "aluno" ? "RA ou e-mail" : "E-mail institucional";
    $("#l-login").inputMode = perfil === "aluno" ? "text" : "email";
    $("#l-extra").innerHTML = perfil === "aluno" ? `Primeiro acesso? <a href="#cadastro">Cadastre-se</a>.` : "O acesso da coordenação é criado pela instituição.";
  };
  $$("[data-p]").forEach(b => b.addEventListener("click", () => { perfil = b.dataset.p; store.set("perfil", perfil); marca(); $("#l-login").focus(); }));
  marca();
  $("#l-ver").addEventListener("click", () => {
    const s = $("#l-senha"), ver = s.type === "password";
    s.type = ver ? "text" : "password";
    $("#l-ver").textContent = ver ? "Ocultar" : "Mostrar";
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
        setTimeout(() => $("#f-login")?.classList.remove("sacode"), 600);
      }
    });
  });
};
VIEWS.inicio = VIEWS.login;

VIEWS.cadastro = async main => {
  const cursos = await api("GET", "/api/cursos");
  main.innerHTML = `
  <div class="tela-acesso mx-auto">
    <form class="painel" id="f-cad" novalidate>
      <div class="painel-cab">Cadastro de aluno</div>
      <div class="painel-corpo">
        <div class="mb-3"><label for="c-nome" class="form-label">Nome completo</label><input class="form-control" id="c-nome" required maxlength="100" autocomplete="name">
          <div class="invalid-feedback">Informe o nome completo.</div></div>
        <div class="row g-3 mb-3">
          <div class="col-sm-5"><label for="c-ra" class="form-label">RA</label><input class="form-control" id="c-ra" required inputmode="numeric" maxlength="20">
            <div class="invalid-feedback">Mínimo de 4 números.</div></div>
          <div class="col-sm-7"><label for="c-cel" class="form-label">Celular <span class="text-body-secondary">(opcional)</span></label><input class="form-control" id="c-cel" inputmode="tel" autocomplete="tel-national" placeholder="(11) 99999-0000">
            <div class="invalid-feedback">Número incompleto.</div></div>
        </div>
        <div class="mb-3"><label for="c-email" class="form-label">E-mail</label><input class="form-control" id="c-email" type="email" required autocomplete="email" maxlength="254">
          <div class="invalid-feedback">E-mail inválido.</div></div>
        <div class="mb-3"><label for="c-curso" class="form-label">Curso</label><select class="form-select" id="c-curso">${cursos.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join("")}</select></div>
        <div class="mb-3"><label for="c-senha" class="form-label">Senha</label><input class="form-control" id="c-senha" type="password" minlength="8" maxlength="72" required autocomplete="new-password">
          <div class="form-text" id="c-forca">Mínimo de 8 caracteres, com letras e números.</div></div>
        <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="c-wpp"><label class="form-check-label small" for="c-wpp">Aceito receber respostas da coordenação por WhatsApp.</label></div>
        <div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="c-lgpd"><label class="form-check-label small" for="c-lgpd">Autorizo o uso do meu nome, RA, e-mail e curso apenas para o agendamento de atendimentos (LGPD).</label>
          <div class="invalid-feedback">Obrigatório para o cadastro.</div></div>
        <div id="c-erro" class="alert alert-danger py-2 small" role="alert" hidden></div>
        <div class="d-flex gap-2"><a class="btn btn-outline-secondary" href="#login">Voltar</a><button class="btn btn-primary flex-grow-1" type="submit">Cadastrar</button></div>
      </div>
    </form>
  </div>`;
  const ra = Mascaras.ra($("#c-ra")), cel = Mascaras.celular($("#c-cel"));
  Mascaras.email($("#c-email"));
  const senhaOk = v => v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v);
  $("#f-cad").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("#c-erro");
    const campos = { "c-nome": $("#c-nome").value.trim().length >= 3, "c-ra": ra.unmaskedValue.length >= 4,
      "c-email": $("#c-email").checkValidity() && $("#c-email").value, "c-senha": senhaOk($("#c-senha").value),
      "c-cel": !cel.unmaskedValue || cel.unmaskedValue.length === 11, "c-lgpd": $("#c-lgpd").checked };
    Object.entries(campos).forEach(([id, ok]) => $("#" + id).classList.toggle("is-invalid", !ok));
    $("#c-forca").classList.toggle("text-danger", !campos["c-senha"]);
    if (Object.values(campos).some(ok => !ok)) { $(".is-invalid", e.target).focus(); return mostraErro(err, "Corrija os campos indicados."); }
    await comCarregando($("button[type=submit]", e.target), async () => {
      try {
        USER = await api("POST", "/api/alunos", {
          nome: $("#c-nome").value.trim(), ra: ra.unmaskedValue, email: $("#c-email").value.trim().toLowerCase(),
          id_curso: Number($("#c-curso").value), senha: $("#c-senha").value, celular: cel.unmaskedValue || null,
          aceita_whatsapp: $("#c-wpp").checked, aceite_lgpd: true,
        });
        toast("Cadastro concluído."); ir("meus");
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
  ${titulo("Meus pedidos", `<a class="btn btn-primary" href="#nova">Solicitar atendimento</a>`)}
  ${novas.length ? `<div class="alert alert-info py-2" role="status">
    <div class="d-flex flex-wrap gap-2"><b class="me-auto">Avisos (${novas.length})</b><button class="btn btn-link btn-sm p-0" id="b-lidas">Marcar como lidos</button></div>
    <ul class="small mb-0 mt-1 ps-3">${novas.map(n => `<li>${esc(n.mensagem)}</li>`).join("")}</ul></div>` : ""}
  ${proxima ? `<section class="painel mb-4" aria-labelledby="t-prox">
    <div class="painel-cab" id="t-prox">Próximo atendimento</div>
    <dl class="dados painel-corpo">
      <dt>Data</dt><dd class="fw-semibold">${esc(fmtQuando(proxima.inicio))} até ${fmtHora(proxima.fim)}</dd>
      <dt>Local</dt><dd>${esc(proxima.local)}</dd>
      <dt>Atendimento com</dt><dd>${esc(proxima.gestor)}</dd>
      <dt>Assunto</dt><dd>${esc(proxima.titulo)} <span class="text-body-secondary">(${esc(proxima.motivo)})</span></dd>
    </dl></section>` : ""}
  <div class="d-flex flex-wrap align-items-end gap-2 mb-2"><h2 class="subtitulo me-auto mb-0">Histórico</h2>
    <input class="form-control form-control-sm w-auto" id="busca" type="search" placeholder="Buscar por título ou descrição" aria-label="Buscar no histórico" maxlength="60"></div>
  <div class="painel"><table class="table tabela tabela-responsiva align-middle">
    <thead><tr><th>Data</th><th>Assunto</th><th>Motivo</th><th>Situação</th><th></th></tr></thead><tbody id="lista"></tbody></table></div></div>`;

  const desenha = lista => {
    $("#lista").innerHTML = lista.length ? lista.map(a => `<tr>
      <td data-l="Data">${a.inicio ? esc(fmtQuando(a.inicio)) : `Enviado em ${esc(fmtData(a.criado_em))}`}${a.local ? `<div class="small text-body-secondary">${esc(a.local)}</div>` : ""}</td>
      <td data-l="Assunto">${esc(a.titulo)}
        ${a.anexos.length ? `<div class="small text-body-secondary">Anexos: ${a.anexos.map(x => esc(x.arquivo)).join(", ")}</div>` : ""}
        ${a.observacao ? `<div class="small text-body-secondary">Obs.: ${esc(a.observacao)}</div>` : ""}
        ${a.avaliacao ? `<div class="small text-body-secondary">Sua avaliação: ${a.avaliacao.nota}/10</div>` : ""}</td>
      <td data-l="Motivo">${esc(a.motivo)}${a.disciplina ? `<div class="small text-body-secondary">${esc(a.disciplina)}</div>` : ""}</td>
      <td data-l="Situação">${situacao(a.status)}</td>
      <td class="text-md-end text-nowrap">
        ${["Pendente", "Aprovada"].includes(a.status) && (!a.inicio || parse(a.inicio) > new Date()) ? `<button class="btn btn-sm btn-outline-danger" data-cancelar="${a.id}">Cancelar</button>` : ""}
        ${a.status === "Realizada" && !a.avaliacao ? `<button class="btn btn-sm btn-outline-primary" data-avaliar="${a.id}">Avaliar</button>` : ""}
        ${a.status === "Cancelada" && a.cancelado_por === "GESTOR" ? `<a class="btn btn-sm btn-outline-primary" href="#nova">Remarcar</a>` : ""}
      </td></tr>`).join("") : linhaVazia(5, "Nenhum pedido encontrado.");
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
    titulo: "Cancelar pedido",
    corpo: `<p class="mb-0">Confirma o cancelamento? O horário será liberado para outros alunos.</p>`,
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
    titulo: "Avaliar atendimento",
    corpo: `<p>De 1 a 10, que nota você dá para o atendimento?</p>
      <div class="notas mb-3" role="radiogroup" aria-label="Nota">${[...Array(10)].map((_, i) => `
        <input type="radio" class="btn-check" name="nota" id="n${i + 1}" value="${i + 1}"><label class="btn btn-outline-primary" for="n${i + 1}">${i + 1}</label>`).join("")}</div>
      <label for="av-com" class="form-label">Comentário <span class="text-body-secondary">(opcional)</span></label><textarea class="form-control" id="av-com" maxlength="500" rows="3"></textarea>`,
    rodape: `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Agora não</button><button class="btn btn-primary" id="ok" disabled>Enviar</button>`,
    aoAbrir: (d, fechar) => {
      $$("[name=nota]", d).forEach(r => r.addEventListener("change", () => { nota = Number(r.value); $("#ok", d).disabled = false; }));
      $("#ok", d).addEventListener("click", e => comCarregando(e.currentTarget, async () => {
        try { await api("POST", `/api/agendamentos/${id}/avaliacao`, { nota, comentario: $("#av-com", d).value || null }); fechar(); toast("Avaliação registrada."); render(); }
        catch (er) { toast(erroTexto(er), true); }
      }));
    },
  });
}

/* =====================================================================
   Aluno: Solicitar atendimento (assunto → detalhes → data e horário)
   ===================================================================== */
VIEWS.nova = async main => {
  const [motivos, disciplinas] = await Promise.all([api("GET", "/api/motivos"), api("GET", "/api/disciplinas")]);
  const s = { motivo: null, dia: null, horario: null, livres: [] };
  const detalhe = m => m.destino === "SECRETARIA" ? "Tratado pela secretaria acadêmica"
    : m.atendimento === "ONLINE" ? "Online, sem reunião: envio de documento" : `Reunião presencial de ${m.duracao_min} minutos`;
  main.innerHTML = `<div>
  ${titulo("Solicitar atendimento")}
  <div class="painel"><div class="painel-corpo">
    <fieldset class="secao-form"><legend>1. Assunto</legend>
      <div role="radiogroup" aria-label="Assunto">${motivos.map(m => `
        <div class="form-check opcao-motivo"><input class="form-check-input" type="radio" name="motivo" id="m${m.id}" value="${m.id}">
          <label class="form-check-label w-100" for="m${m.id}">${esc(m.nome)}<small>${detalhe(m)}</small></label></div>`).join("")}
      </div></fieldset>
    <div id="resto"></div>
  </div></div></div>`;
  $$("[name=motivo]").forEach(r => r.addEventListener("change", () => {
    s.motivo = motivos.find(m => m.id === Number(r.value)); s.dia = s.horario = null;
    desenhaResto();
  }));

  async function desenhaResto() {
    const m = s.motivo, resto = $("#resto");
    if (m.destino === "SECRETARIA") {
      resto.innerHTML = `<div class="alert alert-warning mb-0 entra" role="alert"><b>Este assunto não é atendido pela coordenação.</b><br>${esc(m.orientacao || "Procure a secretaria acadêmica.")}</div>`;
      return;
    }
    const docs = m.documentos || [];
    resto.innerHTML = `<div class="entra">
    <fieldset class="secao-form"><legend>2. Detalhes</legend>
      ${m.orientacao ? `<p class="small">${esc(m.orientacao)}</p>` : ""}
      <div class="row g-3">
        ${m.exige_disciplina ? `<div class="col-md-6"><label for="n-disc" class="form-label">Disciplina</label>
          <select class="form-select" id="n-disc"><option value="">Selecione</option>${disciplinas.map(d => `<option value="${d.id}">${esc(d.nome)}</option>`).join("")}</select></div>` : ""}
        <div class="col-md-6"><label for="n-tit" class="form-label">Título</label><input class="form-control" id="n-tit" maxlength="100" placeholder="Ex.: Nota da AV1 não lançada"></div>
        <div class="col-12"><label for="n-desc" class="form-label">Descrição <span class="text-body-secondary">(opcional)</span></label>
          <textarea class="form-control" id="n-desc" maxlength="500" rows="3"></textarea>
          <div class="form-text text-end" id="n-cont">0/500</div></div>
        ${docs.map(d => `<div class="col-md-6"><label for="doc-${d.id}" class="form-label">${esc(d.nome)} <span class="text-body-secondary">(${d.obrigatorio ? "obrigatório" : "opcional"})</span></label>
          <input class="form-control" type="file" id="doc-${d.id}" data-doc="${d.id}" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"></div>`).join("")}
      </div>
      ${docs.length ? `<div class="form-text">Arquivos PDF, JPG ou PNG de até 5 MB.</div>` : ""}
    </fieldset>
    ${m.atendimento === "PRESENCIAL" ? `<fieldset class="secao-form"><legend>3. Data e horário</legend>
      <p class="small text-body-secondary" id="h-info">Carregando horários…</p>
      <div class="dias mb-3" id="dias" role="radiogroup" aria-label="Dia"></div><div class="slots" id="slots" role="radiogroup" aria-label="Horário"></div>
    </fieldset>` : ""}
    <div id="h-erro" class="alert alert-danger" role="alert" hidden></div>
    <div class="d-flex flex-wrap align-items-center gap-3 border-top pt-3">
      <span class="small text-body-secondary me-auto" id="resumo"></span>
      <button class="btn btn-primary" id="enviar">${m.atendimento === "ONLINE" ? "Enviar pedido" : "Confirmar agendamento"}</button></div></div>`;
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
    $("#h-info").textContent = s.livres.length ? "Horários disponíveis a partir de 24 horas de antecedência."
      : "Não há horários disponíveis nos próximos dias.";
    $("#dias").innerHTML = s.livres.map(d => { const x = parse(d.data); return `
      <input type="radio" class="btn-check" name="dia" id="d${d.data}" value="${d.data}" ${d.data === s.dia ? "checked" : ""}>
      <label class="btn btn-outline-primary" for="d${d.data}">${SEMANA[x.getDay()]}<b>${pad(x.getDate())}</b>${pad(x.getMonth() + 1)}/${String(x.getFullYear()).slice(2)}</label>`; }).join("");
    const dia = s.livres.find(d => d.data === s.dia);
    $("#slots").innerHTML = dia ? dia.horarios.map((h, i) => `
      <input type="radio" class="btn-check" name="slot" id="s${i}" value="${i}" ${s.horario === h ? "checked" : ""}>
      <label class="btn btn-outline-secondary" for="s${i}">${fmtHora(h.inicio)}</label>`).join("") : "";
    $$("[name=dia]").forEach(r => r.addEventListener("change", () => { s.dia = r.value; s.horario = null; desenhaHorarios(); }));
    $$("[name=slot]").forEach(r => r.addEventListener("change", () => { s.horario = dia.horarios[Number(r.value)]; resumo(); }));
    resumo();
  }

  function resumo() {
    const h = s.horario;
    $("#resumo").textContent = h ? `${fmtQuando(h.inicio)} até ${fmtHora(h.fim)} · ${h.local} · ${h.gestor}` : "";
  }

  async function enviar() {
    const m = s.motivo, err = $("#h-erro");
    const falha = t => mostraErro(err, t);
    const tit = $("#n-tit").value.trim();
    $("#n-disc")?.classList.toggle("is-invalid", m.exige_disciplina && !$("#n-disc").value);
    $("#n-tit").classList.toggle("is-invalid", tit.length < 3);
    if (m.exige_disciplina && !$("#n-disc").value) return falha("Selecione a disciplina.");
    if (tit.length < 3) return falha("Informe um título com pelo menos 3 letras.");
    const fd = new FormData();
    fd.append("id_motivo", m.id); fd.append("titulo", tit);
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
      if (!s.horario) return falha("Selecione um horário.");
      fd.append("inicio", s.horario.inicio); fd.append("id_gestor", s.horario.gestor_id);
    }
    falha("");
    await comCarregando($("#enviar"), async () => {
      try {
        const ag = await api("POST", "/api/agendamentos", fd);
        const ok = ag.status === "Aprovada";
        dialogo({
          titulo: ok ? "Atendimento agendado" : "Pedido enviado",
          corpo: ag.inicio ? `<dl class="dados">
              <dt>Data</dt><dd class="fw-semibold">${esc(fmtQuando(ag.inicio))} até ${fmtHora(ag.fim)}</dd>
              <dt>Local</dt><dd>${esc(ag.local)}</dd><dt>Atendimento com</dt><dd>${esc(ag.gestor)}</dd></dl>
              <p class="small text-body-secondary mt-3 mb-0">Você receberá um lembrete um dia antes e uma hora antes.</p>`
            : `<p class="mb-0">Seu pedido foi registrado. Você será avisado quando a coordenação responder.</p>`,
          rodape: `<button class="btn btn-primary" data-bs-dismiss="modal">OK</button>`,
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
  const diaLongo = d => { const x = parse(d); return `${DIAS_LONGOS[x.getDay() || 7]}, ${pad(x.getDate())}/${pad(x.getMonth() + 1)}`; };
  main.innerHTML = `<div>
  ${titulo("Agenda", `<button class="btn btn-outline-primary" id="b-reservar">Bloquear horário</button>`)}
  <div class="row g-4">
    <section class="col-xl-8"><h2 class="subtitulo">Próximos 7 dias <span class="text-body-secondary fw-normal">(${reunioes.length} atendimento${reunioes.length === 1 ? "" : "s"})</span></h2>
      <div class="painel"><table class="table tabela tabela-responsiva align-middle">
        <thead><tr><th>Horário</th><th>Aluno</th><th>Assunto</th><th></th></tr></thead><tbody>
        ${reunioes.length ? Object.entries(porDia).map(([d, lista]) => `
          <tr class="grupo"><th colspan="4">${esc(diaLongo(d))}</th></tr>
          ${lista.map(a => `<tr>
            <td data-l="Horário" class="text-nowrap fw-semibold">${fmtHora(a.inicio)}–${fmtHora(a.fim)}</td>
            <td data-l="Aluno">${esc(a.aluno.nome)}<div class="small text-body-secondary">RA ${esc(a.aluno.ra)}</div></td>
            <td data-l="Assunto">${esc(a.titulo)}<div class="small text-body-secondary">${esc(a.motivo)}${a.disciplina ? ` · ${esc(a.disciplina)}` : ""}</div>
              ${a.descricao ? `<div class="small text-body-secondary">${esc(a.descricao)}</div>` : ""}</td>
            <td class="text-md-end text-nowrap">
              ${a.aluno.whatsapp ? `<button class="btn btn-sm btn-outline-secondary" data-wpp="${a.id}">WhatsApp</button>` : ""}
              <button class="btn btn-sm btn-outline-danger" data-canc="${a.id}">Cancelar</button></td>
          </tr>`).join("")}`).join("") : linhaVazia(4, "Nenhum atendimento agendado nos próximos 7 dias.")}
        </tbody></table></div>
    </section>
    <aside class="col-xl-4">
      <h2 class="subtitulo">Pedidos online <span class="text-body-secondary fw-normal">(${pend.length})</span></h2>
      <div class="painel mb-4">${pend.length ? pend.map((a, i) => `<div class="p-3 ${i ? "border-top" : ""}">
        <div class="fw-semibold">${esc(a.titulo)}${a.prioridade === 1 ? ` <span class="badge text-bg-danger fw-normal">prioridade alta</span>` : ""}</div>
        <div class="small text-body-secondary">${esc(a.aluno.nome)} · RA ${esc(a.aluno.ra)}<br>${esc(a.motivo)}${a.disciplina ? " · " + esc(a.disciplina) : ""}</div>
        <div class="small text-body-secondary">Enviado em ${esc(fmtData(a.criado_em))}${a.data_limite ? ` · prazo ${esc(fmtData(a.data_limite))}` : ""}</div>
        ${a.anexos.map(x => `<div class="small">${DEMO ? esc(x.arquivo) : `<a href="/api/anexos/${x.id}" target="_blank" rel="noopener">${esc(x.arquivo)}</a>`} <span class="text-body-secondary">(${esc(x.documento)})</span></div>`).join("")}
        <div class="d-flex flex-wrap gap-2 mt-2"><button class="btn btn-sm btn-success" data-dec="${a.id}" data-ok="1">Aceitar</button>
          <button class="btn btn-sm btn-outline-danger" data-dec="${a.id}" data-ok="0">Recusar</button>
          ${a.aluno.whatsapp ? `<button class="btn btn-sm btn-outline-secondary" data-wpp="${a.id}">WhatsApp</button>` : ""}</div>
      </div>`).join("") : `<p class="p-3 mb-0 small text-body-secondary">Nenhum pedido aguardando resposta.</p>`}</div>
      <h2 class="subtitulo">Horários bloqueados</h2>
      <div class="painel">${reservas.length ? reservas.map((r, i) => `<div class="d-flex align-items-center gap-2 px-3 py-2 ${i ? "border-top" : ""}">
        <div class="me-auto small"><div class="fw-semibold">${esc(fmtQuando(r.inicio))}–${fmtHora(r.fim)}</div><div class="text-body-secondary">${esc(r.motivo || "")}</div></div>
        <button class="btn btn-sm btn-link text-danger" data-rr="${r.id}">Remover</button></div>`).join("")
        : `<p class="p-3 mb-0 small text-body-secondary">Nenhum bloqueio futuro.</p>`}</div>
    </aside>
  </div></div>`;
  $("#b-reservar").addEventListener("click", reservar);
  $$("[data-canc]").forEach(b => b.addEventListener("click", () => cancelarGestor(Number(b.dataset.canc))));
  $$("[data-dec]").forEach(b => b.addEventListener("click", () => decidir(Number(b.dataset.dec), b.dataset.ok === "1")));
  $$("[data-wpp]").forEach(b => b.addEventListener("click", () => whatsapp(Number(b.dataset.wpp))));
  $$("[data-rr]").forEach(b => b.addEventListener("click", async () => { await api("DELETE", `/api/reservas/${b.dataset.rr}`); toast("Bloqueio removido."); render(); }));
};

function reservar() {
  const ini = new Date(); ini.setMinutes(ini.getMinutes() < 30 ? 30 : 60, 0, 0);
  const fim = new Date(ini.getTime() + 3600000);
  dialogo({
    titulo: "Bloquear horário",
    corpo: `<p class="small text-body-secondary">No período bloqueado os alunos não conseguem agendar.</p>
      <label for="r-mot" class="form-label">Motivo</label><select class="form-select mb-3" id="r-mot"><option>Almoço</option><option>Compromisso pessoal</option><option>Emergência médica</option><option>Reunião institucional</option></select>
      <div class="row g-2"><div class="col-sm-6"><label for="r-ini" class="form-label">Início</label><input class="form-control" type="datetime-local" id="r-ini" value="${isoLocal(ini)}"></div>
        <div class="col-sm-6"><label for="r-fim" class="form-label">Fim</label><input class="form-control" type="datetime-local" id="r-fim" value="${isoLocal(fim)}"></div></div>
      <div id="r-conf" class="alert alert-warning mt-3 mb-0" hidden></div>`,
    rodape: `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Voltar</button><button class="btn btn-primary" id="ok">Bloquear</button>`,
    aoAbrir: (d, fechar) => {
      let confirmar = false;
      $("#ok", d).addEventListener("click", e => comCarregando(e.currentTarget, async () => {
        const corpo = { inicio: $("#r-ini", d).value, fim: $("#r-fim", d).value, motivo: $("#r-mot", d).value, confirmar };
        try {
          const r = await api("POST", "/api/reservas", corpo);
          fechar(); toast(r.canceladas ? `Horário bloqueado. ${r.canceladas} atendimento(s) cancelado(s); os alunos foram avisados.` : "Horário bloqueado."); render();
        } catch (er) {
          if (er.status === 409 && er.detail?.reunioes) {
            confirmar = true;
            const c = $("#r-conf", d); c.hidden = false;
            c.innerHTML = `<b>${esc(er.detail.mensagem)}</b>
              <ul class="small my-2 ps-3">${er.detail.reunioes.map(x => `<li>${esc(fmtQuando(x.inicio))} · ${esc(x.aluno)}</li>`).join("")}</ul>
              <span class="small">Ao confirmar, esses atendimentos serão cancelados e os alunos avisados para remarcar.</span>`;
            const ok = $("#ok", d); ok.classList.replace("btn-primary", "btn-danger");
            setTimeout(() => { ok.textContent = "Bloquear e cancelar atendimentos"; });
          } else toast(erroTexto(er), true);
        }
      }));
    },
  });
}

function cancelarGestor(id) {
  dialogo({
    titulo: "Cancelar atendimento",
    corpo: `<label for="cg-mot" class="form-label">Motivo (será enviado ao aluno)</label><input class="form-control" id="cg-mot" maxlength="200" placeholder="Ex.: imprevisto">`,
    rodape: `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Voltar</button><button class="btn btn-danger" id="ok">Cancelar atendimento</button>`,
    aoAbrir: (d, fechar) => $("#ok", d).addEventListener("click", e => comCarregando(e.currentTarget, async () => {
      try { await api("PATCH", `/api/agendamentos/${id}/cancelar`, { motivo: $("#cg-mot", d).value || null }); fechar(); toast("Atendimento cancelado; o aluno foi avisado."); render(); }
      catch (er) { toast(erroTexto(er), true); }
    })),
  });
}

function decidir(id, aceitar) {
  dialogo({
    titulo: aceitar ? "Aceitar pedido" : "Recusar pedido",
    corpo: `<label for="dc-obs" class="form-label">${aceitar ? "Observação (opcional)" : "Motivo da recusa"}</label><textarea class="form-control" id="dc-obs" maxlength="300" rows="3"></textarea>`,
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
      corpo: `<p class="small">O WhatsApp abre com o início da mensagem preenchido; complete e envie.</p>
        <a class="btn btn-success w-100" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>`,
    });
  } catch (e) { toast(erroTexto(e), true); }
}

/* =====================================================================
   Coordenador: Atendimentos (consulta com filtros)
   ===================================================================== */
VIEWS.reunioes = async main => {
  const motivos = await api("GET", "/api/motivos?todos=1");
  const ini = new Date(); ini.setDate(1);
  const fim = new Date(ini.getFullYear(), ini.getMonth() + 1, 0);
  main.innerHTML = `<div>
  ${titulo("Atendimentos")}
  <form class="painel painel-corpo mb-3" id="f-filtro"><div class="row g-2 align-items-end">
    <div class="col-6 col-md-2"><label for="f-ini" class="form-label small mb-1">De</label><input class="form-control" type="date" id="f-ini" value="${isoDia(ini)}"></div>
    <div class="col-6 col-md-2"><label for="f-fim" class="form-label small mb-1">Até</label><input class="form-control" type="date" id="f-fim" value="${isoDia(fim)}"></div>
    <div class="col-6 col-md-2"><label for="f-st" class="form-label small mb-1">Situação</label><select class="form-select" id="f-st"><option value="">Todas</option><option value="2">Confirmada</option><option value="1">Pendente</option><option value="5">Realizada</option><option value="4">Cancelada</option><option value="3">Recusada</option></select></div>
    <div class="col-6 col-md-2"><label for="f-mot" class="form-label small mb-1">Motivo</label><select class="form-select" id="f-mot"><option value="">Todos</option>${motivos.filter(m => m.destino === "COORDENACAO").map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join("")}</select></div>
    <div class="col-md-2"><label for="f-q" class="form-label small mb-1">Palavra-chave</label><input class="form-control" id="f-q" maxlength="60"></div>
    <div class="col-md-2"><button class="btn btn-primary w-100" type="submit">Pesquisar</button></div>
  </div></form>
  <div id="res"></div></div>`;
  const busca = async () => {
    const p = new URLSearchParams({ inicio: $("#f-ini").value, fim: $("#f-fim").value });
    if ($("#f-st").value) p.set("id_status", $("#f-st").value);
    if ($("#f-mot").value) p.set("id_motivo", $("#f-mot").value);
    if ($("#f-q").value.trim()) p.set("q", $("#f-q").value.trim());
    const lista = await api("GET", "/api/agenda?" + p);
    $("#res").innerHTML = `<div class="painel"><table class="table tabela tabela-responsiva align-middle">
      <thead><tr><th>Data</th><th>Aluno</th><th>Motivo</th><th>Assunto</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.length ? lista.map(a => `<tr>
        <td data-l="Data" class="text-nowrap">${a.inicio ? esc(fmtQuando(a.inicio)) : `Online · ${esc(fmtData(a.criado_em))}`}</td>
        <td data-l="Aluno">${esc(a.aluno.nome)}<div class="small text-body-secondary">RA ${esc(a.aluno.ra)}</div></td>
        <td data-l="Motivo">${esc(a.motivo)}${a.disciplina ? `<div class="small text-body-secondary">${esc(a.disciplina)}</div>` : ""}</td>
        <td data-l="Assunto">${esc(a.titulo)}${a.avaliacao ? `<div class="small text-body-secondary">Avaliação: ${a.avaliacao.nota}/10</div>` : ""}</td>
        <td data-l="Situação">${situacao(a.status)}</td>
        <td class="text-md-end">${a.status === "Aprovada" && a.inicio && parse(a.inicio) <= new Date() ? `<button class="btn btn-sm btn-outline-success text-nowrap" data-real="${a.id}">Marcar realizado</button>` : ""}</td>
      </tr>`).join("") : linhaVazia(6, "Nenhum atendimento encontrado com esses filtros.")}</tbody></table></div>
      ${lista.length ? `<p class="small text-body-secondary mt-2">${lista.length} registro(s).</p>` : ""}`;
    $$("[data-real]").forEach(b => b.addEventListener("click", async () => {
      try { await api("PATCH", `/api/agendamentos/${b.dataset.real}/realizada`); toast("Atendimento marcado como realizado."); busca(); }
      catch (e) { toast(erroTexto(e), true); }
    }));
  };
  $("#f-filtro").addEventListener("submit", e => { e.preventDefault(); busca(); });
  await busca();
};

/* =====================================================================
   Coordenador: Horários de atendimento (escala semanal)
   ===================================================================== */
VIEWS.escala = async main => {
  const [escalas, minhas, todas] = await Promise.all([api("GET", "/api/escalas"), api("GET", "/api/minhas-disciplinas"), api("GET", "/api/disciplinas")]);
  main.innerHTML = `<div>
  ${titulo("Horários de atendimento")}
  <p class="text-body-secondary small">Os alunos só podem agendar dentro destes horários. Para um intervalo fixo, como o almoço, cadastre dois períodos no mesmo dia.</p>
  <div class="row g-4">
    <section class="col-lg-7">
      <div class="painel mb-3"><table class="table tabela tabela-responsiva align-middle">
        <thead><tr><th>Dia</th><th>Período</th><th>Local</th><th></th></tr></thead><tbody>
        ${escalas.length ? escalas.map(e => `<tr>
          <td data-l="Dia">${DIAS_LONGOS[e.dia_semana]}</td><td data-l="Período" class="text-nowrap">${esc(e.hora_inicio)} às ${esc(e.hora_fim)}</td>
          <td data-l="Local">${esc(e.local)}</td>
          <td class="text-md-end"><button class="btn btn-sm btn-link text-danger" data-del="${e.id}" aria-label="Remover ${DIAS_LONGOS[e.dia_semana]} ${esc(e.hora_inicio)}">Remover</button></td></tr>`).join("")
          : linhaVazia(4, "Nenhum horário cadastrado.")}
        </tbody></table></div>
      <form class="painel" id="f-esc"><div class="painel-cab">Incluir período</div><div class="painel-corpo"><div class="row g-2 align-items-end">
        <div class="col-6 col-md-3"><label for="e-dia" class="form-label small mb-1">Dia</label><select class="form-select" id="e-dia">${[1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}">${DIAS_LONGOS[d]}</option>`).join("")}</select></div>
        <div class="col-3 col-md-2"><label for="e-ini" class="form-label small mb-1">Início</label><input class="form-control" type="time" id="e-ini" value="14:00" required></div>
        <div class="col-3 col-md-2"><label for="e-fim" class="form-label small mb-1">Fim</label><input class="form-control" type="time" id="e-fim" value="18:00" required></div>
        <div class="col-md-3"><label for="e-loc" class="form-label small mb-1">Local</label><input class="form-control" id="e-loc" maxlength="100" value="${esc(escalas[0]?.local || "")}" required></div>
        <div class="col-md-2"><button class="btn btn-primary w-100" type="submit">Incluir</button></div></div></div></form>
    </section>
    <section class="col-lg-5">
      <div class="painel"><div class="painel-cab">Disciplinas atendidas</div><div class="painel-corpo">
        <p class="small text-body-secondary">Limite definido pela coordenação: ${minhas.max ?? "sem limite"}.</p>
        ${todas.map(d => `<div class="form-check mb-1"><input class="form-check-input" type="checkbox" id="disc${d.id}" value="${d.id}" data-disc ${minhas.disciplinas.some(x => x.id === d.id) ? "checked" : ""}>
          <label class="form-check-label" for="disc${d.id}">${esc(d.nome)}</label></div>`).join("")}
        <button class="btn btn-outline-primary mt-2" id="b-disc">Salvar</button></div></div>
    </section>
  </div></div>`;
  $$("[data-del]").forEach(b => b.addEventListener("click", async () => { await api("DELETE", `/api/escalas/${b.dataset.del}`); toast("Período removido."); render(); }));
  $("#f-esc").addEventListener("submit", async e => {
    e.preventDefault();
    try { await api("POST", "/api/escalas", { dia_semana: Number($("#e-dia").value), hora_inicio: $("#e-ini").value, hora_fim: $("#e-fim").value, local: $("#e-loc").value.trim() }); toast("Período incluído."); render(); }
    catch (er) { toast(erroTexto(er), true); }
  });
  $("#b-disc").addEventListener("click", e => comCarregando(e.currentTarget, async () => {
    try { await api("PUT", "/api/minhas-disciplinas", { ids: $$("[data-disc]:checked").map(i => Number(i.value)) }); toast("Disciplinas salvas."); }
    catch (er) { toast(erroTexto(er), true); }
  }));
};

/* =====================================================================
   Coordenador: Motivos de contato
   ===================================================================== */
VIEWS.motivos = async main => {
  const [motivos, docs] = await Promise.all([api("GET", "/api/motivos?todos=1"), api("GET", "/api/documentos")]);
  const prio = { 1: "Alta", 2: "Média", 3: "Baixa" };
  main.innerHTML = `<div>
  ${titulo("Motivos de contato", `<button class="btn btn-primary" id="b-novo">Novo motivo</button>`)}
  <div class="painel"><table class="table tabela tabela-responsiva align-middle">
    <thead><tr><th>Motivo</th><th>Encaminhamento</th><th>Atendimento</th><th>Prioridade</th><th>Documentos</th><th></th></tr></thead><tbody>
  ${motivos.map(m => `<tr class="${m.ativo ? "" : "text-body-secondary"}">
    <td data-l="Motivo">${esc(m.nome)}${m.ativo ? "" : " (inativo)"}${m.data_limite ? `<div class="small text-body-secondary">Prazo: ${esc(fmtData(m.data_limite))}</div>` : ""}</td>
    <td data-l="Encaminhamento">${m.destino === "SECRETARIA" ? "Secretaria" : "Coordenação"}</td>
    <td data-l="Atendimento">${m.atendimento === "ONLINE" ? "Online" : `Presencial, ${m.duracao_min} min`}</td>
    <td data-l="Prioridade">${prio[m.prioridade]}</td>
    <td data-l="Documentos" class="small">${m.documentos.map(d => esc(d.nome) + (d.obrigatorio ? " *" : "")).join(", ") || "—"}</td>
    <td class="text-md-end"><button class="btn btn-sm btn-outline-secondary" data-ed="${m.id}">Editar</button></td></tr>`).join("")}
  </tbody></table></div><p class="small text-body-secondary mt-2">* documento obrigatório</p></div>`;
  const form = m => dialogo({
    titulo: m ? "Editar motivo" : "Novo motivo", tamanho: "modal-lg",
    corpo: `<form id="f-mot" novalidate><div class="row g-3">
      <div class="col-12"><label for="m-nome" class="form-label">Nome</label><input class="form-control" id="m-nome" value="${esc(m?.nome || "")}" required maxlength="100"><div class="invalid-feedback">Mínimo de 3 letras.</div></div>
      <div class="col-sm-6"><label for="m-dest" class="form-label">Encaminhamento</label><select class="form-select" id="m-dest"><option value="COORDENACAO">Coordenação</option><option value="SECRETARIA">Secretaria</option></select></div>
      <div class="col-sm-6"><label for="m-at" class="form-label">Atendimento</label><select class="form-select" id="m-at"><option value="PRESENCIAL">Presencial</option><option value="ONLINE">Online (sem reunião)</option></select></div>
      <div class="col-sm-4"><label for="m-dur" class="form-label">Duração (min)</label><input class="form-control" type="number" id="m-dur" min="5" max="240" step="5" value="${m?.duracao_min ?? 30}"></div>
      <div class="col-sm-4"><label for="m-prio" class="form-label">Prioridade</label><select class="form-select" id="m-prio"><option value="1">Alta</option><option value="2">Média</option><option value="3">Baixa</option></select></div>
      <div class="col-sm-4"><label for="m-lim" class="form-label">Prazo</label><input class="form-control" type="date" id="m-lim" value="${esc(m?.data_limite || "")}"></div>
      <div class="col-12"><label for="m-ori" class="form-label">Orientação ao aluno</label><textarea class="form-control" id="m-ori" maxlength="300" rows="2">${esc(m?.orientacao || "")}</textarea></div>
      <div class="col-sm-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="m-disc" ${m?.exige_disciplina ? "checked" : ""}><label class="form-check-label" for="m-disc">Pedir a disciplina</label></div></div>
      <div class="col-sm-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="m-ativo" ${m?.ativo !== false ? "checked" : ""}><label class="form-check-label" for="m-ativo">Ativo</label></div></div>
      <div class="col-12"><div class="fw-semibold">Documentos pedidos ao aluno</div>
        <p class="small text-body-secondary mb-2">Marque os que este motivo pede. O nome pode ser alterado e vale para todos os motivos.</p>
        <table class="table table-sm align-middle mb-0"><tbody>${docs.map(d => { const sel = m?.documentos.find(x => x.id === d.id); return `<tr>
          <td class="col-check"><input class="form-check-input" type="checkbox" data-doc="${d.id}" ${sel ? "checked" : ""} aria-label="Pedir ${esc(d.nome)}"></td>
          <td><input class="form-control form-control-sm" data-nome="${d.id}" value="${esc(d.nome)}" maxlength="100" aria-label="Nome do documento"></td>
          <td class="text-end text-nowrap"><div class="form-check form-check-inline mb-0 me-0"><input class="form-check-input" type="checkbox" id="obr${d.id}" data-obr="${d.id}" ${sel?.obrigatorio ? "checked" : ""}><label class="form-check-label small" for="obr${d.id}">obrigatório</label></div></td></tr>`; }).join("")}
          <tr><td class="col-check"><input class="form-check-input" type="checkbox" id="doc-novo" aria-label="Pedir o novo documento"></td>
            <td><input class="form-control form-control-sm" id="nome-novo" maxlength="100" placeholder="Outro documento (ex.: Declaração de trabalho)" aria-label="Nome de um novo documento"></td>
            <td class="text-end text-nowrap"><div class="form-check form-check-inline mb-0 me-0"><input class="form-check-input" type="checkbox" id="obr-novo"><label class="form-check-label small" for="obr-novo">obrigatório</label></div></td></tr>
        </tbody></table></div>
    </div></form>`,
    rodape: `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary" id="ok">Salvar</button>`,
    aoAbrir: (d, fechar) => {
      if (m) { $("#m-dest", d).value = m.destino; $("#m-at", d).value = m.atendimento; $("#m-prio", d).value = m.prioridade; }
      const ajustaDuracao = () => { $("#m-dur", d).disabled = $("#m-at", d).value === "ONLINE"; };
      $("#m-at", d).addEventListener("change", ajustaDuracao); ajustaDuracao();
      // Marcar "obrigatório" já marca o documento; digitar um documento novo já o seleciona
      $$("[data-obr]", d).forEach(c => c.addEventListener("change", () => { if (c.checked) $(`[data-doc="${c.dataset.obr}"]`, d).checked = true; }));
      $("#obr-novo", d).addEventListener("change", e => { if (e.target.checked) $("#doc-novo", d).checked = true; });
      $("#nome-novo", d).addEventListener("input", e => { $("#doc-novo", d).checked = e.target.value.trim().length > 0; });

      $("#ok", d).addEventListener("click", e => comCarregando(e.currentTarget, async () => {
        const nome = $("#m-nome", d).value.trim();
        $("#m-nome", d).classList.toggle("is-invalid", nome.length < 3);
        if (nome.length < 3) return;
        const nomesDocs = $$("[data-nome]", d).map(i => ({ id: Number(i.dataset.nome), el: i, nome: i.value.trim().replace(/\s+/g, " ") }));
        const curto = nomesDocs.find(x => x.nome.length < 3);
        nomesDocs.forEach(x => x.el.classList.toggle("is-invalid", x === curto));
        if (curto) return toast("O nome do documento precisa de pelo menos 3 letras.", true);
        try {
          // 1) renomeia os documentos alterados
          for (const x of nomesDocs) {
            if (x.nome !== docs.find(o => o.id === x.id).nome) await api("PUT", `/api/documentos/${x.id}`, { nome: x.nome });
          }
          // 2) cria o documento novo, se foi digitado
          const documentos = $$("[data-doc]:checked", d).map(i => ({ id: Number(i.dataset.doc), obrigatorio: $(`[data-obr="${i.dataset.doc}"]`, d).checked }));
          const novo = $("#nome-novo", d).value.trim();
          if (novo) {
            const doc = await api("POST", "/api/documentos", { nome: novo });
            if ($("#doc-novo", d).checked) documentos.push({ id: doc.id, obrigatorio: $("#obr-novo", d).checked });
          }
          // 3) salva o motivo
          await api(m ? "PUT" : "POST", m ? `/api/motivos/${m.id}` : "/api/motivos", {
            nome, destino: $("#m-dest", d).value, atendimento: $("#m-at", d).value,
            duracao_min: $("#m-at", d).value === "ONLINE" ? null : Number($("#m-dur", d).value), prioridade: Number($("#m-prio", d).value),
            data_limite: $("#m-lim", d).value || null, orientacao: $("#m-ori", d).value || null,
            exige_disciplina: $("#m-disc", d).checked, ativo: $("#m-ativo", d).checked, documentos,
          });
          fechar(); toast("Motivo salvo."); render();
        } catch (er) { toast(erroTexto(er), true); }
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
  aplicaTema(store.get("tema", "dark"));      // escuro por padrão (requisito de acessibilidade)
  aplicaFonte(Number(store.get("fonte", 16)));
  DEMO = await detectaModo();
  $("#faixa-demo").hidden = !DEMO;
  try { USER = await api("GET", "/api/me"); } catch { USER = null; }
  render();
})();
