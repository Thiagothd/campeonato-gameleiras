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
atualiza **em tempo real** para todo mundo que estiver com o site aberto.

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

**Versionamento de cache:** todo CSS/JS é servido com `?v=N` no
`index.html`, e existe `const CACHE_VER = "N"` em `app.js` (usado só pra
imagens/logo, `comVersao()`). **⚠️ REGRA IMPORTANTE:** sempre que qualquer
CSS ou JS mudar, incremente **TODOS** os `?v=` do `index.html` (dados.js,
db.js, app.js, estilo.css) e o `CACHE_VER` do app.js, para o mesmo número
novo. Já tivemos um bug real de produção por esquecer disso (cache
misturando JS antigo com HTML novo). Valor atual: **v=25**.

## 3. Como o deploy funciona (IMPORTANTE)

Produção **NÃO** tem deploy automático via GitHub. Publicar exige rodar
manualmente (PowerShell, na raiz do projeto):

```powershell
$env:CLOUDFLARE_API_TOKEN = "..."     # token de API escopo limitado (Pages:Edit + DNS:Edit da zona)
$env:CLOUDFLARE_ACCOUNT_ID = "..."    # Account ID da Cloudflare
.\deploy-cloudflare-pages.ps1
```

O script: cria/atualiza o projeto Cloudflare Pages, roda
`wrangler pages deploy .`, garante o domínio customizado e o registro DNS
CNAME. **O usuário precisa gerar o token toda vez** (não fica salvo em
lugar nenhum, nem deve ficar) — oriente-o a criar em
dash.cloudflare.com → My Profile → API Tokens → Create Custom Token, com
permissões `Account > Cloudflare Pages > Edit` + `Zone > DNS > Edit`
(escopo: zona `speedlinemg.com.br`).

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

## 5. Estado atual (última entrega concluída e publicada)

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
- **Favicon:** ainda não existe (por isso aparece 404 de `favicon.ico` nos
  logs — é cosmético/inofensivo, ignorado nas auditorias). Um dos 3
  ajustes pendentes agora é justamente criar um favicon (ver §7).
- **Word "Codex"/hand-off:** o dono as vezes trabalha com Claude e às
  vezes com o Codex (outra IA) nas mesmas branches. Sempre commitar com
  mensagens claras e por etapa — é assim que o próximo agente entende o
  histórico.

## 7. TAREFA EM ANDAMENTO AGORA — 3 ajustes visuais pedidos pelo cliente

Branch já criada: **`feat/ajustes-visuais`** (a partir de `main`, que já
tem o Artilheiros publicado). Segue o mesmo processo do §4.

Pedidos (nas palavras do cliente):
1. **"Colocar alguma cor (a que combine mais) para terceiro lugar"** — o
   cliente disse que vai explicar a regra exata numa próxima mensagem
   (ainda **NÃO explicada** na hora em que este arquivo foi escrito).
   ⚠️ Contexto importante: o ranking de Artilheiros **já tem** cores de
   medalha para 1º/2º/3º lugar (`.art-pos--m1/m2/m3`, ouro/prata/bronze,
   ver §5). Pode ser que o cliente esteja se referindo a ESSE elemento (e
   talvez ache que falta cor, ou queira mudar o tom), ou pode ser outro
   "terceiro lugar" em outro contexto (ex.: classificação dos grupos,
   pódio de algum outro ranking). **Não assuma — espere a explicação da
   regra antes de implementar.**
2. **"Criar um gerador de banner"** — ainda sem detalhes do que deve gerar
   exatamente (banner de quê? resultado de jogo pra compartilhar? divulgação
   da rodada? formato de imagem pra baixar/compartilhar no WhatsApp?).
   **Aguardando esclarecimento do cliente.**
3. **"Colocar logo no ícone da aba do navegador"** (favicon) — este é
   direto: adicionar `<link rel="icon" ...>` no `<head>` do `index.html`
   apontando pra uma versão da logo do campeonato
   (`assets/img/campeonato.webp`, já existe) em tamanho adequado
   (idealmente gerar um `.png`/`.ico` 32x32 e 180x180 pro apple-touch-icon).
   Pode ser feito assim que tiver a imagem certa — não depende de mais
   explicação, mas ainda não foi feito.

### Status: nada implementado ainda nesta branch. Aguardando o cliente
detalhar a regra do item 1 e os detalhes do item 2 antes de codar.

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
