# CONTEXTO.md — Campeonato de Gameleiras

> **Para qualquer IA (Claude, Codex, etc.) que for trabalhar neste projeto:**
> Leia este arquivo INTEIRO antes de fazer qualquer alteração. Ao terminar sua
> tarefa (ou se for interrompido/ficar sem tokens no meio dela), **atualize
> este arquivo** com: o que foi feito, quais arquivos mudaram, o que falta,
> como testar, e qualquer decisão/problema importante. Isso é o que permite
> a próxima IA (ou o próximo humano) continuar sem perder o fio.

---

## 1. O que é este projeto

Site estático (HTML/CSS/JS puro, sem framework, sem build step) do
**Campeonato Municipal de Futebol de Gameleiras**. Mostra classificação por
grupos, jogos/resultados, ranking de artilheiros e lista de times. Tem um
painel **"Gerenciar"** (protegido por senha) onde os organizadores cadastram
jogos, placares, times e escudos — tudo isso salva na nuvem (Firebase) e
atualiza **em tempo real** para todo mundo que estiver com o site aberto. O
painel também tem um gerador local de banners; essa ferramenta não grava
nada no Firebase.

- **Site em produção (usuários reais, dono é cliente "Speedline"):**
  https://campeonato.speedlinemg.com.br
- **Dono do domínio/Cloudflare:** cliente da agência "Speedline" (por isso o
  logo da Speedline aparece no rodapé do site).
- **Repositório GitHub:** `Thiagothd/campeonato-gameleiras` (branch `main` =
  produção). Também existe um mirror antigo em GitHub Pages
  (`thiagothd.github.io/campeonato-gameleiras`) que não é mais o site
  principal, mas ainda recebe os pushes de `main` (inofensivo, ninguém usa).

## 2. Arquitetura técnica

```
index.html              — página única, todas as abas/painéis
assets/js/dados.js      — dados de FALLBACK (semente inicial / modo offline)
assets/js/db.js         — conexão com Firebase (Firestore + Auth), módulo ES
assets/js/app.js        — toda a lógica: render, filtros, Gerenciador, etc.
assets/css/estilo.css   — todo o CSS (identidade visual verde-escuro/dourado)
assets/img/             — logo do campeonato, escudos dos times, logo Speedline
firestore.rules         — regras de segurança do Firestore (documentado, ver §6)
wrangler.toml           — config do Cloudflare Pages
deploy-cloudflare-pages.ps1 — script que publica em produção (ver §5)
.assetsignore           — filtra o que o Cloudflare Pages publica (CUIDADO, ver §6)
backups/                — backups de código+banco feitos antes de deploys (gitignored)
```

**Como os dados funcionam:** existe **um único documento** no Firestore
(`campeonato/dados`) com tudo: `config`, `grupos`, `times`, `jogos`. O app
carrega `dados.js` primeiro (pintura instantânea, fallback), depois conecta
no Firebase via `onSnapshot` e substitui pelos dados reais assim que chegam.
Qualquer alteração no Gerenciador reescreve o documento inteiro
(`setDoc`), com uma trava de tamanho (800KB) porque o Firestore tem limite
de ~1MB por documento.

**Autenticação do Gerenciador:** não tem tela de login visível. Existe uma
conta administradora única no Firebase Auth (`admin@gameleiras.com`); quando
alguém digita a senha certa no botão "🔒 Gerenciar", o site faz login nessa
conta por baixo dos panos. A senha real fica só no Firebase Console
(Authentication → Users), não em nenhum arquivo do repositório.

**Escudos de time:** podem ser um arquivo estático antigo
(`assets/img/times/*.webp`) OU uma imagem enviada pelo Gerenciador
(comprimida no navegador via `<canvas>` e guardada como `data:` URI **dentro
do próprio documento do Firestore** — não usa Firebase Storage porque agora
exige plano pago; ver `processarImagemEscudo` em app.js).

**Gerador de banners:** usa `html2canvas@1.4.1` minificado e fixado via
jsDelivr no `index.html`. O template de captura usa dimensões nativas fixas
de 1080×1920 (Story) ou 1080×1080 (Feed), com `scale: 1` e `useCORS: true`.
A prévia exibe o próprio canvas nativo redimensionado apenas visualmente, e o
download reutiliza esse mesmo canvas; assim, prévia e PNG possuem exatamente
os mesmos pixels. Escudos/logos usam caminhos locais ou data URI; o fundo
enviado pelo usuário é processado localmente e limitado a 12 MB. O estado do
editor existe apenas em memória e nunca entra em `STATE`.
O visual padrão segue o modelo de referência aprovado pelo cliente: fundo
de estádio noturno com holofotes, pincelada branca sob o logo, título em
duas linhas, data em box lateral, cards escuros com `VS`/placar e tags de
data/hora, frase com bolas e faixa branca institucional no rodapé. A
moldura fica isolada em `assets/css/banner-modelo.css`; fundos, bola e
marcas institucionais ficam em `assets/img/banners/`.

**Versionamento de cache:** todo CSS/JS é servido com `?v=N` no
`index.html`, e existe `const CACHE_VER = "N"` em `app.js` (usado só pra
imagens/logo, `comVersao()`). **⚠️ REGRA IMPORTANTE:** sempre que qualquer
CSS ou JS mudar, incremente **TODOS** os `?v=` do `index.html` (dados.js,
db.js, app.js, estilo.css e banner-modelo.css) e o `CACHE_VER` do app.js,
para o mesmo número novo. Já tivemos um bug real de produção por esquecer
disso (cache
misturando JS antigo com HTML novo). Valor atual em produção: **v=27**.
A branch `feat/gerador-banners` está em **v=39** enquanto aguarda validação
do cliente e eventual deploy.

## 3. Como o deploy funciona (IMPORTANTE)

Produção **NÃO** tem deploy automático via GitHub. Publicar exige rodar
manualmente (PowerShell, na raiz do projeto):

```powershell
.\deploy-cloudflare-pages.ps1
```

**As credenciais já estão salvas** (desde 04/08/2026, a pedido do dono) como
variáveis de ambiente **do usuário do Windows** — `CLOUDFLARE_API_TOKEN` e
`CLOUDFLARE_ACCOUNT_ID`. Não é mais preciso pedir o token a cada deploy.
Elas ficam **fora do repositório** (que é público) — nunca as escreva em
nenhum arquivo do projeto. Para conferir/trocar:
`[Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "...", "User")`.
O `Get-RequiredEnv` do script procura no processo e depois nos escopos
User/Machine, então funciona em qualquer terminal.

Se algum dia precisar gerar um token novo: dash.cloudflare.com → My Profile
→ API Tokens → Create Custom Token, com permissões
`Account > Cloudflare Pages > Edit` + `Zone > DNS > Edit`
(escopo: zona `speedlinemg.com.br`).

O script: cria/atualiza o projeto Cloudflare Pages, roda
`wrangler pages deploy .`, garante o domínio customizado e o registro DNS
CNAME.

**O deploy é só de arquivos estáticos — nunca toca no banco (Firestore).**
Então "backup do banco" antes de um deploy de código é precaução, não
necessidade estrita.

## 4. Processo de trabalho que SEMPRE seguimos (não pule etapas)

1. Criar uma branch nova (`feat/nome-da-coisa`) — nunca commitar direto em `main`.
2. Implementar a mudança.
3. **Testar de forma isolada, sem tocar produção**: gerar um preview
   (arquivo HTML único, com CSS/JS/imagens embutidos como `data:` URI, e um
   "stub" de `window.CampDB` que simula a nuvem com dados de exemplo — ver
   padrão em conversas anteriores, script tipo `demo-build.js`).
   **NUNCA escreva esse arquivo de preview dentro da pasta do projeto** —
   sempre num diretório fora (ex.: pasta temp/scratchpad). Isso já causou um
   susto: um preview esquecido na raiz quase foi publicado como página
   pública.
4. Validar com Puppeteer/Chrome headless: sintaxe (`node --check`), lógica
   (valores calculados corretos), visual em vários tamanhos (320/360/768/
   desktop), retrocompatibilidade (dados de produção reais NÃO têm certos
   campos novos — o app precisa continuar funcionando sem erro).
5. Só com tudo validado: merge pra `main`, push no GitHub, **backup do
   banco + do código real de produção** (baixar via curl/REST, guardar em
   `backups/`), depois rodar o deploy.
6. Verificar produção no ar de verdade (não confiar só no "deploy disse
   sucesso" — checar HTTP, abrir com Puppeteer, comparar banco antes/depois).

## 5. Estado atual (últimas entregas concluídas e publicadas)

**Gerador de banners — CONCLUÍDO e EM PRODUÇÃO** (deploy em 04/08/2026,
v=39, verificado ponta a ponta):
- Aba "Gerar Banner" no Gerenciador: monta artes 1080×1920 (Story) ou
  1080×1080 (Feed) a partir dos jogos, com filtro por grupo/time, seleção
  de jogos, título customizável e download em PNG.
- `html2canvas@1.4.1` via CDN jsDelivr (com `defer`), template visual em
  `assets/css/banner-modelo.css`, artes em `assets/img/banners/`.
  Nada do editor entra no `STATE` nem no Firebase.
- Auditoria antes do deploy: diff **puramente aditivo** (app.js 791+/1−,
  sendo a única remoção o `CACHE_VER`; estilo.css 686+/0−) → nenhuma função
  existente alterada. Regressão zero nas 4 abas públicas. Imagens novas
  confirmadas publicáveis. Com o CDN bloqueado, o site público segue 100%
  funcional (só o export do banner degrada, com guarda no código).
- ⚠️ **Pendência conhecida (não bloqueia):** todo visitante baixa ~435 KB
  extras por visita (194 KB do html2canvas + 241 KB da imagem de fundo),
  mesmo sem abrir o Gerenciador. Medido com Puppeteer. A otimização
  (carregar os dois sob demanda, só ao abrir a aba de banner) ficou como
  próxima tarefa, para não misturar mudanças num deploy já validado.

**Ajustes visuais (itens 1 e 3) — CONCLUÍDOS e EM PRODUÇÃO** (deploy em
29/07/2026, v=27, verificado ponta a ponta):
- **Melhores terceiros** (`calcularMelhoresTerceiros` em app.js): compara os
  3ºs colocados de todos os grupos por pontos → saldo de gols; os 2 melhores
  recebem faixa azul (`.zona-melhor-terceiro`, `--azul-classificacao: #4aa3ff`
  — mesmo tom do badge do Grupo A). Recalculado a cada atualização de dados.
  Inclui texto acessível (`.sr-only`) para leitores de tela. A legenda de
  zona ("Zona de classificação") foi REMOVIDA a pedido do cliente.
- **Favicon**: `<link rel="icon">` no `<head>` apontando para
  `assets/img/campeonato.webp?v=27` (a logo oficial já otimizada).
- Validado antes do deploy: 6 casos de borda da lógica (grupo com <3 times,
  banco vazio, empate absoluto triplo, desempate por saldo), dados REAIS de
  produção, visual em 320/360/768/1120px, regressão zero nas abas
  Jogos/Artilheiros/Times, zero erros de JS. Confirmado em produção depois
  do deploy: Nova Era e Vila do Jacu em azul, EF Gama fora (saldo -7).

**Feature "Artilheiros" — CONCLUÍDA e EM PRODUÇÃO** (deploy feito com
sucesso, verificado ponta a ponta):
- Elenco de jogadores cadastrado na edição do Time (`elencoForm`,
  `renderElencoChips`, campo `jogadores` no time).
- "Quem fez os gols" na edição do Jogo (`golsForm`, `renderGolsForm`,
  campo `gols` no jogo: `[{time, jogador, gols}]`).
- Nova aba "Artilheiros" com ranking somado (`calcularArtilheiros`,
  `renderArtilheiros`), com pódio colorido: 1º ouro (`--f7d046`), 2º prata
  (`--cfd6dd`), 3º bronze (`--e0a06a`) — classes `.art-pos--m1/m2/m3` em
  `estilo.css` linha ~688-690.
- Retrocompatível: jogos/times sem esses campos não quebram nada (ranking
  fica vazio). Confirmado em produção: banco começou zerado (0 gols, 0
  elencos), exatamente como pedido pelo cliente.

Auditoria completa (multi-agente + verificação pessoal) foi feita antes do
deploy: lógica ok, sem regressão nas features antigas, responsivo em todos
os tamanhos testados. 3 riscos reais foram achados e corrigidos antes de
subir (cache inconsistente, `.assetsignore`/`.gitignore` que excluíam a
logo do rodapé, arquivos de preview soltos na raiz).

## 6. Decisões e armadilhas importantes (não repetir os erros)

- **`.gitignore` e `.assetsignore` excluem `assets/img/*.png`** (para não
  versionar as imagens originais pesadas, só os `.webp` otimizados). Isso
  já quebrou a logo do rodapé (`LogoSemFundo.png`) uma vez — foi resolvido
  com um allow-list explícito (`!assets/img/LogoSemFundo.png` nos dois
  arquivos). **Se adicionar qualquer nova imagem PNG que precise ir para
  produção, lembre de checar esses dois arquivos.**
- **`.assetsignore` é o que realmente decide o que o Cloudflare publica**
  (não é o `.gitignore` — são arquivos diferentes, o Wrangler não olha pro
  git, olha pro disco filtrado por `.assetsignore`). Arquivos de teste que
  ficarem soltos na raiz do projeto (mesmo sem estar no git) SERIAM
  publicados se não estiverem no `.assetsignore`. Por isso `preview-*.html`
  está bloqueado lá.
- **Regras do Firestore (`firestore.rules`):** qualquer usuário autenticado
  (não só o admin) tecnicamente pode escrever no banco, porque o
  Firebase Auth por padrão permite auto-cadastro de contas. Isso foi
  identificado numa auditoria de segurança; **o dono do projeto avaliou o
  risco e decidiu manter assim de propósito** (projeto local, fechado,
  baixo risco real). Não "corrija" isso sem o cliente pedir de novo.
- **Favicon:** JÁ EM PRODUÇÃO, usando `assets/img/campeonato.webp?v=27`.
  Deu certo porque o `.assetsignore` bloqueia `.png/.jpg/.jpeg` mas NÃO
  bloqueia `.webp` — se um dia trocar o favicon por PNG, precisa de
  allow-list explícito (mesmo caso da logo do rodapé).
- **Deploy pode falhar de forma transiente:** no deploy de 29/07 o wrangler
  quebrou com exit code -1073740791 (crash do processo no Windows,
  STATUS_STACK_BUFFER_OVERRUN) na primeira tentativa, e funcionou na
  segunda, sem nenhuma mudança. Se acontecer: **produção não é afetada**
  (o upload nem chega a trocar a versão), é só tentar de novo. Verificar
  antes se produção continua no ar (curl na home) para ter certeza.
- **Word "Codex"/hand-off:** o dono as vezes trabalha com Claude e às
  vezes com o Codex (outra IA) nas mesmas branches. Sempre commitar com
  mensagens claras e por etapa — é assim que o próximo agente entende o
  histórico.

## 7. TAREFA EM ANDAMENTO AGORA — 3 ajustes visuais pedidos pelo cliente

Itens 1 e 3 vieram da branch `feat/ajustes-visuais` e já estão em produção.
O item 2 está sendo desenvolvido separadamente na branch
**`feat/gerador-banners`**, criada a partir da `main` em v=27.

Pedidos (nas palavras do cliente):

1. ✅ **"Colocar alguma cor para terceiro lugar"** — **CONCLUÍDO E EM
   PRODUÇÃO** (detalhes no §5). Regra do cliente: passam os dois melhores
   terceiros colocados entre os grupos, comparando pontos e depois saldo.
   ⚠️ Ponto em aberto (baixa prioridade): em empate ABSOLUTO de pontos E
   saldo na vaga de corte, o desempate hoje é a ordem dos grupos (A, B, C).
   Vale confirmar com o cliente se o regulamento tem um terceiro critério
   oficial (ex.: gols pró, confronto direto). Não bloqueia nada hoje.
2. ✅ **"Criar um gerador de banner"** — **CONCLUÍDO E EM PRODUÇÃO**
   (deploy em 04/08/2026, v=39 — detalhes e pendência de peso no §5).
   Nova sub-aba `Gerar Banner` no Gerenciador com:
   - Próximos jogos ou resultados; Story 9:16 ou Feed 1:1.
   - Filtros combinados por grupo/rodada e time, com seleção múltipla de jogos.
   - Título/subtítulo editáveis, três fundos da identidade e upload local.
   - Template fiel ao modelo oficial: estádio/holofotes, logo sobre
     pincelada, título em duas linhas, data lateral e cards escuros.
   - Escudos, `VS` ou placar, tags de data/hora, frase com bolas e rodapé
     branco com Diretoria de Esportes, Prefeitura e Speedline.
   - Download PNG via `html2canvas` em 1080×1920/1080×1080 e
     compartilhamento via `navigator.share`; se indisponível, baixa o PNG.
   - Nenhuma configuração/imagem é salva no Firestore.
   Arquivos alterados: `index.html`, `assets/js/app.js`,
   `assets/css/estilo.css`, `assets/css/banner-modelo.css`,
   `assets/img/banners/*`, `LEIA-ME.md` e este `CONTEXTO.md`.
3. ✅ **"Colocar logo no ícone da aba do navegador"** (favicon) —
   **CONCLUÍDO E EM PRODUÇÃO** (detalhes no §5).

### Status: OS 3 ITENS ESTÃO CONCLUÍDOS E EM PRODUÇÃO.
Itens 1 e 3 publicados em 29/07/2026 (v=27, tag
`pre-ajustes-visuais-20260729-144645`). Item 2 publicado em 04/08/2026
(v=39, tag `pre-banners-20260804-114809`), com backup do banco (20 jogos,
54 gols, 1 elenco) e do código v=27 em `backups/`. Banco verificado
intacto depois do deploy.

**Próxima tarefa sugerida (não pedida ainda pelo cliente):** otimizar o
carregamento do gerador de banners — hoje o `html2canvas` (194 KB) e o
fundo Story (241 KB) são baixados por TODO visitante, mesmo quem só quer
ver a tabela. Carregar os dois sob demanda (só ao abrir a aba "Gerar
Banner") economizaria ~435 KB por visita, o que importa num site usado
majoritariamente em dados móveis.

## 8. Como testar (lembrete rápido)

- `node --check assets/js/app.js` — sintaxe.
- Gerar preview fora da pasta do projeto (ver §4.3), abrir com Puppeteer
  (`puppeteer-core` + o Chrome já instalado em
  `C:/Program Files/Google/Chrome/Application/chrome.exe`), testar em
  larguras 320/360/768/1120px.
- Nunca testar contra produção com escrita real — só leitura (a
  Firestore REST API pública, `allow read: if true`, permite ler o
  documento de produção sem autenticar, útil pra comparar antes/depois).
- Antes de subir: rodar `git diff main..feat/nome-da-branch` e reler tudo.

## 9. Pendências conhecidas (não urgentes, vieram de auditorias anteriores)

- Grupo A da classificação está com dados incompletos (faltam resultados
  da 1ª rodada) — pendência antiga, não relacionada às features atuais.
- No formulário "quem fez os gols", o campo de nome do jogador sugere
  jogadores dos DOIS times do confronto (não filtra só pelo time daquela
  linha) — risco baixo de errar o time do artilheiro por engano.
- Ranking de artilheiros conta gols mesmo em jogos sem placar definido
  (jogo futuro) — pode ser intencional, não foi perguntado ao cliente.
- Medalha pula "prata" visualmente quando há empate no 1º lugar (cosmético,
  a posição numérica está correta, só a cor da medalha do 3º colocado real
  aparece como se fosse a 3ª posição em vez da 2ª). Baixa prioridade.
