/* =========================================================================
   APP — Campeonato Municipal de Futebol de Gameleiras
   Renderiza classificação por grupo, jogos e times, e controla o painel
   "Gerenciar". Os dados moram na nuvem (Firebase): quem salvar uma
   alteração atualiza o site para todo mundo, na hora, em qualquer lugar.

   Você normalmente NÃO precisa mexer aqui. Use o botão "Gerenciar" no site.
   ========================================================================= */
(function () {
  "use strict";

  const IMG_TIMES = "assets/img/times/";
  const CACHE_VER = "17"; // troque quando atualizar imagens/CSS/JS (força o navegador a rebaixar)

  function comVersao(base) {
    if (!base) return "";
    if (base.indexOf("data:") === 0) return base;
    return base + "?v=" + CACHE_VER;
  }

  /* =======================================================================
     ESTADO
     -------------------------------------------------------------------------
     PUBLICADO   = dados de fallback (assets/js/dados.js): usados na largada
                   (pintura instantânea) e se a nuvem ficar inacessível.
     STATE       = o que está na tela agora. Vira os dados reais da nuvem
                   assim que eles chegam, e continua assim.
     CLOUD_STATE = último estado confirmado pela nuvem — usado para reverter
                   a tela se um salvamento falhar no meio do caminho.
     ======================================================================= */
  const PUBLICADO = {
    config: JSON.parse(JSON.stringify(CAMPEONATO)),
    grupos: JSON.parse(JSON.stringify(GRUPOS)),
    times:  JSON.parse(JSON.stringify(TIMES)),
    jogos:  JSON.parse(JSON.stringify(JOGOS)),
  };

  let STATE = JSON.parse(JSON.stringify(PUBLICADO));
  let CLOUD_STATE = null;
  let bancoVazio = false;
  let logado = false;
  let modalAberto = false;
  let statusNuvem = "conectando"; // conectando | ao-vivo | erro | vazio

  function normalizarNuvem(dados) {
    return {
      config: Object.assign({}, PUBLICADO.config, dados.config || {}),
      grupos: (dados.grupos && dados.grupos.length) ? dados.grupos : PUBLICADO.grupos,
      times:  dados.times || PUBLICADO.times,
      jogos:  dados.jogos || PUBLICADO.jogos,
    };
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

  // Escudo pode ser um arquivo local antigo ("raposa.webp") ou uma imagem
  // enviada pelo Gerenciador e guardada embutida nos dados ("data:...").
  function srcEscudo(escudo) {
    if (!escudo) return "";
    if (escudo.indexOf("http") === 0 || escudo.indexOf("data:") === 0 || escudo.indexOf("blob:") === 0) return escudo;
    return comVersao(IMG_TIMES + escudo);
  }

  function escudoHTML(time, tam) {
    const cls = "escudo escudo--" + tam + (time && time.chip ? " escudo--chip" : "");
    if (time && time.escudo) {
      const ini = iniciais(time.nome);
      return `<span class="${cls}" style="--cor:${corDoTime(time.id)}">
        <img src="${srcEscudo(time.escudo)}" alt="${time.nome}" loading="lazy"
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
     STATUS DA NUVEM (indicador visível + banner dentro do Gerenciador)
     ======================================================================= */
  function aplicarStatusNuvem() {
    const mapaPill = {
      conectando: { txt: "Conectando…", cls: "status--conectando" },
      "ao-vivo":  { txt: "Ao vivo",     cls: "status--ok" },
      erro:       { txt: "Sem conexão", cls: "status--erro" },
      vazio:      { txt: "Aguardando dados", cls: "status--conectando" },
    };
    const info = mapaPill[statusNuvem] || mapaPill.conectando;
    const pill = document.getElementById("status-nuvem");
    if (pill) pill.className = "status-nuvem " + info.cls;
    const pillTxt = document.getElementById("status-nuvem-texto");
    if (pillTxt) pillTxt.textContent = info.txt;

    const aviso = document.getElementById("ger-aviso");
    if (aviso) {
      if (statusNuvem === "erro") {
        aviso.className = "ger-aviso ger-aviso--erro";
        aviso.innerHTML = "<span>🔴 Sem conexão com a nuvem agora. Mostrando os últimos dados carregados — tentando reconectar…</span>";
        aviso.style.display = "flex";
      } else if (statusNuvem === "vazio") {
        aviso.className = "ger-aviso ger-aviso--vazio";
        aviso.innerHTML = '<span>☁️ O banco de dados da nuvem está vazio.</span>' +
          '<button type="button" class="btn-mini" data-acao="semear">Enviar dados iniciais</button>';
        aviso.style.display = "flex";
      } else {
        aviso.style.display = "none";
      }
    }
  }

  /* =======================================================================
     GERENCIADOR — login por senha (Firebase Auth) + dados na nuvem
     ======================================================================= */
  let abaGer = "jogos";

  function mensagemErroLogin(e) {
    const c = (e && e.code) || "";
    if (c.indexOf("network") !== -1) return "Sem conexão com a internet. Verifique e tente novamente.";
    if (c.indexOf("too-many-requests") !== -1) return "Muitas tentativas erradas. Aguarde um instante e tente de novo.";
    return "Senha incorreta.";
  }

  function mensagemErroSalvar(e) {
    const c = (e && e.code) || "";
    if (c.indexOf("permission-denied") !== -1) return "Sua sessão expirou. Feche e abra o Gerenciador de novo.";
    if (c.indexOf("network") !== -1 || c.indexOf("unavailable") !== -1) return "Verifique sua internet e tente novamente.";
    return "Tente novamente em instantes.";
  }

  async function abrirGerenciador() {
    if (!logado) {
      if (!window.CampDB) { alert("Ainda conectando à nuvem, tente de novo em alguns segundos."); return; }
      const senha = prompt("Senha do Gerenciador:");
      if (senha === null) return;
      if (!senha.trim()) { alert("Digite a senha."); return; }
      try {
        await window.CampDB.entrar(senha);
      } catch (e) {
        alert(mensagemErroLogin(e));
        return;
      }
    }
    modalAberto = true;
    document.getElementById("ger-modal").classList.add("aberto");
    document.body.classList.add("sem-scroll");
    renderGerenciador();
  }

  function fecharGerenciador() {
    modalAberto = false;
    document.getElementById("ger-modal").classList.remove("aberto");
    document.body.classList.remove("sem-scroll");
  }

  function renderGerenciador() {
    document.querySelectorAll(".ger-tab").forEach((t) =>
      t.classList.toggle("ativo", t.dataset.ger === abaGer));
    document.querySelectorAll(".ger-secao").forEach((s) =>
      s.classList.toggle("ativo", s.dataset.ger === abaGer));

    aplicarStatusNuvem();

    if (abaGer === "jogos") renderGerJogos();
    if (abaGer === "times") renderGerTimes();
  }

  function opcoesTimes(selecionado) {
    return STATE.times.map((t) =>
      `<option value="${t.id}" ${t.id === selecionado ? "selected" : ""}>${escapeHtml(t.nome)} (${t.grupo})</option>`
    ).join("");
  }

  /* ---------- Salvar na nuvem (com feedback visual e reversão em erro) ---------- */
  async function salvarNuvem(botao) {
    let textoOriginal = "";
    if (botao) { textoOriginal = botao.textContent; botao.disabled = true; botao.textContent = "Salvando…"; }
    try {
      await window.CampDB.salvar(STATE);
      CLOUD_STATE = JSON.parse(JSON.stringify(STATE));
      bancoVazio = false;
      return true;
    } catch (e) {
      alert("Não foi possível salvar na nuvem. " + mensagemErroSalvar(e));
      STATE = CLOUD_STATE ? JSON.parse(JSON.stringify(CLOUD_STATE)) : JSON.parse(JSON.stringify(PUBLICADO));
      renderTudo();
      if (modalAberto) renderGerenciador();
      return false;
    } finally {
      if (botao) { botao.disabled = false; botao.textContent = textoOriginal; }
    }
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

  async function salvarFormJogo() {
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

    STATE.jogos = STATE.jogos.slice();
    if (idxRaw === "") STATE.jogos.push(jogo);
    else STATE.jogos[Number(idxRaw)] = jogo;

    const ok = await salvarNuvem(document.getElementById("fj-salvar"));
    if (!ok) return;

    fecharFormJogo();
    renderTudo();
    renderGerenciador();
  }

  async function excluirJogo(idx) {
    const j = STATE.jogos[idx];
    if (!confirm(`Excluir o jogo ${nomeTime(j.mandante)} × ${nomeTime(j.visitante)}?`)) return;
    STATE.jogos = STATE.jogos.slice();
    STATE.jogos.splice(idx, 1);
    const ok = await salvarNuvem();
    if (!ok) return;
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
    const previewSrc = srcEscudo(t.escudo);
    document.getElementById("ger-form-time").innerHTML = `
      <h4 class="ger-form-tit">${idx != null ? "Editar time" : "Novo time"}</h4>
      <input type="hidden" id="ft-idx" value="${idx != null ? idx : ""}">
      <input type="hidden" id="ft-escudo" value="${escapeHtml(t.escudo)}">
      <div class="campo"><label>Nome do time</label><input type="text" id="ft-nome" value="${escapeHtml(t.nome)}" placeholder="Ex.: Raposa F.C."></div>
      <div class="campo-linha">
        <div class="campo"><label>Apelido/ID <small>(sem espaço/acento)</small></label>
          <input type="text" id="ft-id" value="${escapeHtml(t.id)}" placeholder="raposa" ${idx != null ? "readonly" : ""}></div>
        <div class="campo"><label>Grupo</label><select id="ft-grupo">${opcoesGrupos(t.grupo)}</select></div>
      </div>
      <div class="campo">
        <label>Escudo do time</label>
        <div class="campo-escudo">
          <span class="ft-preview" id="ft-preview">${previewSrc ? `<img src="${previewSrc}" alt="">` : escapeHtml(iniciais(t.nome || "Time"))}</span>
          <div class="campo-escudo-acoes">
            <label class="btn btn--ghost btn--arquivo" for="ft-arquivo">Escolher imagem</label>
            <input type="file" accept="image/*" id="ft-arquivo" class="campo-arquivo-input">
            <button type="button" class="btn-mini btn-mini--del" id="ft-remover" ${t.escudo ? "" : "hidden"}>Remover escudo</button>
          </div>
        </div>
      </div>
      <div class="ger-form-botoes">
        <button class="btn btn--verde" id="ft-salvar">Salvar time</button>
        <button class="btn btn--ghost" id="ft-cancelar">Cancelar</button>
      </div>`;
    document.getElementById("ger-form-time").style.display = "block";
    document.getElementById("ger-times-lista").style.display = "none";
    document.querySelector('[data-acao="novo-time"]').style.display = "none";
    document.getElementById("ft-salvar").onclick = salvarFormTime;
    document.getElementById("ft-cancelar").onclick = fecharFormTime;
    document.getElementById("ft-arquivo").onchange = aoEscolherEscudo;
    document.getElementById("ft-remover").onclick = removerEscudoEscolhido;
  }

  function fecharFormTime() {
    document.getElementById("ger-form-time").style.display = "none";
    document.getElementById("ger-times-lista").style.display = "";
    document.querySelector('[data-acao="novo-time"]').style.display = "";
    renderGerTimes();
  }

  /* ---------- Escudo enviado do aparelho: comprime no navegador e guarda
     como imagem embutida (data:) direto no time — sem precisar de servidor
     de arquivos. Reduz qualidade/tamanho até caber num limite confortável. */
  function carregarImagem(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Arquivo de imagem inválido.")); };
      img.src = url;
    });
  }

  function desenharCanvas(img, lado) {
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * escala));
    const h = Math.max(1, Math.round(img.naturalHeight * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvas;
  }

  async function processarImagemEscudo(file) {
    const LIMITE_BYTES = 200 * 1024; // ~200KB em base64 por escudo (margem confortável no documento)
    const img = await carregarImagem(file);
    let lado = 320, qualidade = 0.85;
    for (let i = 0; i < 6; i++) {
      const dataUrl = desenharCanvas(img, lado).toDataURL("image/webp", qualidade);
      if (dataUrl.length * 0.75 <= LIMITE_BYTES || (lado <= 96 && qualidade <= 0.4)) return dataUrl;
      if (qualidade > 0.4) qualidade = Math.max(0.4, qualidade - 0.15);
      else lado = Math.round(lado * 0.75);
    }
    return null;
  }

  async function aoEscolherEscudo(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Escolha um arquivo de imagem (PNG, JPG ou WEBP)."); e.target.value = ""; return; }
    if (file.size > 15 * 1024 * 1024) { alert("Essa imagem é muito grande (máximo 15MB)."); e.target.value = ""; return; }
    try {
      const dataUrl = await processarImagemEscudo(file);
      if (!dataUrl) { alert("Não foi possível deixar essa imagem pequena o bastante. Tente outra."); return; }
      document.getElementById("ft-escudo").value = dataUrl;
      document.getElementById("ft-preview").innerHTML = `<img src="${dataUrl}" alt="">`;
      document.getElementById("ft-remover").hidden = false;
    } catch (err) {
      alert("Não foi possível carregar essa imagem. Tente outro arquivo.");
    }
  }

  function removerEscudoEscolhido() {
    document.getElementById("ft-escudo").value = "";
    document.getElementById("ft-arquivo").value = "";
    const nome = document.getElementById("ft-nome").value;
    document.getElementById("ft-preview").innerHTML = escapeHtml(iniciais(nome || "Time"));
    document.getElementById("ft-remover").hidden = true;
  }

  function slug(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  async function salvarFormTime() {
    const idxRaw = document.getElementById("ft-idx").value;
    const nome = document.getElementById("ft-nome").value.trim();
    let id = document.getElementById("ft-id").value.trim() || slug(nome);
    id = slug(id);
    const grupo = document.getElementById("ft-grupo").value;
    const escudo = document.getElementById("ft-escudo").value.trim();
    if (!nome) { alert("Digite o nome do time."); return; }
    if (!id) { alert("Digite um apelido/ID válido."); return; }

    STATE.times = STATE.times.map((t) => Object.assign({}, t));

    if (idxRaw === "") {
      if (STATE.times.some((t) => t.id === id)) { alert("Já existe um time com esse ID."); return; }
      STATE.times.push({ id, nome, grupo, escudo });
    } else {
      const t = STATE.times[Number(idxRaw)];
      t.nome = nome; t.grupo = grupo; t.escudo = escudo;
    }

    const ok = await salvarNuvem(document.getElementById("ft-salvar"));
    if (!ok) return;

    fecharFormTime();
    renderTudo();
    renderGerenciador();
  }

  async function excluirTime(idx) {
    const t = STATE.times[idx];
    const usado = STATE.jogos.some((j) => j.mandante === t.id || j.visitante === t.id);
    if (usado) { alert("Esse time tem jogos cadastrados. Exclua os jogos dele primeiro."); return; }
    if (!confirm(`Excluir o time ${t.nome}?`)) return;
    STATE.times = STATE.times.slice();
    STATE.times.splice(idx, 1);
    const ok = await salvarNuvem();
    if (!ok) return;
    renderTudo();
    renderGerenciador();
  }

  /* ---------- Enviar dados iniciais (semear a nuvem) ---------- */
  async function semearNuvem() {
    if (!confirm("Enviar os dados atuais (times e jogos já cadastrados) como base inicial da nuvem?")) return;
    const btn = document.querySelector('[data-acao="semear"]');
    const ok = await salvarNuvem(btn);
    if (ok) { alert("Pronto! O site agora está ao vivo para todo mundo."); renderGerenciador(); }
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

    document.getElementById("ger-modal").addEventListener("click", (e) => {
      const t = e.target.closest("[data-acao],[data-editar-jogo],[data-excluir-jogo],[data-editar-time],[data-excluir-time]");
      if (!t) return;
      if (t.dataset.acao === "novo-jogo") formJogo(null);
      else if (t.dataset.acao === "novo-time") formTime(null);
      else if (t.dataset.acao === "semear") semearNuvem();
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
     CONEXÃO COM A NUVEM
     -------------------------------------------------------------------------
     db.js carrega como módulo "async" — independente da renderização inicial
     (que já aconteceu com os dados de fallback). Aqui só conectamos assim
     que ele avisar que está pronto (ou na hora, se já estiver pronto).
     ======================================================================= */
  function iniciarNuvem() {
    if (window.CampDB) { conectarCampDB(); return; }

    let conectado = false;
    window.addEventListener("campdb-pronto", () => { conectado = true; conectarCampDB(); }, { once: true });

    // Se em 12s a nuvem não respondeu (rede lenta/bloqueada), avisa sem
    // travar o site — e continua escutando, caso conecte mais tarde.
    setTimeout(() => {
      if (!conectado) { statusNuvem = "erro"; aplicarStatusNuvem(); }
    }, 12000);
  }

  function conectarCampDB() {
    window.CampDB.aoMudarLogin((estaLogado) => {
      logado = estaLogado;
      if (modalAberto) renderGerenciador();
      else aplicarStatusNuvem();
    });

    window.CampDB.onDados((dados, erro) => {
      if (erro) {
        statusNuvem = "erro";
        aplicarStatusNuvem();
        return;
      }
      if (dados) {
        STATE = normalizarNuvem(dados);
        CLOUD_STATE = JSON.parse(JSON.stringify(STATE));
        bancoVazio = false;
        statusNuvem = "ao-vivo";
      } else {
        bancoVazio = true;
        statusNuvem = "vazio";
        // mantém STATE com o fallback (dados.js) para a tela nunca ficar em branco
      }
      renderTudo();
      if (modalAberto) renderGerenciador();
      aplicarStatusNuvem();
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
    renderTudo();      // pintura instantânea com os dados de fallback
    initAbas();
    initGerenciador();
    aplicarStatusNuvem();
    iniciarNuvem();     // conecta e assume os dados reais assim que chegarem
  });
})();
