"use strict";
/* =====================================================================
   Utilidades: formatação, armazenamento, API, modal, toast e máscaras
   ===================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDia = d => isoLocal(d).slice(0, 10);
const parse = s => s ? new Date(s.length === 10 ? s + "T00:00" : s) : null;
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS_LONGOS = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const fmtData = s => { const d = parse(s); return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : ""; };
const fmtHora = s => { const d = parse(s); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ""; };
const fmtQuando = s => { const d = parse(s); return d ? `${SEMANA[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${fmtHora(s)}` : ""; };
const icone = (nome, extra = "") => `<i class="bi bi-${nome} ${extra}" aria-hidden="true"></i>`;
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : v; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: segue sem lembrar */ } },
};

/* ---------- Toast (Bootstrap) ---------- */
function toast(msg, erro = false) {
  const el = document.createElement("div");
  el.className = `toast align-items-center border-0 text-bg-${erro ? "danger" : "success"}`;
  el.setAttribute("role", erro ? "alert" : "status");
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${icone(erro ? "exclamation-circle" : "check-circle", "me-2")}${esc(msg)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button></div>`;
  $("#toasts").appendChild(el);
  el.addEventListener("hidden.bs.toast", () => el.remove());
  bootstrap.Toast.getOrCreateInstance(el, { delay: 4000 }).show();
}

/* ---------- Modal (Bootstrap): substitui alert/confirm ----------
   dialogo({ titulo, corpo, rodape, aoAbrir(el, fechar) }) -> fechar() */
function dialogo({ titulo, corpo = "", rodape = "", aoAbrir, tamanho = "" }) {
  const el = $("#modal");
  $(".modal-dialog", el).className = `modal-dialog modal-dialog-centered modal-dialog-scrollable ${tamanho}`;
  $(".modal-content", el).innerHTML = `
    <div class="modal-header"><h2 class="modal-title h5" id="modal-titulo">${titulo}</h2>
      <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>
    <div class="modal-body">${corpo}</div>
    ${rodape ? `<div class="modal-footer">${rodape}</div>` : ""}`;
  const m = bootstrap.Modal.getOrCreateInstance(el);
  const fechar = () => m.hide();
  el.addEventListener("shown.bs.modal", () => $("input, select, textarea", el)?.focus(), { once: true });
  if (aoAbrir) aoAbrir(el, fechar);
  m.show();
  return fechar;
}

function erroTexto(e) {
  const d = e && e.detail;
  if (!d) return "Não foi possível concluir. Tente de novo.";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map(x => x.msg.replace(/^Value error, /, "")).join(" ");
  return d.mensagem || JSON.stringify(d);
}

/* Mostra/limpa um erro num alerta da tela */
function mostraErro(el, texto) {
  el.hidden = !texto;
  el.innerHTML = texto ? `${icone("exclamation-triangle-fill", "me-2")}${esc(texto)}` : "";
  if (texto) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* Botão em estado "enviando" (evita clique duplo) */
async function comCarregando(btn, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${original}`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = original; }
}

/* ---------- Máscaras de formulário (IMask) ---------- */
const Mascaras = {
  ra: el => IMask(el, { mask: /^\d{0,20}$/ }),
  celular: el => IMask(el, { mask: "(00) 00000-0000" }),
  email: el => el.addEventListener("blur", () => { el.value = el.value.trim().toLowerCase(); }),
};

/* =====================================================================
   API: servidor real ou modo demonstração (dados fictícios no navegador)
   ===================================================================== */
let DEMO = false;

async function api(metodo, caminho, corpo, cabecalhos = {}) {
  if (DEMO) return Mock.chamar(metodo, caminho, corpo);
  const opt = { method: metodo, credentials: "same-origin", headers: { "X-Requested-With": "fetch", ...cabecalhos } };
  if (corpo instanceof FormData) opt.body = corpo;
  else if (corpo !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(corpo); }
  const r = await fetch(caminho, opt);
  const dados = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (r.status === 429) throw { status: 429, detail: dados?.detail || "Muitas requisições em pouco tempo. Aguarde um minuto e tente de novo." };
  if (!r.ok) throw { status: r.status, detail: dados?.detail ?? dados?.error ?? `Erro ${r.status}` };
  return dados;
}

let APRESENTACAO = false;   // servidor com MODO_APRESENTACAO=1: mostra o atalho para a administração

async function detectaModo() {
  if (location.search.includes("demo")) return true;
  try {
    const r = await fetch("/api/saude", { credentials: "same-origin" });
    if (r.ok) APRESENTACAO = Boolean((await r.json()).apresentacao);
    return !r.ok;
  } catch { return true; }
}
