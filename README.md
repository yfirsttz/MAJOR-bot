# Major Bot

Bot do Discord para acompanhar players do Major, abrir enquetes de aprovacao, reagir ao estado da fila do NeatQueue e auditar resultados alterados.

## Requisitos

- Node.js 18+
- PostgreSQL acessivel pelo `DATABASE_URL`
- Bot do Discord com acesso ao servidor e permissao de ler mensagens, enviar mensagens, gerenciar cargos e abrir DM
- Token da API do NeatQueue

## Instalacao

```bash
npm install
```

Depois:

1. Copie `.env.example` para `.env`.
2. Preencha o bloco `OFFICIAL_*`.
3. Preencha o bloco `TEST_*` quando o servidor backup estiver pronto.
4. Ajuste `DATABASE_URL` com o Postgres real.

## Como funciona o `.env`

O projeto agora usa um unico `.env` local com dois perfis:

- `OFFICIAL_*`: servidor principal
- `TEST_*`: servidor de testes / homolog

O seletor global e `DEBUG_MODE`:

- `DEBUG_MODE=false` usa `OFFICIAL_*`
- `DEBUG_MODE=true` usa `TEST_*`

O `.env` real fica ignorado no git. Apenas `.env.example` e versionado.

## O que e `CLIENT_ID`

`CLIENT_ID` e o Application ID do bot no Discord. Ele e usado pelos scripts de `deploy` e `clear` para registrar ou limpar slash commands. Em runtime normal o bot nao precisa dele, mas os scripts em `dev/` precisam.

## Variaveis importantes

Compartilhadas:

- `DEBUG_MODE`
- `DATABASE_URL`
- `SMART_PING_MIN_PLAYERS`
- `SMART_PING_COOLDOWN_SECONDS`
- `NEATQUEUE_BOT_ID`
- `RESULTS_ALERT_USER_ID`

Por perfil (`OFFICIAL_*` e `TEST_*`):

- `BOT_TOKEN`
- `CLIENT_ID`
- `SERVER_ID`
- `CHANNEL_ID`
- `STARTUP_CHANNEL_ID`
- `QUEUE_CHANNEL_ID`
- `QUEUE_NAME`
- `NEATQUEUE_API_TOKEN`
- `NEATQUEUE_WEBHOOK_TOKEN`
- `AUTO_FORCESTART_ENABLED`
- `AUTO_FORCESTART_DELAY_SECONDS`
- `AUTO_FORCESTART_MIN_GK`
- `AUTO_FORCESTART_MIN_LINHA`
- `AUTO_FORCESTART_NOTIFY_CHANNEL_ID`
- `RESULTS_CHANNEL_ID`
- `ROLES_MAJOR`
- `ROLES_GKMAJOR`
- `ROLES_TEST_MAJOR`
- `ROLES_TEST_GKMAJOR`

## Features

### Polls de aprovacao

Quando um player em fase de teste cruza `POLL_THRESHOLD_GAMES`, o bot abre uma enquete no Discord. O status fica salvo no Postgres e a resolucao adiciona ou remove cargos conforme a trilha do jogador.

### AutoForceStart

Quando a fila chega em `AUTO_FORCESTART_MIN_GK + AUTO_FORCESTART_MIN_LINHA`, o bot arma um timer. Se ela continuar no ponto de forcestart por `AUTO_FORCESTART_DELAY_SECONDS`, o NeatQueue recebe o comando automatico.

### Smart Ping

O ping deixou de ser por horario fixo. Agora o bot:

1. Busca a ultima mensagem do NeatQueue no `QUEUE_CHANNEL_ID`.
2. Parseia `GK x/2` e `LINHA y/10`.
3. Se a fila tiver pelo menos `SMART_PING_MIN_PLAYERS`:
   - com goleiro presente: pinga `ROLES_MAJOR` e `ROLES_TEST_MAJOR`
   - sem goleiro: pinga `ROLES_MAJOR`, `ROLES_TEST_MAJOR`, `ROLES_GKMAJOR` e `ROLES_TEST_GKMAJOR`
4. Apaga a ultima mensagem de ping enviada pelo bot antes de mandar uma nova.
5. Respeita cooldown de `SMART_PING_COOLDOWN_SECONDS`, que pode ser alterado em runtime por admin.

Comandos de admin:

- `/smartping cooldown`: mostra o cooldown atual
- `/smartping cooldown segundos:<valor>`: altera o cooldown em segundos
- `/smartping resetar-cooldown`: volta ao valor padrao do `.env`

### Auditoria de resultados alterados

Toda mensagem editada pelo NeatQueue no `RESULTS_CHANNEL_ID` que contenha `MODIFIED BY` gera uma DM para `RESULTS_ALERT_USER_ID` com:

- quem alterou
- horario da alteracao
- numero da fila
- link do transcript
- link da mensagem

## Scripts

- `npm start`: inicia o bot
- `npm run dev`: inicia com `node --watch`
- `npm run deploy`: registra slash commands da guild do perfil ativo
- `npm run clear`: limpa comandos globais do aplicativo do perfil ativo
- `npm run backup`: gera backups JSON das tabelas principais em `backups/`

## Observacoes

- `AUTO_FORCESTART_DELAY_SECONDS` e `SMART_PING_COOLDOWN_SECONDS` sao sempre em segundos.
- Alteracoes feitas com `/smartping cooldown` ficam salvas em `data/` por perfil/servidor.
- `STARTUP_CHANNEL_ID` e opcional; se vazio, o bot usa `CHANNEL_ID`.
- O bot assume que os dados legados do banco pertencem ao servidor oficial e faz backfill com `OFFICIAL_SERVER_ID`.
- Consulte `ARCHITECTURE.md` para a estrutura detalhada do projeto.
