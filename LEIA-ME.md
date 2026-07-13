# Campeonato Municipal de Futebol de Gameleiras ⚽

Site da tabela do campeonato. A **classificação é calculada automaticamente** a
partir dos resultados dos jogos, separada por **Grupo A, B e C**.

Funciona de dois jeitos:
- **Offline:** duplo clique no `index.html` abre no navegador.
- **Publicado (online):** hospede a pasta num link (ex.: GitHub Pages, Netlify).

---

## Jeito FÁCIL de atualizar: botão "Gerenciar"

No site, canto inferior direito, há o botão **🔒 Gerenciar**.

1. Clique nele e digite a senha (padrão: **`gameleiras2026`** — dá para trocar no `dados.js`).
2. Aba **Jogos & Placares**: crie jogos, digite o placar e salve. A tabela atualiza sozinha.
3. Aba **Times**: cadastre/edite times e o arquivo do escudo.
4. Tudo fica salvo **no seu navegador** (não some ao fechar).

### Para todos verem no site publicado
As alterações do Gerenciador ficam só no SEU navegador. Para publicar:
1. No Gerenciador, aba **Publicar** → **Baixar dados.js atualizado**.
2. Substitua o arquivo `assets/js/dados.js` pelo que baixou.
3. Suba (republique) o site.

---

## Jeito MANUAL (editar o arquivo)

Abra **`assets/js/dados.js`** no Bloco de Notas / VS Code.

### Times
```js
{ id: "raposa", nome: "Raposa F.C.", grupo: "A", escudo: "raposa.png" },
```
- `id`: apelido curto, **sem espaço e sem acento** (não muda depois).
- `grupo`: `"A"`, `"B"` ou `"C"`.
- `escudo`: nome do arquivo em `assets/img/times/`. Deixe `""` para mostrar as iniciais.

### Jogos
```js
{ grupo: "C", rodada: 2, mandante: "gameleiras", visitante: "jacu-fc",
  golsMandante: 6, golsVisitante: 0, data: "2026-07-12", hora: "13:20", local: "Arena Jatobá" },
```
- **Jogo realizado** → preencha os gols.
- **Próximo jogo** → deixe os gols como `null`.
- `data` sempre **ANO-MÊS-DIA** (ex.: `2026-07-19`).

Depois de salvar, atualize a página com **F5**.

---

## Escudos e logo
- **Escudos dos times:** `assets/img/times/` (use nomes sem espaço/acento — ex.: `raposa.png`).
- **Logo do campeonato:** `assets/img/campeonato.png`.
- Imagens quadradas (ex.: 400x400) em `.png`/`.jpg` funcionam melhor.

## O que o site faz sozinho
- Soma pontos (vitória = 3, empate = 1) por grupo.
- Calcula J, V, E, D, gols pró/contra e saldo.
- Ordena com desempate: Pontos → já jogou → Vitórias → Saldo → Gols pró → Nome.
- Marca a zona de classificação (verde) dos 2 primeiros de cada grupo.
- Separa **Resultados** e **Próximos Jogos**, com filtro por grupo.

## Conferir depois
- **Grupo A:** faltam os jogos da 1ª rodada (as vitórias de Raposa e Corre Nada e a
  derrota do Nova Era). Adicione pelo Gerenciador que a tabela fecha certinho.
- Jogos marcados com `// CONFERIR` no `dados.js` tiveram o placar deduzido pela
  pontuação — confira o placar exato.
