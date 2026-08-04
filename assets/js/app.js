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
  const CACHE_VER = "40"; // troque quando atualizar imagens/CSS/JS (força o navegador a rebaixar)

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

  // O estado inicial (dados de fallback) também passa pela migração, para a
  // tela já nascer com os elencos completos mesmo antes da nuvem responder.
  let STATE = aplicarMigracaoJogadores(JSON.parse(JSON.stringify(PUBLICADO)));
  let CLOUD_STATE = null;
  let bancoVazio = false;
  let logado = false;
  let modalAberto = false;
  let statusNuvem = "conectando"; // conectando | ao-vivo | erro | vazio

  function normalizarNuvem(dados) {
    return aplicarMigracaoJogadores({
      config: Object.assign({}, PUBLICADO.config, dados.config || {}),
      grupos: (dados.grupos && dados.grupos.length) ? dados.grupos : PUBLICADO.grupos,
      times:  dados.times || PUBLICADO.times,
      jogos:  dados.jogos || PUBLICADO.jogos,
    });
  }

  /* =======================================================================
     JOGADORES — estrutura unificada e migração automática (backfill)
     -------------------------------------------------------------------------
     Cada time guarda `jogadores: [{ id, nome }]`.

     Compatibilidade: versões antigas salvavam o elenco como lista de nomes
     (["DUDA"]) e os gols sempre referenciaram o jogador pelo NOME + time.
     Por isso a leitura aceita os dois formatos e o vínculo entre gol e
     jogador continua sendo (time + nome), comparado sem diferenciar
     maiúsculas/minúsculas.

     A migração roda ao carregar o STATE, é IDEMPOTENTE (rodar de novo não
     muda nada) e só ACRESCENTA — nunca remove nem renomeia o que já existe.
     Ela acontece em memória; é gravada na nuvem naturalmente no próximo
     salvamento feito por um administrador (nenhum visitante escreve no banco).
     ======================================================================= */
  function nomeJogadorLimpo(nome) {
    return String(nome == null ? "" : nome).trim();
  }

  function chaveJogador(nome) {
    return nomeJogadorLimpo(nome).toLowerCase();
  }

  function gerarIdJogador(nome, idsUsados) {
    const base = slug(nome) || "jogador";
    let id = base, n = 2;
    while (idsUsados.has(id)) { id = base + "-" + n; n++; }
    idsUsados.add(id);
    return id;
  }

  /** Converte um elenco de qualquer formato antigo para [{id, nome}], sem duplicar. */
  function normalizarElenco(jogadores) {
    const lista = Array.isArray(jogadores) ? jogadores : [];
    const vistos = new Set(), ids = new Set(), saida = [];
    lista.forEach((j) => {
      const nome = nomeJogadorLimpo(typeof j === "string" ? j : (j && j.nome));
      if (!nome) return;
      const chave = chaveJogador(nome);
      if (vistos.has(chave)) return;   // já existe (ignora diferença de caixa)
      vistos.add(chave);
      const idExistente = (j && typeof j === "object" && j.id) ? String(j.id) : "";
      const id = (idExistente && !ids.has(idExistente))
        ? (ids.add(idExistente), idExistente)
        : gerarIdJogador(nome, ids);
      saida.push({ id, nome });
    });
    return saida;
  }

  /**
   * Backfill: garante que todo jogador que aparece nas súmulas (gols) exista
   * no elenco do seu time. Devolve um estado novo (não altera o recebido).
   */
  function aplicarMigracaoJogadores(estado) {
    const times = (estado.times || []).map((t) => Object.assign({}, t, {
      jogadores: normalizarElenco(t.jogadores),
    }));
    const porIdTime = Object.fromEntries(times.map((t) => [t.id, t]));

    (estado.jogos || []).forEach((j) => {
      (j.gols || []).forEach((g) => {
        const nome = nomeJogadorLimpo(g && g.jogador);
        const time = porIdTime[g && g.time];
        if (!nome || !time) return;
        const chave = chaveJogador(nome);
        if (time.jogadores.some((p) => chaveJogador(p.nome) === chave)) return;
        const ids = new Set(time.jogadores.map((p) => p.id));
        time.jogadores.push({ id: gerarIdJogador(nome, ids), nome });
      });
    });

    return Object.assign({}, estado, { times });
  }

  /** Elenco de um time, já normalizado. */
  function elencoDoTime(idTime) {
    const t = porId()[idTime];
    return (t && Array.isArray(t.jogadores)) ? t.jogadores : [];
  }

  /**
   * Garante que os jogadores citados nos gols existam nos elencos dos times.
   * Usado ao salvar um jogo: nome digitado que não está no elenco é criado.
   * Devolve quantos jogadores novos foram criados.
   */
  function garantirJogadoresDosGols(gols) {
    let criados = 0;
    const times = STATE.times.map((t) => Object.assign({}, t, {
      jogadores: normalizarElenco(t.jogadores),
    }));
    const porIdTime = Object.fromEntries(times.map((t) => [t.id, t]));

    (gols || []).forEach((g) => {
      const nome = nomeJogadorLimpo(g.jogador);
      const time = porIdTime[g.time];
      if (!nome || !time) return;
      const chave = chaveJogador(nome);
      if (time.jogadores.some((p) => chaveJogador(p.nome) === chave)) return;
      const ids = new Set(time.jogadores.map((p) => p.id));
      time.jogadores.push({ id: gerarIdJogador(nome, ids), nome });
      criados++;
    });

    if (criados) STATE.times = times;
    return criados;
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
        <img src="${srcEscudo(time.escudo)}" alt="${escapeHtml(time.nome)}" loading="lazy"
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

  function calcularMelhoresTerceiros(classificacoes) {
    const terceiros = STATE.grupos.map((grupo) => {
      const terceiro = classificacoes[grupo.id] && classificacoes[grupo.id][2];
      return terceiro ? { id: terceiro.id, pts: terceiro.pts, sg: terceiro.sg } : null;
    }).filter(Boolean);

    terceiros.sort((a, b) => b.pts - a.pts || b.sg - a.sg);
    return new Set(terceiros.slice(0, 2).map((time) => time.id));
  }

  function tabelaGrupoHTML(grupo, lista, melhoresTerceiros) {
    const classificam = STATE.config.classificadosPorGrupo || 2;
    if (!lista.length) return "";

    const linhas = lista.map((t, i) => {
      const pos = i + 1;
      const melhorTerceiro = pos === 3 && melhoresTerceiros.has(t.id);
      const zona = pos <= classificam
        ? "zona-classificacao"
        : melhorTerceiro ? "zona-melhor-terceiro" : "";
      const idx = porId()[t.id];
      const sg = t.sg > 0 ? "+" + t.sg : t.sg;
      const sgCls = t.sg > 0 ? "sg-pos" : t.sg < 0 ? "sg-neg" : "";
      return `
        <tr class="${zona}">
          <td class="col-pos"><span class="pos">${pos}${melhorTerceiro ? '<span class="sr-only">, melhor terceiro classificado</span>' : ""}</span></td>
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
    const classificacoes = Object.fromEntries(
      STATE.grupos.map((grupo) => [grupo.id, calcularGrupo(grupo.id)])
    );
    const melhoresTerceiros = calcularMelhoresTerceiros(classificacoes);
    const html = STATE.grupos.map((grupo) =>
      tabelaGrupoHTML(grupo, classificacoes[grupo.id], melhoresTerceiros)
    ).join("");
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
     ARTILHEIROS (ranking somado dos gols cadastrados nos jogos)
     ======================================================================= */
  let filtroArtGrupo = "todos";

  /**
   * Ranking de artilheiros — 100% derivado das súmulas (gols dos jogos).
   * O vínculo com o elenco é feito por (time + nome), sem diferenciar
   * maiúsculas/minúsculas, então "PEDRO" e "Pedro" do mesmo time somam
   * juntos; xarás de times diferentes continuam separados.
   */
  function calcularArtilheiros() {
    const idx = porId();
    const mapa = {}; // chave: time + "::" + nome (minúsculo)
    STATE.jogos.forEach((j) => {
      (j.gols || []).forEach((g) => {
        const nome = nomeJogadorLimpo(g.jogador);
        const qtd = Number(g.gols) || 0;
        if (!nome || qtd <= 0) return;
        const time = g.time || "";
        const chave = time + "::" + chaveJogador(nome);
        if (!mapa[chave]) {
          // nome exibido: o cadastrado no elenco (se houver), senão o da súmula
          const noElenco = elencoDoTime(time).find((p) => chaveJogador(p.nome) === chaveJogador(nome));
          mapa[chave] = {
            jogadorId: noElenco ? noElenco.id : "",
            jogador: noElenco ? noElenco.nome : nome,
            time,
            grupo: (idx[time] && idx[time].grupo) || "",
            gols: 0,
          };
        }
        mapa[chave].gols += qtd;
      });
    });
    const lista = Object.values(mapa);
    lista.sort((a, b) => b.gols - a.gols || a.jogador.localeCompare(b.jogador));
    return lista;
  }

  function renderChipsArtilheiros() {
    const chips = [{ id: "todos", nome: "Todos" }]
      .concat(STATE.grupos.map((g) => ({ id: g.id, nome: "Grupo " + g.id })));
    document.getElementById("filtro-grupos-art").innerHTML = chips.map((c) =>
      `<button class="chip ${filtroArtGrupo === c.id ? "ativo" : ""}" data-grupo-art="${c.id}">${c.nome}</button>`
    ).join("");
  }

  function renderArtilheiros() {
    renderChipsArtilheiros();
    const idx = porId();
    let lista = calcularArtilheiros();
    if (filtroArtGrupo !== "todos") lista = lista.filter((a) => a.grupo === filtroArtGrupo);

    // posição com empate no mesmo número de gols (mesma posição)
    let posAtual = 0, golsAnt = null;
    const html = lista.map((a, i) => {
      if (a.gols !== golsAnt) { posAtual = i + 1; golsAnt = a.gols; }
      const time = idx[a.time];
      const medalha = posAtual <= 3 ? `art-pos--m${posAtual}` : "";
      return `
        <div class="art-item">
          <span class="art-pos ${medalha}">${posAtual}º</span>
          ${escudoHTML(time, "sm")}
          <span class="art-nome">${escapeHtml(a.jogador)}
            <small>${escapeHtml(time ? time.nome : a.time)}</small>
          </span>
          <span class="art-gols">${a.gols}<small>${a.gols === 1 ? "gol" : "gols"}</small></span>
        </div>`;
    }).join("");

    document.getElementById("lista-artilheiros").innerHTML = html ||
      '<p class="vazio">Nenhum gol registrado ainda. Cadastre quem marcou ao editar um jogo.</p>';
    document.getElementById("qtd-artilheiros").textContent = lista.length;
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
    document.getElementById("filtro-grupos-art").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      filtroArtGrupo = b.dataset.grupoArt;
      renderArtilheiros();
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
  let filtroJogos = { de: "", ate: "", time: "", rodada: "", grupo: "", status: "" };

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
    // começa sempre com a lista completa e o filtro recolhido
    filtroJogos = { de: "", ate: "", time: "", rodada: "", grupo: "", status: "" };
    const detFiltros = document.getElementById("ger-filtros");
    if (detFiltros) detFiltros.open = false;
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
    document.querySelector(".ger-caixa").classList.toggle("ger-caixa--larga", abaGer === "banners");

    aplicarStatusNuvem();

    if (abaGer === "jogos") renderGerJogos();
    if (abaGer === "times") renderGerTimes();
    if (abaGer === "banners") renderGerBanner();
  }

  function opcoesTimes(selecionado) {
    return STATE.times.map((t) =>
      `<option value="${t.id}" ${t.id === selecionado ? "selected" : ""}>${escapeHtml(t.nome)} (${t.grupo})</option>`
    ).join("");
  }

  /* =======================================================================
     GERADOR DE BANNERS (estado somente local; nunca vai para o Firestore)
     ======================================================================= */
  const BANNER_LARGURA = 1080;
  const BANNER_ALTURAS = { story: 1920, feed: 1080 };
  const bannerEstado = {
    inicializado: false,
    tipo: "proximos",
    formato: "story",
    filtro: "todos",
    time: "",
    titulo: "JOGOS DA RODADA",
    subtitulo: "",
    subtituloEditado: false,
    fundo: "classico",
    fundoPersonalizado: "",
    fundoNome: "",
    selecionados: new Set(),
  };
  let bannerGerando = false;
  let bannerRevisao = 0;
  let bannerRevisaoRenderizada = -1;
  let bannerCanvasRenderizado = null;
  let bannerRenderPromise = null;
  let bannerRenderTimer = null;

  function tituloPadraoBanner() {
    return bannerEstado.tipo === "resultados" ? "RESULTADOS DA RODADA" : "JOGOS DA RODADA";
  }

  function jogosDoTipoBanner() {
    const resultados = bannerEstado.tipo === "resultados";
    return STATE.jogos
      .map((j, i) => ({ j, i }))
      .filter(({ j }) => jogoRealizado(j) === resultados)
      .sort((a, b) =>
        String(a.j.data || "9999-99-99").localeCompare(String(b.j.data || "9999-99-99")) ||
        String(a.j.hora || "").localeCompare(String(b.j.hora || "")) ||
        Number(a.j.rodada || 0) - Number(b.j.rodada || 0));
  }

  function jogosVisiveisBanner() {
    return jogosDoTipoBanner().filter(({ j }) => {
      if (bannerEstado.filtro.indexOf("grupo:") === 0) {
        if (grupoDoJogo(j) !== bannerEstado.filtro.slice(6)) return false;
      }
      if (bannerEstado.filtro.indexOf("rodada:") === 0) {
        if (String(j.rodada) !== bannerEstado.filtro.slice(7)) return false;
      }
      if (bannerEstado.time && j.mandante !== bannerEstado.time && j.visitante !== bannerEstado.time) return false;
      return true;
    });
  }

  function jogosSelecionadosBanner() {
    return jogosVisiveisBanner().filter(({ i }) => bannerEstado.selecionados.has(i));
  }

  function selecionarPadraoBanner() {
    bannerEstado.selecionados.clear();
    jogosVisiveisBanner().slice(0, 2).forEach(({ i }) => bannerEstado.selecionados.add(i));
  }

  function formatarDataCurtaBanner(iso) {
    if (!iso) return "DATA A DEFINIR";
    const partes = String(iso).split("-");
    if (partes.length !== 3) return String(iso);
    return `${partes[2]}/${partes[1]}`;
  }

  function subtituloSugeridoBanner() {
    const selecionados = jogosSelecionadosBanner();
    if (!selecionados.length) return "";

    const rodadas = Array.from(new Set(selecionados.map(({ j }) => j.rodada)
      .filter((r) => r !== "" && r != null)));
    const datas = Array.from(new Set(selecionados.map(({ j }) => j.data).filter(Boolean))).sort();
    const partes = [];

    if (rodadas.length === 1) partes.push(`RODADA ${rodadas[0]}`);
    if (datas.length) {
      const meses = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
        "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
      const datasPartes = datas.map((d) => d.split("-"));
      const mesmoMes = datasPartes.every((p) =>
        p.length === 3 && p[0] === datasPartes[0][0] && p[1] === datasPartes[0][1]);
      if (mesmoMes) {
        partes.push(`${datasPartes.map((p) => p[2]).join(" E ")} DE ${meses[Number(datasPartes[0][1]) - 1]}`);
      } else {
        partes.push(datas.map(formatarDataCurtaBanner).join(" E "));
      }
    }

    return partes.join(" · ");
  }

  function inicializarBanner() {
    if (bannerEstado.inicializado) return;
    bannerEstado.tipo = STATE.jogos.some((j) => !jogoRealizado(j)) ? "proximos" : "resultados";
    bannerEstado.titulo = tituloPadraoBanner();
    bannerEstado.inicializado = true;
    selecionarPadraoBanner();
    bannerEstado.subtitulo = subtituloSugeridoBanner();
  }

  function renderFiltrosBanner() {
    const select = document.getElementById("banner-filtro");
    const selectTime = document.getElementById("banner-time");
    const jogos = jogosDoTipoBanner();
    const gruposComJogos = STATE.grupos.filter((g) =>
      jogos.some(({ j }) => grupoDoJogo(j) === g.id));
    const rodadas = Array.from(new Set(jogos.map(({ j }) => j.rodada)
      .filter((r) => r !== "" && r != null)))
      .sort((a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true }));

    let html = `<option value="todos">Todos os jogos</option>`;
    if (gruposComJogos.length) {
      html += `<optgroup label="Grupos">${gruposComJogos.map((g) =>
        `<option value="grupo:${escapeHtml(g.id)}">${escapeHtml(g.nome)}</option>`).join("")}</optgroup>`;
    }
    if (rodadas.length) {
      html += `<optgroup label="Rodadas">${rodadas.map((r) =>
        `<option value="rodada:${escapeHtml(String(r))}">Rodada ${escapeHtml(String(r))}</option>`).join("")}</optgroup>`;
    }
    select.innerHTML = html;
    select.value = bannerEstado.filtro;
    if (!select.value) {
      bannerEstado.filtro = "todos";
      select.value = "todos";
    }

    selectTime.innerHTML = '<option value="">Todos os Times</option>' +
      STATE.times.map((t) =>
        `<option value="${escapeHtml(t.id)}">${escapeHtml(t.nome)}</option>`).join("");
    selectTime.value = bannerEstado.time;
    if (bannerEstado.time && !selectTime.value) bannerEstado.time = "";
  }

  function renderListaJogosBanner() {
    const visiveis = jogosVisiveisBanner();
    const validos = new Set(visiveis.map(({ i }) => i));
    bannerEstado.selecionados = new Set(
      Array.from(bannerEstado.selecionados).filter((i) => validos.has(i))
    );

    document.getElementById("banner-jogos-lista").innerHTML = visiveis.map(({ j, i }) => {
      const realizado = jogoRealizado(j);
      const placar = realizado ? ` · ${j.golsMandante} × ${j.golsVisitante}` : "";
      const meta = [
        grupoDoJogo(j) ? `Grupo ${grupoDoJogo(j)}` : "",
        j.rodada ? `Rodada ${j.rodada}` : "",
        formatarDataCurtaBanner(j.data),
        j.hora || "",
      ].filter(Boolean).join(" · ");
      return `
        <label class="banner-jogo-opcao">
          <input type="checkbox" data-banner-jogo="${i}" ${bannerEstado.selecionados.has(i) ? "checked" : ""}>
          <span class="banner-jogo-opcao-texto">
            <b>${escapeHtml(nomeTime(j.mandante))} × ${escapeHtml(nomeTime(j.visitante))}${escapeHtml(placar)}</b>
            <small>${escapeHtml(meta)}</small>
          </span>
        </label>`;
    }).join("") || `<p class="banner-jogos-vazio">Nenhum ${bannerEstado.tipo === "resultados" ? "resultado" : "próximo jogo"} disponível com este filtro.</p>`;

    const quantidade = bannerEstado.selecionados.size;
    document.getElementById("banner-selecionados-contagem").textContent =
      `${quantidade} ${quantidade === 1 ? "selecionado" : "selecionados"}`;
  }

  function srcLogoCampeonatoBanner() {
    const logo = STATE.config.logo || "campeonato.webp";
    if (logo.indexOf("http") === 0 || logo.indexOf("data:") === 0 || logo.indexOf("blob:") === 0) return logo;
    return comVersao("assets/img/" + logo);
  }

  function bannerEscudoHTML(time) {
    const nome = time ? time.nome : "Time";
    const src = time && time.escudo ? srcEscudo(time.escudo) : "";
    return `<span class="banner-escudo" style="--cor:${time ? corDoTime(time.id) : "#315c49"}">
      <span>${escapeHtml(iniciais(nome))}</span>
      ${src ? `<img src="${escapeHtml(src)}" alt="" crossorigin="anonymous" onerror="this.remove()">` : ""}
    </span>`;
  }

  function tituloEmLinhasBanner(titulo) {
    const palavras = String(titulo || "").trim().toLocaleUpperCase("pt-BR").split(/\s+/).filter(Boolean);
    if (!palavras.length) return { superior: "JOGOS DA", destaque: "RODADA" };

    const rodada = palavras.lastIndexOf("RODADA");
    if (rodada > 0 && rodada === palavras.length - 1) {
      return {
        superior: palavras.slice(0, rodada).join(" "),
        destaque: palavras[rodada],
      };
    }

    if (palavras.length === 1) return { superior: palavras[0], destaque: "" };
    const corte = Math.max(1, Math.ceil(palavras.length / 2));
    return {
      superior: palavras.slice(0, corte).join(" "),
      destaque: palavras.slice(corte).join(" "),
    };
  }

  function dataDestaqueBanner(jogos) {
    const meses = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
      "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
    const texto = String(bannerEstado.subtitulo || "").trim().toLocaleUpperCase("pt-BR");
    const mesesRegex = meses.join("|");
    const noTexto = texto.match(new RegExp(`(\\d{1,2})(?:\\s+E\\s+\\d{1,2})?\\s+DE\\s+(${mesesRegex})`));
    const direto = texto.match(new RegExp(`\\b(\\d{1,2})\\s+(${mesesRegex})\\b`));
    const encontrado = noTexto || direto;
    if (encontrado) {
      return { dia: encontrado[1].padStart(2, "0"), mes: encontrado[2] };
    }

    const primeiraData = jogos.map(({ j }) => j.data).find(Boolean);
    const partes = String(primeiraData || "").split("-");
    if (partes.length === 3) {
      return {
        dia: partes[2].padStart(2, "0"),
        mes: meses[Number(partes[1]) - 1] || "MÊS",
      };
    }
    return { dia: "--", mes: "A DEFINIR" };
  }

  function autoresGolsBanner(jogo, timeId) {
    if (!jogoRealizado(jogo) || !Array.isArray(jogo.gols)) return "";
    return jogo.gols
      .filter((gol) => gol && gol.time === timeId && String(gol.jogador || "").trim())
      .map((gol) => {
        const nome = String(gol.jogador).trim();
        const quantidade = Math.max(1, Number(gol.gols) || 1);
        return quantidade > 1 ? `${nome} (${quantidade})` : nome;
      })
      .join(" · ");
  }

  function autoresGolsHTML(texto) {
    if (!texto) return "";
    const classeLonga = texto.length > 26 ? " banner-goleadores--longo" : "";
    return `<span class="banner-goleadores${classeLonga}">${escapeHtml(texto)}</span>`;
  }

  function bannerJogoHTML(j) {
    const idx = porId();
    const mandante = idx[j.mandante] || { id: j.mandante, nome: nomeTime(j.mandante), escudo: "" };
    const visitante = idx[j.visitante] || { id: j.visitante, nome: nomeTime(j.visitante), escudo: "" };
    const realizado = jogoRealizado(j);
    const nomeMandante = String(mandante.nome || "");
    const nomeVisitante = String(visitante.nome || "");
    const golsMandante = autoresGolsBanner(j, mandante.id);
    const golsVisitante = autoresGolsBanner(j, visitante.id);
    const temGoleadores = !!(golsMandante || golsVisitante);
    const data = formatarDataCurtaBanner(j.data);
    const hora = j.hora || "--:--";
    const centro = realizado
      ? `<div class="banner-placar"><b>${escapeHtml(String(j.golsMandante))}</b><span>×</span><b>${escapeHtml(String(j.golsVisitante))}</b></div>`
      : `<div class="banner-versus">VS</div>`;

    return `<article class="banner-card-jogo${temGoleadores ? " banner-card-jogo--com-goleadores" : ""}">
      <div class="banner-equipe banner-equipe--mandante">
        ${bannerEscudoHTML(mandante)}
        <span class="banner-time-nome ${nomeMandante.length > 14 ? "banner-time-nome--longo" : ""}">${escapeHtml(nomeMandante)}</span>
        ${autoresGolsHTML(golsMandante)}
      </div>
      <div class="banner-confronto">
        ${centro}
        <div class="banner-card-tags">
          <span class="banner-tag banner-tag--data"><i>▦</i><b>${escapeHtml(data)}</b></span>
          <span class="banner-tag banner-tag--hora"><i>◷</i><b>${escapeHtml(hora)}</b></span>
        </div>
      </div>
      <div class="banner-equipe banner-equipe--visitante">
        ${bannerEscudoHTML(visitante)}
        <span class="banner-time-nome ${nomeVisitante.length > 14 ? "banner-time-nome--longo" : ""}">${escapeHtml(nomeVisitante)}</span>
        ${autoresGolsHTML(golsVisitante)}
      </div>
    </article>`;
  }

  function bannerArteHTML(jogos) {
    const titulo = bannerEstado.titulo.trim() || tituloPadraoBanner();
    const tituloLinhas = tituloEmLinhasBanner(titulo);
    const dataDestaque = dataDestaqueBanner(jogos);
    const logoCampeonato = escapeHtml(srcLogoCampeonatoBanner());
    const logosInstitucionais = escapeHtml(comVersao("assets/img/banners/logos-institucionais-gameleiras.webp"));
    const bolaFutebol = escapeHtml(comVersao("assets/img/banners/bola-futebol.png"));
    const corpo = jogos.length
      ? `<div class="banner-arte-jogos" style="--qtd-jogos:${jogos.length}">${jogos.map(({ j }) => bannerJogoHTML(j)).join("")}</div>`
      : `<div class="banner-arte-vazio">Selecione ao menos um jogo para montar o banner</div>`;

    return `
      <header class="banner-arte-cabecalho">
        <span class="banner-logo-campeonato"><img src="${logoCampeonato}" alt="" crossorigin="anonymous"></span>
        <div class="banner-chamada">
          <div class="banner-titulos">
            <span class="banner-titulo-superior">${escapeHtml(tituloLinhas.superior)}</span>
            ${tituloLinhas.destaque ? `<span class="banner-titulo-destaque">${escapeHtml(tituloLinhas.destaque)}</span>` : ""}
          </div>
          <div class="banner-data-destaque">
            <div class="banner-data-conteudo">
              <strong>${escapeHtml(dataDestaque.dia)}</strong>
              <span>${escapeHtml(dataDestaque.mes)}</span>
              <small>★ &nbsp;·&nbsp; ★</small>
            </div>
          </div>
        </div>
      </header>
      <main class="banner-arte-corpo">${corpo}</main>
      <footer class="banner-arte-rodape">
        <div class="banner-frase">
          <img src="${bolaFutebol}" alt="" crossorigin="anonymous">
          <div>
            <strong>MUITO ALÉM DOS <em>90 MINUTOS</em></strong>
            <span>Futebol une <b>histórias, famílias e gerações.</b></span>
          </div>
          <img src="${bolaFutebol}" alt="" crossorigin="anonymous">
        </div>
        <div class="banner-patrocinadores">
          <img class="banner-logos-institucionais" src="${logosInstitucionais}" alt="" crossorigin="anonymous">
        </div>
      </footer>`;
  }

  function renderizarArteBanner(elemento, jogos) {
    const temaPersonalizado = bannerEstado.fundo === "personalizado" && bannerEstado.fundoPersonalizado;
    const tema = temaPersonalizado ? "personalizado" :
      (bannerEstado.fundo === "noturno" || bannerEstado.fundo === "dourado" ? bannerEstado.fundo : "classico");
    const tamanhoTitulo = bannerEstado.titulo.trim().length;
    const tituloLongo = tamanhoTitulo > 25;
    const tituloMuitoLongo = tamanhoTitulo > 38;
    const subtituloLongo = bannerEstado.subtitulo.trim().length > 42;
    const denso = jogos.length > 3;

    elemento.className = `banner-arte banner-arte--${bannerEstado.formato} banner-tema--${tema}` +
      (tituloLongo ? " banner-titulo--longo" : "") +
      (tituloMuitoLongo ? " banner-titulo--muito-longo" : "") +
      (subtituloLongo ? " banner-subtitulo--longo" : "");
    elemento.dataset.jogos = String(jogos.length);
    elemento.dataset.denso = denso ? "true" : "false";
    elemento.style.removeProperty("background-image");
    if (temaPersonalizado) {
      elemento.style.backgroundImage =
        `linear-gradient(rgba(3,25,16,.66), rgba(2,15,10,.8)), url("${bannerEstado.fundoPersonalizado}")`;
    }
    elemento.innerHTML = bannerArteHTML(jogos);
  }

  function configurarCanvasBanner(elemento, formato = bannerEstado.formato) {
    if (!elemento) return;
    elemento.className = `banner-render-canvas banner-render-canvas--${formato}`;
  }

  function ajustarEscalaPreviewBanner() {
    const viewport = document.getElementById("banner-preview-viewport");
    const stage = document.getElementById("banner-preview-stage");
    if (!viewport || !stage) return;
    const estilo = getComputedStyle(viewport);
    const paddingHorizontal = parseFloat(estilo.paddingLeft) + parseFloat(estilo.paddingRight);
    const larguraDisponivel = Math.max(1, viewport.clientWidth - paddingHorizontal);
    const altura = BANNER_ALTURAS[bannerEstado.formato];
    const escala = Math.min(1, Math.max(.1, larguraDisponivel / BANNER_LARGURA));
    stage.style.width = `${BANNER_LARGURA * escala}px`;
    stage.style.height = `${altura * escala}px`;
  }

  function atualizarPreviewBanner() {
    bannerRevisao += 1;
    const dimensoes = bannerEstado.formato === "story" ? "1080 × 1920" : "1080 × 1080";
    document.getElementById("banner-resolucao").textContent = `${dimensoes} PNG`;
    document.getElementById("banner-preview-formato").textContent =
      `${bannerEstado.formato === "story" ? "Story" : "Feed"} · ${dimensoes}`;
    requestAnimationFrame(ajustarEscalaPreviewBanner);
    agendarRenderPreviewBanner();
  }

  function definirStatusBanner(texto, tipo) {
    const status = document.getElementById("banner-status");
    status.textContent = texto || "";
    status.className = "banner-status" + (tipo ? ` banner-status--${tipo}` : "");
  }

  function sincronizarControlesBanner() {
    document.querySelectorAll('input[name="banner-tipo"]').forEach((input) => {
      input.checked = input.value === bannerEstado.tipo;
    });
    document.querySelectorAll('input[name="banner-formato"]').forEach((input) => {
      input.checked = input.value === bannerEstado.formato;
    });
    document.getElementById("banner-titulo").value = bannerEstado.titulo;
    document.getElementById("banner-subtitulo").value = bannerEstado.subtitulo;
    document.getElementById("banner-fundo").value = bannerEstado.fundo;
    document.getElementById("banner-time").value = bannerEstado.time;
    document.getElementById("banner-fundo-nome").textContent =
      bannerEstado.fundoNome || "Nenhuma imagem selecionada";
    document.querySelector('[data-acao="banner-remover-fundo"]').hidden = !bannerEstado.fundoPersonalizado;
  }

  function renderGerBanner() {
    inicializarBanner();
    renderFiltrosBanner();
    renderListaJogosBanner();
    sincronizarControlesBanner();
    atualizarPreviewBanner();
  }

  function aoTrocarTipoBanner(tipo) {
    bannerEstado.tipo = tipo;
    bannerEstado.filtro = "todos";
    bannerEstado.time = "";
    bannerEstado.titulo = tituloPadraoBanner();
    bannerEstado.subtituloEditado = false;
    renderFiltrosBanner();
    selecionarPadraoBanner();
    bannerEstado.subtitulo = subtituloSugeridoBanner();
    renderListaJogosBanner();
    sincronizarControlesBanner();
    atualizarPreviewBanner();
    definirStatusBanner("");
  }

  function aoTrocarFiltroBanner(filtro) {
    bannerEstado.filtro = filtro;
    selecionarPadraoBanner();
    if (!bannerEstado.subtituloEditado) bannerEstado.subtitulo = subtituloSugeridoBanner();
    renderListaJogosBanner();
    sincronizarControlesBanner();
    atualizarPreviewBanner();
    definirStatusBanner("");
  }

  function aoTrocarTimeBanner(time) {
    bannerEstado.time = time;
    selecionarPadraoBanner();
    if (!bannerEstado.subtituloEditado) bannerEstado.subtitulo = subtituloSugeridoBanner();
    renderListaJogosBanner();
    sincronizarControlesBanner();
    atualizarPreviewBanner();
    definirStatusBanner("");
  }

  function atualizarSubtituloAutomaticoBanner() {
    if (!bannerEstado.subtituloEditado) {
      bannerEstado.subtitulo = subtituloSugeridoBanner();
      document.getElementById("banner-subtitulo").value = bannerEstado.subtitulo;
    }
  }

  function lerArquivoComoDataURL(file) {
    return new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(leitor.result);
      leitor.onerror = () => reject(leitor.error);
      leitor.readAsDataURL(file);
    });
  }

  function carregarImagemDataURL(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function prepararFundoBanner(file) {
    const dataUrl = await lerArquivoComoDataURL(file);
    const img = await carregarImagemDataURL(dataUrl);
    const maximo = 2400;
    const escala = Math.min(1, maximo / Math.max(img.naturalWidth, img.naturalHeight));
    if (escala === 1) return dataUrl;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", .92);
  }

  async function carregarFundoPersonalizadoBanner(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      definirStatusBanner("Escolha uma imagem PNG, JPG ou WebP.", "erro");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      definirStatusBanner("A imagem deve ter no máximo 12 MB.", "erro");
      return;
    }
    definirStatusBanner("Preparando imagem de fundo…");
    try {
      bannerEstado.fundoPersonalizado = await prepararFundoBanner(file);
      bannerEstado.fundoNome = file.name;
      bannerEstado.fundo = "personalizado";
      sincronizarControlesBanner();
      atualizarPreviewBanner();
      definirStatusBanner("Imagem personalizada aplicada.", "ok");
    } catch (e) {
      definirStatusBanner("Não foi possível abrir essa imagem.", "erro");
    }
  }

  function removerFundoPersonalizadoBanner() {
    bannerEstado.fundoPersonalizado = "";
    bannerEstado.fundoNome = "";
    bannerEstado.fundo = "classico";
    document.getElementById("banner-fundo-arquivo").value = "";
    sincronizarControlesBanner();
    atualizarPreviewBanner();
    definirStatusBanner("Fundo padrão restaurado.", "ok");
  }

  function esperarImagensBanner(elemento) {
    return Promise.all(Array.from(elemento.querySelectorAll("img")).map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        const concluir = () => resolve();
        img.addEventListener("load", concluir, { once: true });
        img.addEventListener("error", concluir, { once: true });
        setTimeout(concluir, 6000);
      });
    }));
  }

  async function esperarFontesBanner() {
    if (!document.fonts) return;
    await Promise.all([
      document.fonts.load('400 156px "Anton"', "JOGOS DA RODADA VS 0123456789"),
      document.fonts.load('700 51px "Barlow Condensed"', "08/08 13:20 AGOSTO GAMELEIRAS"),
      document.fonts.load('700 21px "Inter"', "RESULTADOS HISTÓRIAS FAMÍLIAS GERAÇÕES"),
    ]);
    await document.fonts.ready;
  }

  function exibirCanvasPreviewBanner(canvas) {
    const stage = document.getElementById("banner-preview-stage");
    canvas.id = "banner-preview-bitmap";
    canvas.className = "banner-preview-bitmap";
    canvas.removeAttribute("style");
    canvas.setAttribute("aria-label", "Prévia exata do banner");
    stage.replaceChildren(canvas);
    requestAnimationFrame(ajustarEscalaPreviewBanner);
  }

  async function capturarCanvasBanner() {
    if (typeof window.html2canvas !== "function") {
      throw new Error("O exportador html2canvas não foi carregado");
    }

    const formato = bannerEstado.formato;
    const altura = BANNER_ALTURAS[formato];
    const jogos = jogosSelecionadosBanner();
    const alvo = document.getElementById("banner-export-canvas");
    configurarCanvasBanner(alvo, formato);
    renderizarArteBanner(document.getElementById("banner-export"), jogos);
    await esperarFontesBanner();
    await esperarImagensBanner(alvo);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    return window.html2canvas(alvo, {
      scale: 1,
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      logging: false,
      width: BANNER_LARGURA,
      height: altura,
      windowWidth: BANNER_LARGURA,
      windowHeight: altura,
    });
  }

  async function processarFilaRenderBanner() {
    try {
      while (bannerRevisaoRenderizada !== bannerRevisao) {
        const revisao = bannerRevisao;
        const canvas = await capturarCanvasBanner();
        if (revisao !== bannerRevisao) continue;

        bannerCanvasRenderizado = canvas;
        bannerRevisaoRenderizada = revisao;
        exibirCanvasPreviewBanner(canvas);
      }
      return bannerCanvasRenderizado;
    } finally {
      bannerRenderPromise = null;
      if (bannerRevisaoRenderizada !== bannerRevisao) agendarRenderPreviewBanner();
    }
  }

  function garantirCanvasBanner() {
    if (bannerRenderTimer) {
      clearTimeout(bannerRenderTimer);
      bannerRenderTimer = null;
    }
    if (bannerCanvasRenderizado && bannerRevisaoRenderizada === bannerRevisao) {
      return Promise.resolve(bannerCanvasRenderizado);
    }
    if (!bannerRenderPromise) bannerRenderPromise = processarFilaRenderBanner();
    return bannerRenderPromise;
  }

  function agendarRenderPreviewBanner() {
    if (bannerRenderTimer) clearTimeout(bannerRenderTimer);
    bannerRenderTimer = setTimeout(() => {
      bannerRenderTimer = null;
      garantirCanvasBanner().catch((erro) => {
        console.error("Erro ao atualizar prévia do banner:", erro);
        definirStatusBanner("Não foi possível atualizar a prévia.", "erro");
      });
    }, 120);
  }

  async function atualizarPreviewAgoraBanner() {
    atualizarPreviewBanner();
    definirStatusBanner("Atualizando prévia…");
    try {
      await garantirCanvasBanner();
      definirStatusBanner("Prévia atualizada. O download será exatamente igual.", "ok");
    } catch (erro) {
      console.error("Erro ao atualizar prévia do banner:", erro);
      definirStatusBanner("Não foi possível atualizar a prévia.", "erro");
    }
  }

  function nomeArquivoBanner() {
    const tipo = bannerEstado.tipo === "resultados" ? "resultados" : "proximos-jogos";
    const formato = bannerEstado.formato === "feed" ? "feed" : "story";
    const data = new Date().toISOString().slice(0, 10);
    return `campeonato-gameleiras-${tipo}-${formato}-${data}.png`;
  }

  function canvasParaBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  function definirBotoesBannerDesabilitados(desabilitados) {
    document.querySelectorAll(".banner-acoes .btn").forEach((botao) => {
      botao.disabled = desabilitados;
    });
  }

  async function gerarBlobBanner() {
    if (bannerGerando) return null;
    const jogos = jogosSelecionadosBanner();
    if (!jogos.length) {
      definirStatusBanner("Selecione pelo menos um jogo.", "erro");
      return null;
    }
    if (typeof window.html2canvas !== "function") {
      definirStatusBanner("O exportador não carregou. Verifique a internet e tente novamente.", "erro");
      return null;
    }

    bannerGerando = true;
    definirBotoesBannerDesabilitados(true);
    definirStatusBanner("Gerando PNG em alta resolução…");
    try {
      const canvas = await garantirCanvasBanner();
      const blob = await canvasParaBlob(canvas);
      if (!blob) throw new Error("Falha ao converter o canvas");
      definirStatusBanner(`PNG pronto: ${canvas.width} × ${canvas.height}px.`, "ok");
      return { blob, nome: nomeArquivoBanner(), largura: canvas.width, altura: canvas.height };
    } catch (e) {
      console.error("Erro ao gerar banner:", e);
      definirStatusBanner("Não foi possível gerar o PNG. Tente novamente.", "erro");
      return null;
    } finally {
      bannerGerando = false;
      definirBotoesBannerDesabilitados(false);
    }
  }

  function baixarArquivoBanner(blob, nome) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function baixarBanner() {
    const arquivo = await gerarBlobBanner();
    if (!arquivo) return;
    baixarArquivoBanner(arquivo.blob, arquivo.nome);
    definirStatusBanner(`Banner baixado em ${arquivo.largura} × ${arquivo.altura}px.`, "ok");
  }

  async function compartilharBanner() {
    const arquivo = await gerarBlobBanner();
    if (!arquivo) return;
    const file = new File([arquivo.blob], arquivo.nome, { type: "image/png" });
    const dados = {
      files: [file],
      title: bannerEstado.titulo.trim() || tituloPadraoBanner(),
      text: "Campeonato Municipal de Futebol de Gameleiras",
    };
    const podeCompartilhar = typeof navigator.share === "function" &&
      (!navigator.canShare || navigator.canShare({ files: [file] }));

    if (podeCompartilhar) {
      try {
        await navigator.share(dados);
        definirStatusBanner("Banner enviado para compartilhamento.", "ok");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") {
          definirStatusBanner("Compartilhamento cancelado.");
          return;
        }
      }
    }

    baixarArquivoBanner(arquivo.blob, arquivo.nome);
    definirStatusBanner("Compartilhamento direto indisponível; o PNG foi baixado.", "ok");
  }

  /* ---------- Salvar na nuvem (com feedback visual e reversão em erro) ---------- */
  // Firestore rejeita documentos acima de ~1MB. Como TUDO (times + jogos) vai
  // num único documento, checamos o tamanho total antes de enviar e barramos
  // com uma mensagem clara, em vez de deixar o salvamento falhar em silêncio.
  const LIMITE_DOC_BYTES = 800 * 1024; // folga segura abaixo do limite real de 1MiB do Firestore
  async function salvarNuvem(botao) {
    const tamanho = new Blob([JSON.stringify(STATE)]).size;
    if (tamanho > LIMITE_DOC_BYTES) {
      alert("Não foi possível salvar: os dados ficaram grandes demais para a nuvem " +
        "(provavelmente muitos escudos pesados). Troque algum escudo por uma imagem mais leve.");
      STATE = CLOUD_STATE ? JSON.parse(JSON.stringify(CLOUD_STATE)) : JSON.parse(JSON.stringify(PUBLICADO));
      renderTudo();
      if (modalAberto) renderGerenciador();
      return false;
    }
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

  /* ---------- Filtros da lista de jogos (client-side) ---------- */
  function contarFiltrosAtivos() {
    const f = filtroJogos;
    return [f.de, f.ate, f.time, f.rodada, f.grupo, f.status].filter((v) => v !== "" && v != null).length;
  }

  function jogoPassaFiltro(j) {
    const f = filtroJogos;
    if (f.de && (!j.data || j.data < f.de)) return false;
    if (f.ate && (!j.data || j.data > f.ate)) return false;
    if (f.time && j.mandante !== f.time && j.visitante !== f.time) return false;
    if (f.rodada && String(j.rodada) !== String(f.rodada)) return false;
    if (f.grupo && grupoDoJogo(j) !== f.grupo) return false;
    if (f.status === "encerrado" && !jogoRealizado(j)) return false;
    if (f.status === "aberto" && jogoRealizado(j)) return false;
    return true;
  }

  // Preenche/atualiza os controles do filtro (só quando o gerenciador (re)abre
  // ou os dados mudam) — preservando a seleção atual do usuário.
  function renderFiltrosJogos() {
    const timeSel = document.getElementById("ff-time");
    timeSel.innerHTML = '<option value="">Todos os times</option>' +
      STATE.times.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join("");
    timeSel.value = filtroJogos.time; filtroJogos.time = timeSel.value;

    const rodadas = Array.from(new Set(STATE.jogos.map((j) => j.rodada).filter((r) => r !== "" && r != null)))
      .sort((a, b) => Number(a) - Number(b));
    const rodSel = document.getElementById("ff-rodada");
    rodSel.innerHTML = '<option value="">Todas</option>' +
      rodadas.map((r) => `<option value="${r}">Rodada ${r}</option>`).join("");
    rodSel.value = filtroJogos.rodada; filtroJogos.rodada = rodSel.value;

    const grpSel = document.getElementById("ff-grupo");
    grpSel.innerHTML = '<option value="">Todos</option>' +
      STATE.grupos.map((g) => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("");
    grpSel.value = filtroJogos.grupo; filtroJogos.grupo = grpSel.value;

    // Situação tem opções fixas no HTML; só restauramos a seleção.
    const statusSel = document.getElementById("ff-status");
    statusSel.value = filtroJogos.status; filtroJogos.status = statusSel.value;

    document.getElementById("ff-de").value = filtroJogos.de;
    document.getElementById("ff-ate").value = filtroJogos.ate;
  }

  function lerFiltrosJogosDoDOM() {
    filtroJogos = {
      de: document.getElementById("ff-de").value,
      ate: document.getElementById("ff-ate").value,
      time: document.getElementById("ff-time").value,
      rodada: document.getElementById("ff-rodada").value,
      grupo: document.getElementById("ff-grupo").value,
      status: document.getElementById("ff-status").value,
    };
  }

  function limparFiltrosJogos() {
    filtroJogos = { de: "", ate: "", time: "", rodada: "", grupo: "", status: "" };
    renderFiltrosJogos();
    desenharListaJogos();
  }

  /* ---------- Gerenciar JOGOS ---------- */
  function renderGerJogos() {
    // A barra de filtros só faz sentido se há jogos para filtrar.
    document.getElementById("ger-filtros").style.display = STATE.jogos.length ? "" : "none";
    renderFiltrosJogos();
    desenharListaJogos();
  }

  function desenharListaJogos() {
    // Preserva o índice ORIGINAL de cada jogo (para editar/excluir continuarem
    // corretos mesmo com a lista filtrada) e mostra só os que passam no filtro.
    const visiveis = STATE.jogos
      .map((j, i) => ({ j, i }))
      .filter((o) => jogoPassaFiltro(o.j));

    const lista = visiveis.map(({ j, i }) => {
      const placar = jogoRealizado(j) ? `${j.golsMandante} × ${j.golsVisitante}` : "— × —";
      return `
        <div class="ger-item">
          <div class="ger-item-info">
            <span class="ger-item-tit"><span class="gi-time">${escapeHtml(nomeTime(j.mandante))}</span> <b class="gi-placar">${placar}</b> <span class="gi-time">${escapeHtml(nomeTime(j.visitante))}</span></span>
            <span class="ger-item-sub">${grupoDoJogo(j) ? "Grupo " + grupoDoJogo(j) + " · " : ""}${j.rodada ? "Rod " + escapeHtml(String(j.rodada)) + " · " : ""}${escapeHtml(j.data || "sem data")}</span>
          </div>
          <div class="ger-item-acoes">
            <button class="btn-mini" data-editar-jogo="${i}">Editar</button>
            <button class="btn-mini btn-mini--del" data-excluir-jogo="${i}">Excluir</button>
          </div>
        </div>`;
    }).join("");

    const temFiltro = contarFiltrosAtivos() > 0;
    document.getElementById("ger-jogos-lista").innerHTML = lista ||
      (temFiltro
        ? '<p class="vazio">Nenhum jogo encontrado com esses filtros.</p>'
        : '<p class="vazio">Nenhum jogo. Clique em "Novo jogo".</p>');

    // Contagem e selo de filtros ativos
    const total = STATE.jogos.length, mostrando = visiveis.length;
    const contagem = document.getElementById("ff-contagem");
    if (contagem) contagem.textContent = temFiltro ? `${mostrando} de ${total} jogos` : `${total} jogos`;
    const badge = document.getElementById("ger-filtros-badge");
    if (badge) {
      const n = contarFiltrosAtivos();
      badge.textContent = n;
      badge.hidden = n === 0;
    }
  }

  function formJogo(idx) {
    // Ao criar um jogo novo, limpa os filtros para ele não "sumir" da lista
    // caso um filtro ativo não combine com o jogo recém-criado.
    if (idx == null) {
      filtroJogos = { de: "", ate: "", time: "", rodada: "", grupo: "", status: "" };
    }
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
      <div class="campo campo--gols">
        <label>Quem fez os gols <small>(opcional — alimenta os Artilheiros)</small></label>
        <div id="fj-datalists" hidden></div>
        <div id="fj-gols-lista" class="gols-lista"></div>
        <button type="button" class="btn-mini" id="fj-add-gol">+ Adicionar gol</button>
      </div>
      <div class="ger-form-botoes">
        <button class="btn btn--verde" id="fj-salvar">Salvar jogo</button>
        <button class="btn btn--ghost" id="fj-cancelar">Cancelar</button>
      </div>`;
    document.getElementById("ger-form-jogo").style.display = "block";
    document.getElementById("ger-jogos-lista").style.display = "none";
    document.getElementById("ger-filtros").style.display = "none";
    document.querySelector('[data-acao="novo-jogo"]').style.display = "none";

    golsForm = (j.gols || []).map((g) => ({ time: g.time || "", jogador: g.jogador || "", gols: Number(g.gols) || 1 }));
    atualizarDatalistJogadores();
    renderGolsForm();
    document.getElementById("fj-add-gol").onclick = adicionarGol;
    document.getElementById("fj-mandante").addEventListener("change", aoMudarTimeDoJogo);
    document.getElementById("fj-visitante").addEventListener("change", aoMudarTimeDoJogo);

    document.getElementById("fj-salvar").onclick = salvarFormJogo;
    document.getElementById("fj-cancelar").onclick = () => { fecharFormJogo(); };
  }

  /* ---------- Sub-formulário: gols marcados no jogo ---------- */
  let golsForm = [];

  /** id do <datalist> de sugestões de um time (um por time do confronto). */
  function idDatalistDoTime(idTime) {
    return "fj-dl-" + slug(idTime || "sem-time");
  }

  /**
   * Cria um <datalist> por time do confronto, cada um só com os jogadores
   * DAQUELE time — assim a sugestão nunca mistura o elenco dos dois lados.
   */
  function atualizarDatalistJogadores() {
    const cont = document.getElementById("fj-datalists");
    if (!cont) return;
    const m = document.getElementById("fj-mandante").value;
    const v = document.getElementById("fj-visitante").value;
    const times = [m, v].filter((x, i, a) => x && a.indexOf(x) === i);
    cont.innerHTML = times.map((idTime) => {
      const opcoes = elencoDoTime(idTime)
        .map((p) => `<option value="${escapeHtml(p.nome)}"></option>`).join("");
      return `<datalist id="${idDatalistDoTime(idTime)}">${opcoes}</datalist>`;
    }).join("");
  }

  function opcoesTimesDoJogo(sel) {
    const m = document.getElementById("fj-mandante").value;
    const v = document.getElementById("fj-visitante").value;
    return [m, v].filter((x, i, a) => x && a.indexOf(x) === i)
      .map((id) => `<option value="${id}" ${id === sel ? "selected" : ""}>${escapeHtml(nomeTime(id))}</option>`).join("");
  }

  function renderGolsForm() {
    const cont = document.getElementById("fj-gols-lista");
    if (!cont) return;
    cont.innerHTML = golsForm.map((g, i) => `
      <div class="gol-row">
        <select class="gol-time" data-i="${i}">${opcoesTimesDoJogo(g.time)}</select>
        <input type="text" class="gol-jogador" data-i="${i}" list="${idDatalistDoTime(g.time)}" value="${escapeHtml(g.jogador || "")}" placeholder="Jogador" autocomplete="off">
        <input type="number" min="1" class="gol-qtd" data-i="${i}" value="${g.gols || 1}" aria-label="Gols">
        <button type="button" class="btn-mini btn-mini--del gol-remover" data-i="${i}" aria-label="Remover">✕</button>
      </div>`).join("");
    // ao trocar o time da linha, o autocomplete precisa passar a sugerir o
    // elenco do time novo — por isso a linha é redesenhada
    cont.querySelectorAll(".gol-time").forEach((el) => el.onchange = () => {
      golsForm[Number(el.dataset.i)].time = el.value;
      renderGolsForm();
    });
    cont.querySelectorAll(".gol-jogador").forEach((el) => el.oninput = () => { golsForm[Number(el.dataset.i)].jogador = el.value; });
    cont.querySelectorAll(".gol-qtd").forEach((el) => el.oninput = () => { golsForm[Number(el.dataset.i)].gols = Number(el.value) || 0; });
    cont.querySelectorAll(".gol-remover").forEach((el) => el.onclick = () => { golsForm.splice(Number(el.dataset.i), 1); renderGolsForm(); });
  }

  function adicionarGol() {
    const m = document.getElementById("fj-mandante").value;
    golsForm.push({ time: m || "", jogador: "", gols: 1 });
    renderGolsForm();
    // foca no campo de jogador da linha recém-criada
    const inputs = document.querySelectorAll("#fj-gols-lista .gol-jogador");
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function aoMudarTimeDoJogo() {
    // se um gol estava num time que saiu do confronto, joga pro mandante atual
    const m = document.getElementById("fj-mandante").value;
    const v = document.getElementById("fj-visitante").value;
    golsForm.forEach((g) => { if (g.time !== m && g.time !== v) g.time = m; });
    atualizarDatalistJogadores();
    renderGolsForm();
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

    const gols = golsForm
      .map((g) => ({ time: g.time, jogador: nomeJogadorLimpo(g.jogador), gols: Number(g.gols) || 0 }))
      .filter((g) => g.time && g.jogador && g.gols > 0);
    if (gols.length) jogo.gols = gols;

    // Nome digitado que ainda não existe no elenco do time vira jogador novo
    // automaticamente — assim ele já aparece no autocomplete na próxima vez.
    const novosJogadores = garantirJogadoresDosGols(gols);

    STATE.jogos = STATE.jogos.slice();
    if (idxRaw === "") STATE.jogos.push(jogo);
    else STATE.jogos[Number(idxRaw)] = jogo;

    const ok = await salvarNuvem(document.getElementById("fj-salvar"));
    if (!ok) return;

    if (novosJogadores) {
      alert(novosJogadores === 1
        ? "1 jogador novo foi adicionado ao elenco do time."
        : novosJogadores + " jogadores novos foram adicionados aos elencos dos times.");
    }

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

  let elencoForm = []; // jogadores do time sendo editado

  function formTime(idx) {
    const t = idx != null ? STATE.times[idx] : { id: "", nome: "", grupo: STATE.grupos[0] && STATE.grupos[0].id, escudo: "" };
    elencoForm = normalizarElenco(t.jogadores);
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
      <div class="campo">
        <label>Elenco (jogadores) <small>(opcional — usado para marcar os gols)</small></label>
        <div class="elenco-add">
          <input type="text" id="ft-jogador" placeholder="Nome do jogador" autocomplete="off">
          <button type="button" class="btn-mini" id="ft-add-jogador">+ Adicionar</button>
        </div>
        <div id="ft-elenco" class="elenco-chips"></div>
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
    document.getElementById("ft-add-jogador").onclick = adicionarJogadorElenco;
    document.getElementById("ft-jogador").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); adicionarJogadorElenco(); }
    });
    renderElencoChips();
  }

  function renderElencoChips() {
    const cont = document.getElementById("ft-elenco");
    if (!cont) return;
    const golsPorJogador = golsDoElencoAtual();
    cont.innerHTML = elencoForm.length
      ? elencoForm.map((p, i) => {
          const gols = golsPorJogador[chaveJogador(p.nome)] || 0;
          // Quem já marcou gol não pode sair do elenco sem antes perder o vínculo
          // com a súmula — senão o artilheiro ficaria "solto".
          const selo = gols ? `<i class="elenco-gols" title="${gols} gol(s) na súmula">${gols}</i>` : "";
          const remover = gols
            ? `<button type="button" class="elenco-travado" data-jogador-com-gol="${gols}" aria-label="Não pode remover">🔒</button>`
            : `<button type="button" data-remover-jogador="${i}" aria-label="Remover">✕</button>`;
          return `<span class="elenco-chip">${escapeHtml(p.nome)}${selo}${remover}</span>`;
        }).join("")
      : '<span class="elenco-vazio">Nenhum jogador cadastrado.</span>';

    cont.querySelectorAll("[data-remover-jogador]").forEach((b) =>
      b.onclick = () => { elencoForm.splice(Number(b.dataset.removerJogador), 1); renderElencoChips(); });
    cont.querySelectorAll("[data-jogador-com-gol]").forEach((b) =>
      b.onclick = () => alert("Esse jogador tem " + b.dataset.jogadorComGol +
        " gol(s) registrado(s) nos jogos. Remova os gols dele nas súmulas antes de tirá-lo do elenco."));
  }

  /** Quantos gols cada jogador do time em edição tem nas súmulas. */
  function golsDoElencoAtual() {
    const idTime = (document.getElementById("ft-id") || {}).value || "";
    const mapa = {};
    if (!idTime) return mapa;
    STATE.jogos.forEach((j) => (j.gols || []).forEach((g) => {
      if (g.time !== idTime) return;
      const k = chaveJogador(g.jogador);
      if (k) mapa[k] = (mapa[k] || 0) + (Number(g.gols) || 0);
    }));
    return mapa;
  }

  function adicionarJogadorElenco() {
    const inp = document.getElementById("ft-jogador");
    const nome = nomeJogadorLimpo(inp.value);
    if (!nome) return;
    if (elencoForm.some((p) => chaveJogador(p.nome) === chaveJogador(nome))) {
      alert("Esse jogador já está no elenco.");
    } else {
      const ids = new Set(elencoForm.map((p) => p.id));
      elencoForm.push({ id: gerarIdJogador(nome, ids), nome });
      renderElencoChips();
    }
    inp.value = "";
    inp.focus();
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

  // Comprime a imagem com FORÇA e garante que a STRING base64 final caiba num
  // limite pequeno — o Firestore aceita no máximo 1MB por documento, e esse
  // documento guarda TODOS os times e jogos, então cada escudo precisa ser leve.
  // Medimos o tamanho real da string (nº de caracteres ≈ bytes) e exigimos
  // <= 100KB; se nem no ajuste mais agressivo couber, retorna null (bloqueia).
  const LIMITE_ESCUDO_BYTES = 100 * 1024; // 100 KB
  async function processarImagemEscudo(file) {
    const img = await carregarImagem(file);
    // Tentativas progressivamente mais agressivas: [lado máximo, qualidade webp]
    const tentativas = [
      [320, 0.6], [288, 0.55], [256, 0.5], [224, 0.5],
      [192, 0.45], [160, 0.4], [128, 0.4], [96, 0.35],
    ];
    for (const [lado, qualidade] of tentativas) {
      const dataUrl = desenharCanvas(img, lado).toDataURL("image/webp", qualidade);
      if (dataUrl.length <= LIMITE_ESCUDO_BYTES) return dataUrl;
    }
    return null; // não coube em 100KB nem no menor tamanho/mais comprimido
  }

  async function aoEscolherEscudo(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Escolha um arquivo de imagem (PNG, JPG ou WEBP)."); e.target.value = ""; return; }
    if (file.size > 15 * 1024 * 1024) { alert("Essa imagem é muito grande (máximo 15MB)."); e.target.value = ""; return; }
    try {
      const dataUrl = await processarImagemEscudo(file);
      if (!dataUrl) { alert("A imagem escolhida é muito pesada mesmo após compressão. Escolha um arquivo menor."); return; }
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

    const jogadores = elencoForm.slice();
    STATE.times = STATE.times.map((t) => Object.assign({}, t));

    if (idxRaw === "") {
      if (STATE.times.some((t) => t.id === id)) { alert("Já existe um time com esse ID."); return; }
      STATE.times.push({ id, nome, grupo, escudo, jogadores });
    } else {
      const t = STATE.times[Number(idxRaw)];
      t.nome = nome; t.grupo = grupo; t.escudo = escudo; t.jogadores = jogadores;
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

    // Filtro em tempo real: ao mexer em qualquer campo, refiltra a lista
    // (não re-renderiza a barra, para não perder foco/seleção do usuário).
    document.getElementById("ger-filtros").addEventListener("input", (e) => {
      if (e.target.closest("#ff-de, #ff-ate, #ff-time, #ff-rodada, #ff-grupo, #ff-status")) {
        lerFiltrosJogosDoDOM();
        desenharListaJogos();
      }
    });

    document.getElementById("ger-modal").addEventListener("input", (e) => {
      if (e.target.id === "banner-titulo") {
        bannerEstado.titulo = e.target.value;
        atualizarPreviewBanner();
      } else if (e.target.id === "banner-subtitulo") {
        bannerEstado.subtitulo = e.target.value;
        bannerEstado.subtituloEditado = true;
        atualizarPreviewBanner();
      }
    });

    document.getElementById("ger-modal").addEventListener("change", (e) => {
      if (e.target.matches('input[name="banner-tipo"]')) {
        aoTrocarTipoBanner(e.target.value);
      } else if (e.target.matches('input[name="banner-formato"]')) {
        bannerEstado.formato = e.target.value;
        atualizarPreviewBanner();
        definirStatusBanner("");
      } else if (e.target.id === "banner-filtro") {
        aoTrocarFiltroBanner(e.target.value);
      } else if (e.target.id === "banner-time") {
        aoTrocarTimeBanner(e.target.value);
      } else if (e.target.matches("[data-banner-jogo]")) {
        const indice = Number(e.target.dataset.bannerJogo);
        if (e.target.checked) bannerEstado.selecionados.add(indice);
        else bannerEstado.selecionados.delete(indice);
        atualizarSubtituloAutomaticoBanner();
        renderListaJogosBanner();
        atualizarPreviewBanner();
        definirStatusBanner("");
      } else if (e.target.id === "banner-fundo") {
        bannerEstado.fundo = e.target.value;
        atualizarPreviewBanner();
        if (bannerEstado.fundo === "personalizado" && !bannerEstado.fundoPersonalizado) {
          definirStatusBanner("Escolha uma imagem para usar o fundo personalizado.");
        } else {
          definirStatusBanner("");
        }
      } else if (e.target.id === "banner-fundo-arquivo") {
        carregarFundoPersonalizadoBanner(e.target.files && e.target.files[0]);
      }
    });

    document.getElementById("ger-modal").addEventListener("click", (e) => {
      const t = e.target.closest("[data-acao],[data-editar-jogo],[data-excluir-jogo],[data-editar-time],[data-excluir-time]");
      if (!t) return;
      if (t.dataset.acao === "novo-jogo") formJogo(null);
      else if (t.dataset.acao === "novo-time") formTime(null);
      else if (t.dataset.acao === "semear") semearNuvem();
      else if (t.dataset.acao === "limpar-filtros") limparFiltrosJogos();
      else if (t.dataset.acao === "banner-selecionar-todos") {
        bannerEstado.selecionados = new Set(jogosVisiveisBanner().map(({ i }) => i));
        atualizarSubtituloAutomaticoBanner();
        renderListaJogosBanner();
        atualizarPreviewBanner();
      }
      else if (t.dataset.acao === "banner-limpar-selecao") {
        bannerEstado.selecionados.clear();
        atualizarSubtituloAutomaticoBanner();
        renderListaJogosBanner();
        atualizarPreviewBanner();
      }
      else if (t.dataset.acao === "banner-remover-fundo") removerFundoPersonalizadoBanner();
      else if (t.dataset.acao === "banner-atualizar") {
        bannerEstado.titulo = document.getElementById("banner-titulo").value;
        bannerEstado.subtitulo = document.getElementById("banner-subtitulo").value;
        atualizarPreviewAgoraBanner();
      }
      else if (t.dataset.acao === "banner-baixar") baixarBanner();
      else if (t.dataset.acao === "banner-compartilhar") compartilharBanner();
      else if (t.dataset.editarJogo != null) formJogo(Number(t.dataset.editarJogo));
      else if (t.dataset.excluirJogo != null) excluirJogo(Number(t.dataset.excluirJogo));
      else if (t.dataset.editarTime != null) formTime(Number(t.dataset.editarTime));
      else if (t.dataset.excluirTime != null) excluirTime(Number(t.dataset.excluirTime));
    });

    window.addEventListener("resize", ajustarEscalaPreviewBanner);

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
    renderArtilheiros();
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
