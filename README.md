# 🎮 TikTok Farm — jogos interativos 24/7 para lives do TikTok

Plataforma que transforma a sua live do TikTok em um **jogo interativo que roda sozinho**.
Você deixa o computador ligado com o OBS transmitindo; quem está assistindo entra no jogo
comentando, e o **avatar (foto de perfil) de cada pessoa** vira um personagem na tela.
**Presentes dão vantagens** dentro do jogo, curtidas também ajudam.

Os jogos se revezam automaticamente, com tela de resultado e ranking entre eles:

| Jogo | Estilo | Como funciona |
|---|---|---|
| ⚔️ **Guerra dos Reinos** | Times / batalha | 4 reinos (🔴🔵🟢🟡), cada um com um castelo. Seu avatar é um herói que luta sozinho. O último castelo de pé vence. |
| 🎨 **Domínio de Territórios** | Dominar áreas | Seu avatar quica pelo mapa pintando o chão com a cor do seu time. Mais território no fim = vitória. |
| 🏰 **Defesa do Castelo** | Tower defense (cooperativo) | Cada pessoa vira uma torre com o próprio avatar e atira sozinha nas ondas de monstros. |
| 🏁 **Corrida Maluca** | Corrida | Seu avatar corre sozinho; comentários e curtidas empurram. Os 3 primeiros vencem. |

## Como o público joga

- **Entrar:** comentar qualquer coisa (ou curtir / mandar presente).
- **Escolher time** (jogos de times): comentar `1`, `2`, `3`, `4` ou `vermelho`, `azul`, `verde`, `amarelo`.
- **Curtidas ❤️:** dão um bônus pequeno (soldados, velocidade, tiro rápido, empurrão).
- **Seguir / compartilhar:** bônus médio.
- **Presentes 🎁:** o poder depende do total de diamantes do presente:

| Diamantes | Guerra dos Reinos | Territórios | Defesa do Castelo | Corrida |
|---|---|---|---|---|
| 1+ 💎 (Rosa etc.) | Herói sobe de nível + soldados | Pincel gigante + turbo | Torre sobe de nível | Turbo |
| 10+ 💎 | Herói **gigante** + cura o castelo | **Bomba de tinta** | **Congela** todos os monstros | Pulo + **escudo** |
| 100+ 💎 | **Meteoro** no castelo inimigo (ou revive o seu) | **Tsunami** no time líder | **Bombardeio** + cura | **Raio** nos 5 líderes |
| 1000+ 💎 | **Dragão**: arrasa os inimigos | **Dominação** de uma faixa do mapa | **Nuke** + castelo novo | **Foguete** (+30%) |

A tabela de presentes do jogo atual aparece na tela o tempo todo. Presentes enviados no intervalo
entre jogos **não se perdem**: valem assim que o próximo jogo começa.

Quem interagiu nos últimos minutos já entra automaticamente no próximo jogo, e quando há pouca gente,
**bots** completam a partida para a tela nunca ficar parada.

---

## 1. Requisitos

- **Node.js 20 ou mais novo** (versão LTS): <https://nodejs.org>
- **OBS Studio**: <https://obsproject.com>
- Uma conta do TikTok que possa fazer live **pelo OBS** (com *chave de transmissão / stream key*).
  Se a sua conta não tem chave de transmissão, dá para usar o **TikTok LIVE Studio** capturando a
  janela/fonte do overlay da mesma forma.

## 2. Instalação

1. Baixe este projeto (botão **Code → Download ZIP** no GitHub, ou `git clone`) e extraia numa pasta.
2. **Windows:** dê dois cliques em `start-windows.bat`.
   **Linux/Mac:** rode `./start.sh`.
   Na primeira vez ele instala as dependências e cria o arquivo `config.json`.
3. Feche a janela, abra o `config.json` num editor de texto e troque `seu_usuario_aqui` pelo seu
   usuário do TikTok (sem o `@`):

   ```json
   "tiktokUsername": "meu_usuario",
   ```
4. Rode o `start-windows.bat` de novo. Vão aparecer dois endereços:
   - **Overlay (para o OBS):** <http://127.0.0.1:8080/overlay.html>
   - **Painel de controle:** <http://127.0.0.1:8080/admin.html>

## 3. Testar sem estar ao vivo (simulador)

Abra o **painel** no navegador e clique em **🧪 Simulador**: ele cria espectadores falsos que comentam,
curtem e mandam presentes. No painel também dá para mandar comentários/presentes de teste com um nome
específico, pular de jogo ou escolher qual jogo rodar.

Também dá para iniciar já com o simulador ligado: `start-windows.bat --sim` (ou `npm run sim`).
Os jogadores simulados não entram no ranking real.

## 4. Configurar o OBS

1. **Configurações → Vídeo:** resolução base e de saída **1080x1920** (vertical), 30 FPS.
2. **Configurações → Transmissão:** serviço *Personalizado*, cole o **servidor** e a **chave de
   transmissão** que o TikTok fornece.
3. **Configurações → Avançado → Reconectar automaticamente:** ligado (atraso 10s, tentativas no máximo).
4. Na cena, adicione uma fonte **Navegador** (Browser Source):
   - URL: `http://127.0.0.1:8080/overlay.html`
   - Largura **1080**, Altura **1920**
   - **Desmarque** "Desligar fonte quando não estiver visível".
5. Se quiser som, adicione uma música de fundo como outra fonte no OBS.

O jogo é desenhado sempre em 1080x1920 e escala para caber em qualquer tamanho.

## 5. Deixando rodar 24/7 (AFK)

O sistema foi feito para ficar sozinho por dias:

- **Servidor reinicia sozinho:** o `start-windows.bat` religa o programa se ele parar por qualquer motivo.
- **Reconexão com a live:** se a live ainda não começou, o programa tenta de novo a cada 60s. Se cair
  ou terminar, ele reconecta sozinho. Se ficar vários minutos sem receber nenhum evento, ele força uma
  reconexão (watchdog).
- **Overlay se recupera:** se o servidor reiniciar, o overlay reconecta sozinho. A cada 6 horas ele se
  recarrega entre um jogo e outro para não acumular memória. Se der erro dentro de um jogo, ele pula
  para o próximo em vez de travar.
- **Ranking salvo em disco** (`data/leaderboard.json`), então ele continua depois de reiniciar.

No Windows, recomendo também:
- **Energia:** "Suspender: Nunca" e "Desligar tela" à vontade (a tela pode apagar, o PC não pode dormir).
- Desativar a reinicialização automática do Windows Update nos horários de live (Horário ativo).
- Colocar um atalho do `start-windows.bat` e do OBS na pasta de inicialização (`Win+R` → `shell:startup`)
  e, no OBS, usar o parâmetro `--startstreaming` no atalho para ele já começar transmitindo.

## 6. Configurações (`config.json`)

| Opção | O que faz |
|---|---|
| `tiktokUsername` | Seu usuário do TikTok (sem @). |
| `signApiKey` | Opcional. Chave da [Euler Stream](https://www.eulerstream.com) (serviço que a biblioteca usa para conectar no chat). Use se a conexão começar a falhar por limite de uso. |
| `server.port` | Porta do servidor (padrão 8080). |
| `server.host` | `127.0.0.1` = só este PC acessa. Use `0.0.0.0` para abrir o painel de outro aparelho da rede (qualquer pessoa na sua rede poderá controlar). |
| `games.rotation` | Ordem dos jogos. Remova um para tirá-lo da rotação. IDs: `teams`, `territory`, `towerdefense`, `race`. |
| `games.shuffle` | `true` = ordem aleatória a cada ciclo. |
| `games.durations` | Duração máxima de cada jogo em segundos. |
| `games.intermissionSeconds` | Duração da tela de resultado entre jogos. |
| `players.autoJoinOnEnter` | `true` = quem só entra na live (sem comentar) já vira jogador. |
| `players.carryOverMinutes` | Quem interagiu nesses últimos minutos entra direto no próximo jogo. |
| `bots.enabled` / `bots.minPlayers` | Completa com bots até esse número de jogadores. |
| `overlay.autoReloadHours` | Recarrega o overlay a cada X horas (0 = nunca). |
| `overlay.giftGuideY` / `overlay.feedY` | Posição vertical da tabela de presentes e das notificações. |
| `tiktok.*` | Tempos de reconexão e do watchdog. |

## 7. Avisos importantes

- **Regras do TikTok:** o TikTok pode limitar ou encerrar lives que considera "sem apresentador",
  repetitivas ou de baixa interação. Lives de jogos interativos são comuns, mas não há garantia de
  que uma live 100% AFK não seja penalizada. Leia as Diretrizes da Comunidade e as regras de LIVE,
  e acompanhe a live de vez em quando.
- **Conexão com o chat não é oficial:** a leitura de comentários/presentes usa a biblioteca
  [`tiktok-live-connector`](https://github.com/zerodytrash/TikTok-Live-Connector), que não é da
  ByteDance. Se o TikTok mudar algo, pode parar de funcionar até a biblioteca ser atualizada
  (`npm update tiktok-live-connector`).
- **Presentes são dinheiro real** dos espectadores: deixe as vantagens claras (a tabela já aparece
  na tela) e não prometa prêmios fora do jogo.

## 8. Estrutura do projeto

```
server/
  index.js        servidor web + WebSocket, painel, ranking
  tiktok.js       conexão com a live (reconexão automática + watchdog)
  normalize.js    converte eventos do TikTok (inclui combos de presentes)
  simulator.js    espectadores falsos para testes
  store.js        ranking salvo em data/leaderboard.json
public/
  overlay.html    página que vai no OBS (canvas 1080x1920)
  admin.html      painel de controle
  js/main.js      gerenciador: rotação, HUD, presentes, bots, intervalo
  js/core.js      avatares, efeitos, utilitários de desenho
  js/games/       um arquivo por jogo (teams, territory, towerdefense, race)
```

### Criando um jogo novo

Crie um arquivo em `public/js/games/` estendendo a classe `Game` de `base.js` (veja os outros como
exemplo: `join`, `onLike`, `onGift`, `update`, `draw`, `result`), registre-o no objeto `GAMES` em
`public/js/main.js` e adicione o ID em `games.rotation` no `config.json`.
