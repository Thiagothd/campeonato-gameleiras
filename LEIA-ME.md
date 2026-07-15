# Campeonato Municipal de Futebol de Gameleiras ⚽

Site da tabela do campeonato. A **classificação é calculada automaticamente** a
partir dos resultados dos jogos, separada por **Grupo A, B e C**.

Os dados ficam salvos **na nuvem** (Firebase): qualquer pessoa com a senha do
Gerenciador consegue entrar de qualquer lugar (celular, computador, em casa,
no jogo) e o que ela salvar aparece **na hora** para todo mundo que estiver
com o site aberto — sem precisar dar F5.

⚠️ Por causa disso, o site precisa ser **aberto por um link publicado**
(ex.: GitHub Pages) — duplo clique direto no `index.html` não funciona mais
(o navegador bloqueia a conexão com a nuvem quando o arquivo é aberto
localmente). Use sempre o link publicado.

---

## Como atualizar: botão "Gerenciar"

No site, canto inferior direito, há o botão **🔒 Gerenciar**.

1. Clique nele e digite a senha (a senha fica guardada no Firebase, não no
   código — veja "Trocar a senha" abaixo).
2. Aba **Jogos & Placares**: crie jogos, digite o placar e salve.
3. Aba **Times**: cadastre/edite times e o arquivo do escudo.
4. Pronto — assim que salva, **todo mundo já vê** a tabela atualizada.

No mesmo aparelho, depois de digitar a senha uma vez, ele **lembra** — não
pede de novo.

### Indicador de conexão
No canto inferior esquerdo do site aparece um selo:
- 🟢 **Ao vivo** — conectado, tudo em dia.
- 🟡 **Conectando…** — carregando.
- 🔴 **Sem conexão** — sem internet no momento; o site mostra os últimos
  dados que conseguiu carregar até a conexão voltar.

---

## Banco de dados vazio (situação rara)
Se o banco da nuvem for apagado ou zerar por algum motivo, o site mostra um
aviso amarelo dentro do Gerenciador com o botão **"Enviar dados iniciais"** —
clique nele para publicar de novo os times e jogos que estão no arquivo
`assets/js/dados.js` como ponto de partida. Isso já aconteceu uma vez, na
primeira configuração do site, e não deve ser necessário de novo.

## Trocar a senha do Gerenciador
A senha é controlada pelo Firebase, não pelo código do site:
1. Acesse **console.firebase.google.com** → projeto `campeonato-gameleiras`.
2. **Authentication → Users** → clique nos três pontinhos do usuário
   `admin@gameleiras.com` → **Redefinir senha**.

---

## Escudos e logo
- **Escudos dos times:** `assets/img/times/` (nomes sem espaço/acento — ex.: `raposa.webp`).
- **Logo do campeonato:** `assets/img/campeonato.webp`.
- Depois de trocar uma imagem, avise para subir a versão de cache (`CACHE_VER`
  em `assets/js/app.js` e os `?v=` no `index.html`) — assim o navegador de
  todo mundo baixa a imagem nova em vez da antiga guardada em cache.

## O que o site faz sozinho
- Soma pontos (vitória = 3, empate = 1) por grupo.
- Calcula J, V, E, D, gols pró/contra e saldo.
- Ordena com desempate: Pontos → já jogou → Vitórias → Saldo → Gols pró → Nome.
- Marca a zona de classificação (verde) dos 2 primeiros de cada grupo.
- Separa **Resultados** e **Próximos Jogos**, com filtro por grupo.

## Conferir depois
- **Grupo A:** faltam os jogos da 1ª rodada (as vitórias de Raposa e Corre Nada e a
  derrota do Nova Era). Adicione pelo Gerenciador que a tabela fecha certinho.
- Jogos marcados com `// CONFERIR` no `dados.js` (dados de fallback/backup)
  tiveram o placar deduzido pela pontuação — confira o placar exato.

## Detalhes técnicos (se algum dia precisar mexer)
- Banco: **Firestore** (Google Firebase), documento único `campeonato/dados`.
- Regras de segurança: qualquer um lê; só quem estiver autenticado escreve
  (ver `firestore.rules` no projeto).
- Login: uma conta administradora única (`admin@gameleiras.com`) — quando
  alguém digita a senha certa no Gerenciador, o site entra nessa conta por
  baixo dos panos (sem tela de login visível).
- `assets/js/db.js`: conexão com o Firebase.
- `assets/js/dados.js`: dados de fallback (primeira pintura da tela / modo
  sem internet) — não é mais a fonte de verdade.
