"use strict";
/* Modo demonstração: simula a API no navegador (abre com ?demo ou se /api/saude não responder). */

/* ---------- Modo demonstração ---------- */
const Mock = (() => {
  const agora = new Date();
  const emDias = (d, h, m = 0) => { const x = new Date(agora); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x; };
  const SALA = "Bloco A, 2º andar, sala 204";
  const st = {
    user: null, seq: 100,
    cursos: [{ id: 1, nome: "Análise e Desenvolvimento de Sistemas" }],
    disciplinas: [{ id: 1, nome: "Banco de Dados" }, { id: 2, nome: "Engenharia de Software" }, { id: 3, nome: "Programação Web" }, { id: 4, nome: "Redes de Computadores" }],
    documentos: [{ id: 1, nome: "Atestado médico" }, { id: 2, nome: "Histórico escolar" }, { id: 3, nome: "Ementas das disciplinas" }],
    motivos: [
      { id: 1, nome: "Entrega de atestado", destino: "COORDENACAO", atendimento: "ONLINE", duracao_min: null, prioridade: 2, data_limite: null, exige_disciplina: true, orientacao: "Anexe o atestado; não é preciso ir à coordenação.", ativo: true, documentos: [{ id: 1, nome: "Atestado médico", obrigatorio: true }] },
      { id: 2, nome: "Nota, presença ou trabalho", destino: "COORDENACAO", atendimento: "PRESENCIAL", duracao_min: 20, prioridade: 1, data_limite: isoDia(emDias(10, 0)), exige_disciplina: true, orientacao: null, ativo: true, documentos: [] },
      { id: 3, nome: "Reprovação e como refazer", destino: "COORDENACAO", atendimento: "PRESENCIAL", duracao_min: 30, prioridade: 2, data_limite: null, exige_disciplina: true, orientacao: null, ativo: true, documentos: [] },
      { id: 4, nome: "Análise curricular (transferência)", destino: "COORDENACAO", atendimento: "PRESENCIAL", duracao_min: 60, prioridade: 3, data_limite: null, exige_disciplina: false, orientacao: "Leve o histórico e as ementas da outra instituição.", ativo: true, documentos: [{ id: 2, nome: "Histórico escolar", obrigatorio: false }, { id: 3, nome: "Ementas das disciplinas", obrigatorio: false }] },
      { id: 5, nome: "Documentação de matrícula", destino: "SECRETARIA", atendimento: "PRESENCIAL", duracao_min: 15, prioridade: 2, data_limite: null, exige_disciplina: false, orientacao: "Esse assunto é com a secretaria acadêmica (Bloco B, térreo).", ativo: true, documentos: [] },
      { id: 6, nome: "Pagamento e financeiro", destino: "SECRETARIA", atendimento: "PRESENCIAL", duracao_min: 15, prioridade: 2, data_limite: null, exige_disciplina: false, orientacao: "Esse assunto é com a secretaria ou o financeiro.", ativo: true, documentos: [] },
    ],
    escalas: [],
    reservas: [],
    minhasDisc: [1, 2, 3, 4],
    ags: [],
    notifs: [],
  };
  let idEsc = 1;
  for (let d = 1; d <= 5; d++) {
    st.escalas.push({ id: idEsc++, dia_semana: d, hora_inicio: "14:00", hora_fim: "18:00", local: SALA });
    st.escalas.push({ id: idEsc++, dia_semana: d, hora_inicio: "18:30", hora_fim: "21:30", local: SALA });
  }
  const proxUtil = (n, h, m) => { let d = n, x; do { x = emDias(d, h, m); d++; } while (x.getDay() === 0 || x.getDay() === 6); return x; };
  { const r = proxUtil(2, 12, 0); st.reservas.push({ id: 1, inicio: isoLocal(r), fim: isoLocal(new Date(r.getTime() + 90 * 60000)), motivo: "Reunião de colegiado" }); }
  const mot = id => st.motivos.find(m => m.id === id);
  const novoAg = (o) => {
    const m = mot(o.motivo_id);
    const ini = o.inicio ? new Date(o.inicio) : null;
    return {
      id: st.seq++, id_aluno: o.id_aluno, aluno: o.aluno, status: o.status, id_status: { Pendente: 1, Aprovada: 2, Recusada: 3, Cancelada: 4, Realizada: 5 }[o.status],
      motivo: m.nome, id_motivo: m.id, atendimento: m.atendimento, disciplina: o.disciplina || null, titulo: o.titulo, descricao: o.descricao || null,
      inicio: ini ? isoLocal(ini) : null, fim: ini ? isoLocal(new Date(ini.getTime() + (m.duracao_min || 30) * 60000)) : null,
      local: ini ? SALA : null, gestor: "Prof.ª Marina Coordenadora", observacao: o.observacao || null, cancelado_por: null,
      criado_em: isoLocal(o.criado || agora), avaliacao: null, anexos: o.anexos || [], prioridade: m.prioridade, data_limite: m.data_limite,
    };
  };
  const LUCAS = { nome: "Lucas Andrade", ra: "1234567", email: "lucas@aluno.demo.edu", whatsapp: true };
  const BEA = { nome: "Beatriz Lima", ra: "7654321", email: "beatriz@aluno.demo.edu", whatsapp: false };
  st.ags.push(novoAg({ id_aluno: 1, aluno: LUCAS, status: "Aprovada", motivo_id: 2, disciplina: "Banco de Dados", titulo: "Nota da AV1 não apareceu", descricao: "Fiz a prova no dia 03/11 e a nota ainda não está no portal.", inicio: proxUtil(3, 14, 40) }));
  st.ags.push(novoAg({ id_aluno: 1, aluno: LUCAS, status: "Realizada", motivo_id: 3, disciplina: "Redes de Computadores", titulo: "Como refazer Redes", inicio: emDias(-7, 19, 0), criado: emDias(-10, 10) }));
  st.ags.push(novoAg({ id_aluno: 2, aluno: BEA, status: "Aprovada", motivo_id: 4, titulo: "Transferência da Uninove", descricao: "Quero saber quais disciplinas consigo aproveitar.", inicio: proxUtil(1, 19, 0) }));
  st.ags.push(novoAg({ id_aluno: 2, aluno: BEA, status: "Pendente", motivo_id: 1, disciplina: "Programação Web", titulo: "Atestado de 10 e 11/11", criado: emDias(0, 9, 12), anexos: [{ id: 1, documento: "Atestado médico", arquivo: "atestado_beatriz.pdf" }] }));
  st.ags.push(novoAg({ id_aluno: 3, aluno: { nome: "Rafael Souza", ra: "2223334", email: "rafael@aluno.demo.edu", whatsapp: true }, status: "Pendente", motivo_id: 1, disciplina: "Banco de Dados", titulo: "Atestado médico — 12/11", criado: emDias(0, 11, 40), anexos: [{ id: 2, documento: "Atestado médico", arquivo: "atestado.jpg" }] }));
  st.notifs.push({ id: 1, id_aluno: 1, mensagem: `Reunião confirmada: ${fmtQuando(st.ags[0].inicio)}, ${SALA}, com Prof.ª Marina Coordenadora.`, lida: false, criada_em: isoLocal(emDias(0, 8)) });
  st.notifs.push({ id: 2, id_aluno: 1, mensagem: "Reunião realizada com sucesso. Avalie o atendimento de 1 a 10.", lida: false, criada_em: isoLocal(emDias(-7, 19, 35)) });

  const erro = (status, detail) => { throw { status, detail }; };
  const exige = perfil => { if (!st.user) erro(401, "Faça login para continuar."); if (perfil && st.user.perfil !== perfil) erro(403, "Acesso negado."); };
  const sobrepoe = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
  const avisa = (ag, msg) => st.notifs.unshift({ id: st.seq++, id_aluno: ag.id_aluno, mensagem: msg, lida: false, criada_em: isoLocal(new Date()) });

  function livres(m) {
    const dur = (m.duracao_min || 30) * 60000, passo = (m.duracao_min <= 30 ? m.duracao_min : 30) * 60000;
    const de = new Date(Date.now() + 24 * 3600000), dias = [];
    const bloq = [...st.reservas.map(r => [new Date(r.inicio), new Date(r.fim)]),
      ...st.ags.filter(a => a.status === "Aprovada" && a.inicio).map(a => [new Date(a.inicio), new Date(a.fim)])];
    for (let i = 0; i < 21; i++) {
      const dia = new Date(de); dia.setDate(dia.getDate() + i); dia.setHours(0, 0, 0, 0);
      const dow = dia.getDay() === 0 ? 7 : dia.getDay(), hs = [];
      st.escalas.filter(e => e.dia_semana === dow).forEach(e => {
        const [h0, m0] = e.hora_inicio.split(":").map(Number), [h1, m1] = e.hora_fim.split(":").map(Number);
        let t = new Date(dia); t.setHours(h0, m0);
        const fim = new Date(dia); fim.setHours(h1, m1);
        while (t.getTime() + dur <= fim.getTime()) {
          const tf = new Date(t.getTime() + dur);
          if (t >= de && !bloq.some(([b0, b1]) => sobrepoe(t, tf, b0, b1)))
            hs.push({ inicio: isoLocal(t), fim: isoLocal(tf), gestor_id: 1, gestor: "Prof.ª Marina Coordenadora", local: e.local });
          t = new Date(t.getTime() + passo);
        }
      });
      if (hs.length) dias.push({ data: isoDia(dia), horarios: hs.sort((a, b) => a.inicio.localeCompare(b.inicio)) });
    }
    return dias;
  }

  async function chamar(metodo, caminho, corpo) {
    await new Promise(r => setTimeout(r, 120));
    const url = new URL(caminho, "http://x"), p = url.pathname, q = url.searchParams;
    const json = corpo instanceof FormData ? Object.fromEntries(corpo.entries()) : (corpo || {});
    const id = Number((p.match(/\/(\d+)(\/|$)/) || [])[1]);
    const ag = st.ags.find(a => a.id === id);
    const meus = () => st.ags.filter(a => a.id_aluno === st.user.id);
    const R = `${metodo} ${p.replace(/\/\d+/g, "/:id")}`;
    switch (R) {
      case "GET /api/me": exige(); return st.user;
      case "POST /api/login": {
        const aluno = { "1234567": [1, "Lucas Andrade"], "lucas@aluno.demo.edu": [1, "Lucas Andrade"], "7654321": [2, "Beatriz Lima"] };
        if (json.perfil === "coordenador" && json.login.toLowerCase() === "coordenacao@demo.edu" && json.senha === "Coord2026!")
          return st.user = { id: 1, perfil: "coordenador", nome: "Prof.ª Marina Coordenadora" };
        if (json.perfil === "aluno" && aluno[json.login] && json.senha === "Aluno2026!")
          return st.user = { id: aluno[json.login][0], perfil: "aluno", nome: aluno[json.login][1] };
        erro(401, "RA/e-mail ou senha incorretos. Na demonstração: RA 1234567 / Aluno2026! ou coordenacao@demo.edu / Coord2026!");
      }
      case "POST /api/logout": st.user = null; return { ok: true };
      case "POST /api/alunos": return st.user = { id: 9, perfil: "aluno", nome: json.nome };
      case "GET /api/cursos": return st.cursos;
      case "GET /api/disciplinas": return st.disciplinas;
      case "GET /api/documentos": return st.documentos;
      case "POST /api/documentos": exige("coordenador"); {
        const nome = (json.nome || "").trim().replace(/\s+/g, " ");
        if (st.documentos.some(x => x.nome === nome)) erro(409, `Já existe o documento "${nome}".`);
        const doc = { id: st.seq++, nome }; st.documentos.push(doc); return doc;
      }
      case "PUT /api/documentos/:id": exige("coordenador"); {
        const nome = (json.nome || "").trim().replace(/\s+/g, " ");
        if (st.documentos.some(x => x.nome === nome && x.id !== id)) erro(409, `Já existe o documento "${nome}".`);
        st.documentos.find(x => x.id === id).nome = nome;
        st.motivos.forEach(m => m.documentos.forEach(x => { if (x.id === id) x.nome = nome; }));   // o nome vale em todos os motivos
        return { id, nome };
      }
      case "GET /api/motivos": exige(); return q.get("todos") ? st.motivos : st.motivos.filter(m => m.ativo);
      case "POST /api/motivos": exige("coordenador"); { const m = { ...json, id: st.seq++, documentos: (json.documentos || []).map(d => ({ ...d, nome: st.documentos.find(x => x.id === d.id).nome })) }; st.motivos.push(m); return m; }
      case "PUT /api/motivos/:id": exige("coordenador"); { const i = st.motivos.findIndex(m => m.id === id); st.motivos[i] = { ...json, id, documentos: (json.documentos || []).map(d => ({ ...d, nome: st.documentos.find(x => x.id === d.id).nome })) }; return st.motivos[i]; }
      case "GET /api/horarios/livres": exige("aluno"); return livres(mot(Number(q.get("id_motivo"))));
      case "POST /api/agendamentos": {
        exige("aluno");
        const m = mot(Number(json.id_motivo));
        if (m.destino === "SECRETARIA") erro(422, m.orientacao);
        if (m.atendimento === "PRESENCIAL" && meus().some(a => a.status === "Aprovada" && new Date(a.inicio) > new Date()))
          erro(422, "Você já tem uma reunião marcada. Cancele-a para marcar outra.");
        const disc = st.disciplinas.find(d => d.id === Number(json.id_disciplina));
        const anexos = corpo instanceof FormData ? corpo.getAll("arquivos").map((f, i) => ({ id: st.seq++, documento: st.documentos.find(d => d.id === Number(corpo.getAll("documentos")[i]))?.nome, arquivo: f.name })) : [];
        const novo = novoAg({ id_aluno: st.user.id, aluno: { nome: st.user.nome, ra: "1234567", email: "lucas@aluno.demo.edu", whatsapp: true }, status: m.atendimento === "ONLINE" ? "Pendente" : "Aprovada", motivo_id: m.id, disciplina: disc?.nome, titulo: json.titulo, descricao: json.descricao, inicio: json.inicio || null, anexos });
        st.ags.unshift(novo);
        avisa(novo, novo.status === "Aprovada" ? `Reunião confirmada: ${fmtQuando(novo.inicio)}, ${novo.local}.` : `Pedido recebido: ${m.nome}.`);
        return novo;
      }
      case "GET /api/agendamentos/meus": exige("aluno"); {
        const t = (q.get("q") || "").toLowerCase();
        return meus().filter(a => !t || (a.titulo + " " + (a.descricao || "")).toLowerCase().includes(t));
      }
      case "PATCH /api/agendamentos/:id/cancelar": exige();
        if (st.user.perfil === "aluno") { ag.cancelado_por = "ALUNO"; ag.observacao = "Cancelada pelo aluno"; }
        else { ag.cancelado_por = "GESTOR"; ag.observacao = "Cancelada pelo coordenador: " + (json.motivo || "imprevisto"); avisa(ag, `Sua reunião de ${fmtQuando(ag.inicio)} foi cancelada pelo coordenador.`); }
        ag.status = "Cancelada"; ag.id_status = 4; return ag;
      case "POST /api/agendamentos/:id/avaliacao": exige("aluno"); ag.avaliacao = { nota: json.nota, comentario: json.comentario }; return { ok: true };
      case "GET /api/agenda": exige("coordenador"); {
        const ini = q.get("inicio"), fim = q.get("fim"), sts = Number(q.get("id_status")), mo = Number(q.get("id_motivo")), t = (q.get("q") || "").toLowerCase();
        return st.ags.filter(a => {
          const quando = (a.inicio || a.criado_em).slice(0, 10);
          return (!ini || quando >= ini) && (!fim || quando <= fim) && (!sts || a.id_status === sts) && (!mo || a.id_motivo === mo)
            && (!t || (a.titulo + " " + (a.descricao || "")).toLowerCase().includes(t));
        }).sort((a, b) => (a.inicio || a.criado_em).localeCompare(b.inicio || b.criado_em));
      }
      case "GET /api/pendentes": exige("coordenador");
        return st.ags.filter(a => a.status === "Pendente").sort((a, b) => (a.data_limite || "9").localeCompare(b.data_limite || "9") || a.prioridade - b.prioridade || a.criado_em.localeCompare(b.criado_em));
      case "PATCH /api/agendamentos/:id/decisao": exige("coordenador");
        ag.status = json.aceitar ? "Aprovada" : "Recusada"; ag.id_status = json.aceitar ? 2 : 3; ag.observacao = json.observacao || null;
        avisa(ag, `Seu pedido "${ag.titulo}" foi ${json.aceitar ? "aceito" : "recusado"}.`); return ag;
      case "PATCH /api/agendamentos/:id/realizada": exige("coordenador");
        if (new Date(ag.inicio) > new Date()) erro(422, "A reunião ainda não começou.");
        ag.status = "Realizada"; ag.id_status = 5; return ag;
      case "GET /api/agendamentos/:id/whatsapp": exige("coordenador");
        if (!ag.aluno.whatsapp) erro(422, "O aluno não autorizou contato por WhatsApp.");
        return { link: `https://wa.me/5511999990000?text=${encodeURIComponent(`Olá, ${ag.aluno.nome.split(" ")[0]}! Sobre seu pedido "${ag.titulo}": `)}` };
      case "GET /api/notificacoes": exige("aluno"); return st.notifs.filter(n => n.id_aluno === st.user.id).slice(0, 20);
      case "PATCH /api/notificacoes/lidas": exige("aluno"); st.notifs.forEach(n => { if (n.id_aluno === st.user.id) n.lida = true; }); return { ok: true };
      case "GET /api/escalas": exige("coordenador"); return [...st.escalas].sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio));
      case "POST /api/escalas": exige("coordenador");
        if (st.escalas.some(e => e.dia_semana === Number(json.dia_semana) && json.hora_inicio < e.hora_fim && e.hora_inicio < json.hora_fim)) erro(409, "Esse bloco se sobrepõe a outro do mesmo dia.");
        { const e = { id: idEsc++, ...json, dia_semana: Number(json.dia_semana) }; st.escalas.push(e); return e; }
      case "DELETE /api/escalas/:id": exige("coordenador"); st.escalas = st.escalas.filter(e => e.id !== id); return { ok: true };
      case "GET /api/minhas-disciplinas": exige("coordenador"); return { max: 6, disciplinas: st.disciplinas.filter(d => st.minhasDisc.includes(d.id)) };
      case "PUT /api/minhas-disciplinas": exige("coordenador"); st.minhasDisc = json.ids; return { ok: true };
      case "GET /api/reservas": exige("coordenador"); return st.reservas.filter(r => new Date(r.fim) >= new Date());
      case "POST /api/reservas": exige("coordenador"); {
        const i0 = new Date(json.inicio), i1 = new Date(json.fim);
        const afetadas = st.ags.filter(a => a.status === "Aprovada" && a.inicio && sobrepoe(new Date(a.inicio), new Date(a.fim), i0, i1));
        if (afetadas.length && !json.confirmar)
          erro(409, { mensagem: `${afetadas.length} reunião(ões) marcada(s) nesse período.`, reunioes: afetadas.map(a => ({ id: a.id, aluno: a.aluno.nome, inicio: a.inicio })) });
        const r = { id: st.seq++, inicio: json.inicio, fim: json.fim, motivo: json.motivo };
        st.reservas.push(r);
        afetadas.forEach(a => { a.status = "Cancelada"; a.id_status = 4; a.cancelado_por = "GESTOR"; a.observacao = "Cancelada pelo coordenador: " + json.motivo; avisa(a, `Sua reunião de ${fmtQuando(a.inicio)} foi cancelada pelo coordenador (${json.motivo}). Escolha outro horário.`); });
        return { id: r.id, canceladas: afetadas.length };
      }
      case "DELETE /api/reservas/:id": exige("coordenador"); st.reservas = st.reservas.filter(r => r.id !== id); return { ok: true };
    }
    erro(404, "Rota não encontrada no modo demonstração: " + R);
  }
  return { chamar };
})();
