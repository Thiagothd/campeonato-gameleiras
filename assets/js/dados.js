/* =========================================================================
   DADOS DO CAMPEONATO — CAMPEONATO MUNICIPAL DE FUTEBOL DE GAMELEIRAS
   =========================================================================

   Este arquivo é só a "semente" inicial / fallback: o que aparece na
   primeira fração de segundo antes do site conectar na nuvem, e o que
   aparece se a internet cair. A fonte de verdade dos dados é o banco
   (Firebase) — todo mundo que abre o site vê a mesma coisa, ao vivo.

   Você NÃO precisa editar este arquivo no dia a dia:
     -> Use o botão "Gerenciar" no site (canto inferior direito, com senha).
        Lá você cadastra times, cria jogos e digita o placar. Assim que
        salva, atualiza para TODO MUNDO na hora, em qualquer lugar.

   A senha do Gerenciador NÃO fica mais neste arquivo — ela é gerenciada
   no Firebase (Console → Authentication → Users → admin@gameleiras.com).
   Para trocar a senha, mude ela lá.

   A tabela de classificação é SEMPRE calculada a partir dos jogos.
   ========================================================================= */

const CAMPEONATO = {
  nome: "Campeonato Municipal de Futebol",
  cidade: "Gameleiras",
  temporada: "2026",
  slogan: "Muito além dos 90 minutos",
  logo: "campeonato.webp",           // arquivo em assets/img/
  pontosVitoria: 3,
  pontosEmpate: 1,
  pontosDerrota: 0,
  classificadosPorGrupo: 2,         // quantos de cada grupo avançam (zona verde)
};

/* -------------------------------------------------------------------------
   GRUPOS
   ------------------------------------------------------------------------- */
const GRUPOS = [
  { id: "A", nome: "Grupo A" },
  { id: "B", nome: "Grupo B" },
  { id: "C", nome: "Grupo C" }
];

/* -------------------------------------------------------------------------
   TIMES  (id = apelido curto, sem espaço/acento — não muda depois de criado)
   Escudos ficam em assets/img/times/
   ------------------------------------------------------------------------- */
const TIMES = [
  // ---- Grupo A ----
  { id: "raposa",       nome: "Raposa F.C.",       grupo: "A", escudo: "raposa.webp" },
  { id: "corre-nada",   nome: "Corre Nada",        grupo: "A", escudo: "corre-nada.webp" },
  { id: "vereda-jacu",  nome: "Vereda do Jacu",    grupo: "A", escudo: "vereda-jacu.webp" },
  { id: "vereda-brejo", nome: "Vereda do Brejo",   grupo: "A", escudo: "vereda-brejo.webp" },
  { id: "nova-era",     nome: "Nova Era",          grupo: "A", escudo: "nova-era.webp" },

  // ---- Grupo B ----
  { id: "engenho",      nome: "Engenho",           grupo: "B", escudo: "engenho.webp" },
  { id: "malhadinha",   nome: "Malhadinha",        grupo: "B", escudo: "malhadinha.webp" },
  { id: "ef-gama",      nome: "EF Gama",           grupo: "B", escudo: "ef-gama.webp", chip: true },
  { id: "boa-vista",    nome: "Boa Vista",         grupo: "B", escudo: "boa-vista.webp" },

  // ---- Grupo C ----
  { id: "gameleiras",   nome: "Gameleira F.C.",    grupo: "C", escudo: "gameleiras.webp" },
  { id: "verdao",       nome: "Verdão",            grupo: "C", escudo: "verdao.webp" },
  { id: "jacu-fc",      nome: "Jacu FC",           grupo: "C", escudo: "jacu-fc.webp" },
  { id: "vila-jacu",    nome: "Vila do Jacu",      grupo: "C", escudo: "vila-jacu.webp" }
];

/* -------------------------------------------------------------------------
   JOGOS
   -------------------------------------------------------------------------
   - "mandante" e "visitante" usam o "id" do time.
   - Jogo já realizado: preencha "golsMandante" e "golsVisitante".
   - Jogo futuro: deixe os gols como null.
   - "grupo" é opcional (o site descobre pelo time), mas ajuda a organizar.

   OBS: os jogos abaixo foram lançados a partir dos resultados/tabelas
   enviados. Os marcados com  // CONFERIR  tiveram o placar deduzido pela
   pontuação/saldo do print — confira o placar exato no Gerenciador.
   ------------------------------------------------------------------------- */
const JOGOS = [
  /* ===================== GRUPO C ===================== */
  { grupo: "C", rodada: 1, mandante: "gameleiras", visitante: "verdao",
    golsMandante: 3, golsVisitante: 1, data: "2026-07-05", hora: "", local: "Arena Jatobá" }, // CONFERIR placar/data
  { grupo: "C", rodada: 2, mandante: "gameleiras", visitante: "jacu-fc",
    golsMandante: 6, golsVisitante: 0, data: "2026-07-12", hora: "13:20", local: "Arena Jatobá" },

  /* ===================== GRUPO B ===================== */
  { grupo: "B", rodada: 1, mandante: "malhadinha", visitante: "boa-vista",
    golsMandante: 6, golsVisitante: 0, data: "2026-07-05", hora: "", local: "Arena Jatobá" }, // CONFERIR placar/data
  { grupo: "B", rodada: 1, mandante: "engenho", visitante: "ef-gama",
    golsMandante: 2, golsVisitante: 0, data: "2026-07-05", hora: "", local: "Arena Jatobá" }, // CONFERIR placar/data
  { grupo: "B", rodada: 2, mandante: "engenho", visitante: "boa-vista",
    golsMandante: 2, golsVisitante: 0, data: "2026-07-11", hora: "15:20", local: "Arena Jatobá" },

  /* ===================== GRUPO A ===================== */
  { grupo: "A", rodada: 2, mandante: "raposa", visitante: "corre-nada",
    golsMandante: 0, golsVisitante: 0, data: "2026-07-11", hora: "13:20", local: "Arena Jatobá" },
  { grupo: "A", rodada: 2, mandante: "vereda-brejo", visitante: "vereda-jacu",
    golsMandante: 1, golsVisitante: 1, data: "2026-07-12", hora: "15:20", local: "Arena Jatobá" },

  // >>> FALTAM os jogos da 1ª rodada do Grupo A (as vitórias de Raposa e Corre
  //     Nada, e a derrota do Nova Era). Adicione pelo Gerenciador que a tabela
  //     do Grupo A fecha certinho com o print.

  /* ===================== PRÓXIMOS JOGOS (exemplos — edite/remova) =====================
  { grupo: "A", rodada: 3, mandante: "nova-era", visitante: "raposa",
    golsMandante: null, golsVisitante: null, data: "2026-07-19", hora: "15:00", local: "Arena Jatobá" },
  */
];
