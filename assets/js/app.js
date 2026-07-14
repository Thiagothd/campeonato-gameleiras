/* =========================================================================
   APP — Campeonato Municipal de Futebol de Gameleiras
   Renderiza classificação por grupo, jogos e times, e controla o
   painel "Gerenciar" (cadastro de jogos/times com salvamento local).

   Você normalmente NÃO precisa mexer aqui. Use o botão "Gerenciar" no site.
   ========================================================================= */
(function () {
  "use strict";

  const LS_KEY = "gameleiras_camp_v1";
  const IMG_TIMES = "assets/img/times/";
  const CACHE_VER = "5"; // troque quando atualizar imagens (força o navegador a rebaixar)

  // Monta o src do escudo/logo; em data URI (link de teste) devolve direto.
  function comVersao(base) {
    if (!base) return "";
    if (base.indexOf("data:") === 0) return base;
    return base + "?v=" + CACHE_VER;
  }

  /* =======================================================================
     ESTADO  (parte de dados.js; se houver alterações salvas, usa elas)
     ======================================================================= */
  const PUBLICADO = {
    config: JSON.parse(JSON.stringify(CAMPEONATO)),
    grupos: JSON.parse(JSON.stringify(GRUPOS)),
    times:  JSON.parse(JSON.stringify(TIMES)),
    jogos:  JSON.parse(JSON.stringify(JOGOS)),
  };

  let STATE = carregar();

  function carregar() {
    try {
      const salvo = localStorage.getItem(LS_KEY);
      if (salvo) {
        const s = JSON.parse(salvo);
        // Garante que campos novos do publicado existam
        return {
          config: Object.assign({}, PUBLICADO.config, s.config || {}),
          grupos: s.grupos && s.grupos.length ? s.grupos : PUBLICADO.grupos,
          times:  s.times  || PUBLICADO.times,
          jogos:  s.jogos  || PUBLICADO.jogos,
        };
      }
    } catch (e) { /* ignora e usa publicado */ }
    return JSON.parse(JSON.stringify(PUBLICADO));
  }

  function salvar() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(STATE)); } catch (e) {}
  }

  function resetarPublicado() {
    localStorage.removeItem(LS_KEY);
    STATE = JSON.parse(JSON.stringify(PUBLICADO));
    renderTudo();
  }

  function temAlteracoesLocais() {
    return !!localStorage.getItem(LS_KEY);
  }

  /* =======================================================================
     HELPERS
     ======================================================================= */
  const porId = () => Object.fromEntries(STATE.times.map((t) => [t.id, t]));

  function jogoRealizado(j) {
    return j.golsMandante !== null && j.golsMandante !== undefined && j.golsMandante !== "" &&
           j.golsVisitante !== null && j.golsVisitante !== undefined && j.golsVisitante !== "";
  }

  function grupoDoJogo(j) {
    if (j.grupo) return j.grupo;
    const idx = porId();
    return (idx[j.mandante] && idx[j.mandante].grupo) || "";
  }

  function nomeTime(id) {
    const t = porId()[id];
    return t ? t.nome : id;
  }

  function iniciais(nome) {
    return (nome || "?")
      .replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, "")
      .split(/\s+/).filter(Boolean).slice(0, 2)
      .map((p) => p[0].toUpperCase()).join("");
  }

  function corDoTime(id) {
    let h = 0;
    for (let i = 0; i < (id || "").length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return `hsl(${h}, 45%, 38%)`;
  }

  function escudoHTML(time, tam) {
    const cls = "escudo escudo--" + tam;
    if (time && time.escudo) {
      const ini = iniciais(time.nome);
      return `<span class="${cls}" style="--cor:${corDoTime(time.id)}">
        <img src="${comVersao(IMG_TIMES + time.escudo)}" alt="${time.nome}" loading="lazy"
             onerror="this.parentElement.classList.add('escudo--txt');this.parentElement.textContent='${ini}';"></span>`;
    }
    const cor = time ? corDoTime(time.id) : "#5a6b60";
    const txt = time ? iniciais(time.nome) : "?";
    return `<span class="${cls} escudo--txt" style="--cor:${cor}">${txt}</span>`;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* =======================================================================
     CLASSIFICAÇÃO (por grupo)
     ======================================================================= */
  function calcularGrupo(grupoId) {
    const tab = {};
    STATE.times.filter((t) => t.grupo === grupoId).forEach((t) => {
      tab[t.id] = { id: t.id, nome: t.nome, escudo: t.escudo,
        pts: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, forma: [] };
    });

    STATE.jogos.filter(jogoRealizado).forEach((j) => {
      const m = tab[j.mandante], v = tab[j.visitante];
      if (!m || !v) return; // não é jogo deste grupo
      const gm = Number(j.golsMandante), gv = Number(j.golsVisitante);
      m.j++; v.j++; m.gp += gm; m.gc += gv; v.gp += gv; v.gc += gm;
      if (gm > gv) {
        m.v++; m.pts += STATE.config.pontosVitoria; m.forma.push("V");
        v.d++; v.pts += STATE.config.pontosDerrota; v.forma.push("D");
      } else if (gm < gv) {
        v.v++; v.pts += STATE.config.pontosVitoria; v.forma.push("V");
        m.d++; m.pts += STATE.config.pontosDerrota; m.forma.push("D");
      } else {
        m.e++; m.pts += STATE.config.pontosEmpate; m.forma.push("E");
        v.e++; v.pts += STATE.config.pontosEmpate; v.forma.push("E");
      }
    });

    const lista = Object.values(tab);
    lista.forEach((t) => { t.sg = t.gp - t.gc; });
    lista.sort((a, b) =>
      b.pts - a.pts ||
      ((b.j > 0) - (a.j > 0)) ||   // quem já jogou fica à frente de quem não jogou
      b.v - a.v || b.sg - a.sg || b.gp - a.gp ||
      a.nome.localeCompare(b.nome));
    return lista;
  }

  function tabelaGrupoHTML(grupo) {
    const lista = calcularGrupo(grupo.id);
    const classificam = STATE.config.classificadosPorGrupo || 2;
    if (!lista.length) return "";

    const linhas = lista.map((t, i) => {
      const pos = i + 1;
      const zona = pos <= classificam ? "zona-classificacao" : "";
      const idx = porId()[t.id];
      const sg = t.sg > 0 ? "+" + t.sg : t.sg;
      const sgCls = t.sg > 0 ? "sg-pos" : t.sg < 0 ? "sg-neg" : "";
      return `
        <tr class="${zona}">
          <td class="col-pos"><span class="pos">${pos}</span></td>
          <td class="col-time">
            <div class="time-cell">
              ${escudoHTML(idx, "sm")}
              <span class="time-nome">${escapeHtml(t.nome)}</span>
            </div>
          </td>
          <td>${t.j}</td>
          <td class="v">${t.v}</td>
          <td>${t.e}</td>
          <td>${t.d}</td>
          <td class="hide-sm">${t.gp}</td>
          <td class="hide-sm">${t.gc}</td>
          <td class="${sgCls}">${sg}</td>
          <td class="col-pts">${t.pts}</td>
        </tr>`;
    }).join("");

    return `
      <article class="grupo-card">
        <header class="grupo-head grupo-head--${grupo.id}">
          <span class="grupo-badge">${grupo.id}</span>
          <h3>${escapeHtml(grupo.nome)}</h3>
        </header>
        <div class="tabela-wrap">
          <table class="tabela">
            <thead>
              <tr>
                <th class="col-pos">#</th>
                <th class="col-time">Equipe</th>
                <th title="Jogos">J</th>
                <th title="Vitórias">V</th>
                <th title="Empates">E</th>
                <th title="Derrotas">D</th>
                <th class="hide-sm" title="Gols Pró">GP</th>
                <th class="hide-sm" title="Gols Contra">GC</th>
                <th title="Saldo de Gols">SG</th>
                <th class="col-pts" title="Pontos">P</th>
              </tr>
            </thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>
      </article>`;
  }

  function renderClassificacao() {
    const html = STATE.grupos.map(tabelaGrupoHTML).join("");
    document.getElementById("grupos-container").innerHTML =
      html || '<p class="vazio">Nenhum grupo cadastrado ainda.</p>';
  }

  /* =======================================================================
     JOGOS
     ======================================================================= */
  let filtroGrupo = "todos";

  function formatarData(iso) {
    if (!iso) return "";
    const [a, m, d] = iso.split("-");
    const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const dt = new Date(Number(a), Number(m) - 1, Number(d));
    return `${d}/${m} · ${dias[dt.getDay()]}`;
  }

  function cardJogo(j, realizado) {
    const idx = porId();
    const m = idx[j.mandante], v = idx[j.visitante];
    const g = grupoDoJogo(j);
    const venceuM = realizado && Number(j.golsMandante) > Number(j.golsVisitante);
    const venceuV = realizado && Number(j.golsVisitante) > Number(j.golsMandante);

    const centro = realizado
      ? `<div class="placar">
           <span class="${venceuM ? "vitorioso" : ""}">${j.golsMandante}</span>
           <span class="x">×</span>
           <span class="${venceuV ? "vitorioso" : ""}">${j.golsVisitante}</span>
         </div>`
      : `<div class="placar placar--futuro"><span class="vs">×</span>
           <span class="hora">${j.hora || "a definir"}</span></div>`;

    return `
      <div class="jogo ${realizado ? "jogo--fim" : "jogo--proximo"}">
        <div class="jogo-top">
          ${g ? `<span class="tag-grupo tag-grupo--${g}">Grupo ${g}</span>` : ""}
          <span class="jogo-rodada">${j.rodada ? "Rodada " + j.rodada : ""}</span>
          <span class="jogo-data">${formatarData(j.data)}</span>
        </div>
        <div class="jogo-corpo">
          <div class="lado">
            ${escudoHTML(m, "md")}
            <span class="lado-nome">${escapeHtml(nomeTime(j.mandante))}</span>
          </div>
          ${centro}
          <div class="lado">
            ${escudoHTML(v, "md")}
            <span class="lado-nome">${escapeHtml(nomeTime(j.visitante))}</span>
          </div>
        </div>
        ${j.local ? `<div class="jogo-local">📍 ${escapeHtml(j.local)}${j.hora && realizado ? " · " + j.hora : ""}</div>` : ""}
      </div>`;
  }

  function renderChipsGrupo() {
    const chips = [{ id: "todos", nome: "Todos" }]
      .concat(STATE.grupos.map((g) => ({ id: g.id, nome: "Grupo " + g.id })));
    document.getElementById("filtro-grupos").innerHTML = chips.map((c) =>
      `<button class="chip ${filtroGrupo === c.id ? "ativo" : ""}" data-grupo="${c.id}">${c.nome}</button>`
    ).join("");
  }

  function renderJogos() {
    renderChipsGrupo();
    const passaFiltro = (j) => filtroGrupo === "todos" || grupoDoJogo(j) === filtroGrupo;

    const realizados = STATE.jogos.filter((j) => jogoRealizado(j) && passaFiltro(j))
      .sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.rodada || 0) - (a.rodada || 0));
    const futuros = STATE.jogos.filter((j) => !jogoRealizado(j) && passaFiltro(j))
      .sort((a, b) => (a.data || "").localeCompare(b.data || "") || (a.rodada || 0) - (b.rodada || 0));

    document.getElementById("proximos-jogos").innerHTML =
      futuros.length ? futuros.map((j) => cardJogo(j, false)).join("")
                     : '<p class="vazio">Nenhum jogo agendado.</p>';
    document.getElementById("jogos-realizados").innerHTML =
      realizados.length ? realizados.map((j) => cardJogo(j, true)).join("")
                        : '<p class="vazio">Nenhum resultado ainda.</p>';

    document.getElementById("qtd-proximos").textContent = futuros.length;
    document.getElementById("qtd-realizados").textContent = realizados.length;
  }

  /* =======================================================================
     TIMES
     ======================================================================= */
  function renderTimes() {
    const html = STATE.grupos.map((g) => {
      const times = STATE.times.filter((t) => t.grupo === g.id);
      if (!times.length) return "";
      const cards = times.map((t) => `
        <div class="card-time">
          ${escudoHTML(t, "lg")}
          <span class="card-time-nome">${escapeHtml(t.nome)}</span>
        </div>`).join("");
      return `
        <div class="times-grupo">
          <h3 class="times-grupo-titulo"><span class="grupo-badge grupo-badge--sm">${g.id}</span> ${escapeHtml(g.nome)}</h3>
          <div class="grade-times">${cards}</div>
        </div>`;
    }).join("");
    document.getElementById("lista-times").innerHTML = html || '<p class="vazio">Nenhum time cadastrado.</p>';
    document.getElementById("qtd-times").textContent = STATE.times.length;
  }

  /* =======================================================================
     CABEÇALHO
     ======================================================================= */
  function renderCabecalho() {
    const c = STATE.config;
    document.getElementById("camp-nome").textContent = c.nome;
    document.getElementById("camp-cidade").textContent = c.cidade || "";
    document.getElementById("camp-temporada").textContent = "Temporada " + c.temporada;
    document.getElementById("camp-slogan").textContent = c.slogan || "";
    document.title = c.nome + " de " + (c.cidade || "") + " · " + c.temporada;
    const logo = document.getElementById("camp-logo");
    if (c.logo) {
      const logoSrc = c.logo.indexOf("data:") === 0 ? c.logo : comVersao("assets/img/" + c.logo);
      logo.innerHTML = `<img src="${logoSrc}" alt="${escapeHtml(c.nome)}"
        onerror="this.parentElement.classList.add('logo--erro');this.remove();">`;
    }
  }

  /* =======================================================================
     ABAS
     ======================================================================= */
  function initAbas() {
    document.querySelectorAll(".aba-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".aba-btn").forEach((b) => b.classList.remove("ativo"));
        document.querySelectorAll(".painel").forEach((p) => p.classList.remove("ativo"));
        btn.classList.add("ativo");
        document.getElementById(btn.dataset.alvo).classList.add("ativo");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    document.getElementById("filtro-grupos").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      filtroGrupo = b.dataset.grupo;
      renderJogos();
    });
  }

  /* =======================================================================
     GERENCIADOR (painel com senha)
     ======================================================================= */
  let desbloqueado = false;
  let abaGer = "jogos";

  function abrirGerenciador() {
    if (!desbloqueado) {
      const senha = prompt("Senha do Gerenciador:");
      if (senha === null) return;
      if (senha !== STATE.config.senhaGerenciador) { alert("Senha incorreta."); return; }
      desbloqueado = true;
    }
    document.getElementById("ger-modal").classList.add("aberto");
    document.body.classList.add("sem-scroll");
    renderGerenciador();
  }

  function fecharGerenciador() {
    document.getElementById("ger-modal").classList.remove("aberto");
    document.body.classList.remove("sem-scroll");
  }

  function renderGerenciador() {
    // abas internas
    document.querySelectorAll(".ger-tab").forEach((t) =>
      t.classList.toggle("ativo", t.dataset.ger === abaGer));
    document.querySelectorAll(".ger-secao").forEach((s) =>
      s.classList.toggle("ativo", s.dataset.ger === abaGer));

    document.getElementById("ger-aviso").style.display = temAlteracoesLocais() ? "flex" : "none";

    if (abaGer === "jogos") renderGerJogos();
    if (abaGer === "times") renderGerTimes();
  }

  function opcoesTimes(selecionado) {
    return STATE.times.map((t) =>
      `<option value="${t.id}" ${t.id === selecionado ? "selected" : ""}>${escapeHtml(t.nome)} (${t.grupo})</option>`
    ).join("");
  }

  /* ---------- Gerenciar JOGOS ---------- */
  function renderGerJogos() {
    const lista = STATE.jogos.map((j, i) => {
      const placar = jogoRealizado(j) ? `${j.golsMandante} × ${j.golsVisitante}` : "— × —";
      return `
        <div class="ger-item">
          <div class="ger-item-info">
            <span class="ger-item-tit">${escapeHtml(nomeTime(j.mandante))} <b>${placar}</b> ${escapeHtml(nomeTime(j.visitante))}</span>
            <span class="ger-item-sub">${grupoDoJogo(j) ? "Grupo " + grupoDoJogo(j) + " · " : ""}${j.rodada ? "Rod " + j.rodada + " · " : ""}${j.data || "sem data"}</span>
          </div>
          <div class="ger-item-acoes">
            <button class="btn-mini" data-editar-jogo="${i}">Editar</button>
            <button class="btn-mini btn-mini--del" data-excluir-jogo="${i}">Excluir</button>
          </div>
        </div>`;
    }).join("");

    document.getElementById("ger-jogos-lista").innerHTML =
      lista || '<p class="vazio">Nenhum jogo. Clique em "Novo jogo".</p>';
  }

  function formJogo(idx) {
    const j = idx != null ? STATE.jogos[idx] : {
      grupo: "", rodada: "", mandante: "", visitante: "",
      golsMandante: "", golsVisitante: "", data: "", hora: "", local: "Arena Jatobá"
    };
    const val = (v) => (v == null ? "" : v);
    document.getElementById("ger-form-jogo").innerHTML = `
      <h4 class="ger-form-tit">${idx != null ? "Editar jogo" : "Novo jogo"}</h4>
      <input type="hidden" id="fj-idx" value="${idx != null ? idx : ""}">
      <div class="campo">
        <label>Mandante</label>
        <select id="fj-mandante">${opcoesTimes(j.mandante)}</select>
      </div>
      <div class="campo campo--placar">
        <label>Placar <small>(deixe vazio se ainda não jogou)</small></label>
        <div class="placar-inputs">
          <input type="number" min="0" id="fj-gm" value="${val(j.golsMandante)}" placeholder="—">
          <span>×</span>
          <input type="number" min="0" id="fj-gv" value="${val(j.golsVisitante)}" placeholder="—">
        </div>
      </div>
      <div class="campo">
        <label>Visitante</label>
        <select id="fj-visitante">${opcoesTimes(j.visitante)}</select>
      </div>
      <div class="campo-linha">
        <div class="campo"><label>Rodada</label><input type="number" min="1" id="fj-rodada" value="${val(j.rodada)}"></div>
        <div class="campo"><label>Data</label><input type="date" id="fj-data" value="${val(j.data)}"></div>
        <div class="campo"><label>Hora</label><input type="time" id="fj-hora" value="${val(j.hora)}"></div>
      </div>
      <div class="campo"><label>Local</label><input type="text" id="fj-local" value="${escapeHtml(val(j.local))}" placeholder="Arena Jatobá"></div>
      <div class="ger-form-botoes">
        <button class="btn btn--verde" id="fj-salvar">Salvar jogo</button>
        <button class="btn btn--ghost" id="fj-cancelar">Cancelar</button>
      </div>`;
    document.getElementById("ger-form-jogo").style.display = "block";
    document.getElementById("ger-jogos-lista").style.display = "none";
    document.querySelector('[data-acao="novo-jogo"]').style.display = "none";

    document.getElementById("fj-salvar").onclick = salvarFormJogo;
    document.getElementById("fj-cancelar").onclick = () => { fecharFormJogo(); };
  }

  function fecharFormJogo() {
    document.getElementById("ger-form-jogo").style.display = "none";
    document.getElementById("ger-jogos-lista").style.display = "";
    document.querySelector('[data-acao="novo-jogo"]').style.display = "";
    renderGerJogos();
  }

  function salvarFormJogo() {
    const idxRaw = document.getElementById("fj-idx").value;
    const mandante = document.getElementById("fj-mandante").value;
    const visitante = document.getElementById("fj-visitante").value;
    if (!mandante || !visitante) { alert("Escolha os dois times."); return; }
    if (mandante === visitante) { alert("Os dois times não podem ser o mesmo."); return; }

    const gm = document.getElementById("fj-gm").value;
    const gv = document.getElementById("fj-gv").value;
    const um = gm.trim() !== "", uv = gv.trim() !== "";
    if (um !== uv) { alert("Preencha os DOIS placares, ou deixe os dois vazios."); return; }

    const idxTimes = porId();
    const jogo = {
      grupo: (idxTimes[mandante] && idxTimes[mandante].grupo) || "",
      rodada: document.getElementById("fj-rodada").value ? Number(document.getElementById("fj-rodada").value) : "",
      mandante, visitante,
      golsMandante: um ? Number(gm) : null,
      golsVisitante: uv ? Number(gv) : null,
      data: document.getElementById("fj-data").value,
      hora: document.getElementById("fj-hora").value,
      local: document.getElementById("fj-local").value.trim(),
    };

    if (idxRaw === "") STATE.jogos.push(jogo);
    else STATE.jogos[Number(idxRaw)] = jogo;

    salvar();
    fecharFormJogo();
    renderTudo();
    renderGerenciador();
  }

  function excluirJogo(idx) {
    const j = STATE.jogos[idx];
    if (!confirm(`Excluir o jogo ${nomeTime(j.mandante)} × ${nomeTime(j.visitante)}?`)) return;
    STATE.jogos.splice(idx, 1);
    salvar();
    renderTudo();
    renderGerenciador();
  }

  /* ---------- Gerenciar TIMES ---------- */
  function renderGerTimes() {
    const lista = STATE.times.map((t, i) => `
      <div class="ger-item">
        <div class="ger-item-info">
          ${escudoHTML(t, "sm")}
          <span class="ger-item-tit">${escapeHtml(t.nome)} <small>(${t.grupo || "sem grupo"})</small></span>
        </div>
        <div class="ger-item-acoes">
          <button class="btn-mini" data-editar-time="${i}">Editar</button>
          <button class="btn-mini btn-mini--del" data-excluir-time="${i}">Excluir</button>
        </div>
      </div>`).join("");
    document.getElementById("ger-times-lista").innerHTML =
      lista || '<p class="vazio">Nenhum time.</p>';
  }

  function opcoesGrupos(sel) {
    return STATE.grupos.map((g) =>
      `<option value="${g.id}" ${g.id === sel ? "selected" : ""}>${escapeHtml(g.nome)}</option>`).join("");
  }

  function formTime(idx) {
    const t = idx != null ? STATE.times[idx] : { id: "", nome: "", grupo: STATE.grupos[0] && STATE.grupos[0].id, escudo: "" };
    document.getElementById("ger-form-time").innerHTML = `
      <h4 class="ger-form-tit">${idx != null ? "Editar time" : "Novo time"}</h4>
      <input type="hidden" id="ft-idx" value="${idx != null ? idx : ""}">
      <div class="campo"><label>Nome do time</label><input type="text" id="ft-nome" value="${escapeHtml(t.nome)}" placeholder="Ex.: Raposa F.C."></div>
      <div class="campo-linha">
        <div class="campo"><label>Apelido/ID <small>(sem espaço/acento)</small></label>
          <input type="text" id="ft-id" value="${escapeHtml(t.id)}" placeholder="raposa" ${idx != null ? "readonly" : ""}></div>
        <div class="campo"><label>Grupo</label><select id="ft-grupo">${opcoesGrupos(t.grupo)}</select></div>
      </div>
      <div class="campo"><label>Arquivo do escudo <small>(em assets/img/times/)</small></label>
        <input type="text" id="ft-escudo" value="${escapeHtml(t.escudo)}" placeholder="raposa.png (opcional)"></div>
      <div class="ger-form-botoes">
        <button class="btn btn--verde" id="ft-salvar">Salvar time</button>
        <button class="btn btn--ghost" id="ft-cancelar">Cancelar</button>
      </div>`;
    document.getElementById("ger-form-time").style.display = "block";
    document.getElementById("ger-times-lista").style.display = "none";
    document.querySelector('[data-acao="novo-time"]').style.display = "none";
    document.getElementById("ft-salvar").onclick = salvarFormTime;
    document.getElementById("ft-cancelar").onclick = fecharFormTime;
  }

  function fecharFormTime() {
    document.getElementById("ger-form-time").style.display = "none";
    document.getElementById("ger-times-lista").style.display = "";
    document.querySelector('[data-acao="novo-time"]').style.display = "";
    renderGerTimes();
  }

  function slug(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function salvarFormTime() {
    const idxRaw = document.getElementById("ft-idx").value;
    const nome = document.getElementById("ft-nome").value.trim();
    let id = document.getElementById("ft-id").value.trim() || slug(nome);
    id = slug(id);
    const grupo = document.getElementById("ft-grupo").value;
    const escudo = document.getElementById("ft-escudo").value.trim();
    if (!nome) { alert("Digite o nome do time."); return; }
    if (!id) { alert("Digite um apelido/ID válido."); return; }

    if (idxRaw === "") {
      if (STATE.times.some((t) => t.id === id)) { alert("Já existe um time com esse ID."); return; }
      STATE.times.push({ id, nome, grupo, escudo });
    } else {
      const t = STATE.times[Number(idxRaw)];
      t.nome = nome; t.grupo = grupo; t.escudo = escudo;
    }
    salvar();
    fecharFormTime();
    renderTudo();
    renderGerenciador();
  }

  function excluirTime(idx) {
    const t = STATE.times[idx];
    const usado = STATE.jogos.some((j) => j.mandante === t.id || j.visitante === t.id);
    if (usado) { alert("Esse time tem jogos cadastrados. Exclua os jogos dele primeiro."); return; }
    if (!confirm(`Excluir o time ${t.nome}?`)) return;
    STATE.times.splice(idx, 1);
    salvar();
    renderTudo();
    renderGerenciador();
  }

  /* ---------- EXPORTAR dados.js ---------- */
  function gerarDadosJs() {
    const j2 = (obj) => JSON.stringify(obj, null, 2);
    return `/* =========================================================================
   DADOS DO CAMPEONATO — gerado pelo Gerenciador em ${STATE.config.temporada}
   Substitua o arquivo assets/js/dados.js por este e republique o site.
   ========================================================================= */

const CAMPEONATO = ${j2(STATE.config)};

const GRUPOS = ${j2(STATE.grupos)};

const TIMES = ${j2(STATE.times)};

const JOGOS = ${j2(STATE.jogos)};
`;
  }

  function exportarDadosJs() {
    const blob = new Blob([gerarDadosJs()], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "dados.js";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- eventos do gerenciador ---------- */
  function initGerenciador() {
    document.getElementById("btn-gerenciar").addEventListener("click", abrirGerenciador);
    document.getElementById("ger-fechar").addEventListener("click", fecharGerenciador);
    document.getElementById("ger-modal").addEventListener("click", (e) => {
      if (e.target.id === "ger-modal") fecharGerenciador();
    });

    document.querySelectorAll(".ger-tab").forEach((t) =>
      t.addEventListener("click", () => { abaGer = t.dataset.ger; renderGerenciador(); }));

    // Delegação de cliques na área do gerenciador
    document.getElementById("ger-modal").addEventListener("click", (e) => {
      const t = e.target.closest("[data-acao],[data-editar-jogo],[data-excluir-jogo],[data-editar-time],[data-excluir-time]");
      if (!t) return;
      if (t.dataset.acao === "novo-jogo") formJogo(null);
      else if (t.dataset.acao === "novo-time") formTime(null);
      else if (t.dataset.acao === "exportar") exportarDadosJs();
      else if (t.dataset.acao === "resetar") {
        if (confirm("Isso apaga as alterações salvas neste navegador e volta para os dados publicados. Continuar?"))
          { resetarPublicado(); renderGerenciador(); }
      }
      else if (t.dataset.editarJogo != null) formJogo(Number(t.dataset.editarJogo));
      else if (t.dataset.excluirJogo != null) excluirJogo(Number(t.dataset.excluirJogo));
      else if (t.dataset.editarTime != null) formTime(Number(t.dataset.editarTime));
      else if (t.dataset.excluirTime != null) excluirTime(Number(t.dataset.excluirTime));
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") fecharGerenciador();
    });
  }

  /* =======================================================================
     RENDER GERAL
     ======================================================================= */
  function renderTudo() {
    renderCabecalho();
    renderClassificacao();
    renderJogos();
    renderTimes();
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderTudo();
    initAbas();
    initGerenciador();
  });
})();
