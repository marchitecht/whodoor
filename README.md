# Кто первый в дверь

Мультиплеерный 2D-платформер на скорость. 21 уровень (плюс бонусный), одна синяя дверь.
Кто вошёл в неё первым, получает очко, и все переходят на следующий уровень. Рассказчику не верь.

- комнаты по ссылке `?r=КОД`, от 1 до 8 игроков, у каждого свой цвет
- мир общий: провалил пол, обрушил потолок, спугнул дверь — это видят все
- на соперника можно встать сверху
- можно добавить ботов прямо в лобби: играть с людьми, с ботами или со всеми сразу
- работает на телефоне (тач-кнопки)

## Как устроено

```
packages/
  shared/   чистое ядро: мир, физика, компоненты, уровни, протокол — общее для сервера и клиента
  server/   чистое ядро комнаты + тонкая оболочка (Fastify, WebSocket, таймер)
  client/   Vite + canvas: лобби, свой квадрат без задержки, чужие с интерполяцией 100 мс
```

Ядро написано в функциональном стиле на `fp-ts` + `monocle-ts` + `io-ts`.

**Мир неизменяемый.** `updateWorld(dt, players): World → World`. Состояние меняется только через оптики:
`_door` — это `Optional` (двери может не быть), `_slot(key)` — состояние конкретного компонента, `_spikes`/`_solids` — линзы.

**Уровень = композиция поведений.** `Behavior` — моноид. `init`/`update` склеиваются через `flow`, `hits` — первый `Some`,
твёрдые тела конкатенируются, `canEnter` — через И, `onFall` — через ИЛИ. Уровень — это просто список:

```ts
level({ id: 'saw', say: 'Тут пилы. Просто перепрыгивай.' }, [
  door(880),
  saw('a', { x: 200, v: 230, min: 180, max: 540 }, die.saw),
  once('lunge', anyPast(590), flow(launch('b', -430), say('Шучу.'))),
  saw('b', { x: 790 }, die.saw),
  once('gone', sawGone('b'), say('Ну и ладно. Проходите.')),
])
```

Компоненты (`packages/shared/src/components.ts`) ничего не знают друг о друге и хранят состояние в своих слотах.
Триггеры собираются из условий: `once`, `at`, `after`, `anyPast`, `and`/`or`/`not`. Порядок в списке — порядок обновления.

**Физика** — `State<Body, boolean>`: шаг возвращает новое тело и признак прыжка. Коллизии — свёртка по твёрдым телам.
**Случайность** рассказчика — сид в мире, протаскивается через `State`, поэтому мир полностью воспроизводим.

**Сервер.** Комната — чистая машина состояний: `step(cmd): State<Room, Effect[]>`. Шаги склеиваются через `seq`
(моноид: по порядку, эффекты конкатенируются). Сокеты и часы живут только в `shell.ts`: оболочка подаёт команды
и исполняет эффекты (`to`, `all`, `kick`, `close`). Входящие сообщения проходят через `io-ts`-кодек → `Either`, битые отбрасываются.
Серверные боты — тоже чистая функция `State<Brain, BotAct>` со своим сидом.

**Клиент** крутит тот же `updateWorld` между снапшотами, свой квадрат двигает сам, отрисовка — по компонентам:
у каждого слота есть `kind`, у каждого `kind` свой рисовальщик.

Это игра для своих: сервер не проверяет честность позиций.

### Тесты

```bash
pnpm test                                  # эталон + законы
cd packages/server && npx tsx test/game.ts # вся игра внутри процесса за ~5 секунд
```

- `shared/test/golden-check.ts` — 22 уровня с двумя скриптовыми игроками против `golden.json`, снятого до рефакторинга:
  траектории, двери, твёрдые тела, смерти и победы должны совпасть.
- `shared/test/laws.ts` — законы линз, законы моноида `Behavior`, отсутствие мутаций (мир заморожен), детерминизм.
- `server/test/game.ts` — хост и 4 бота проходят игру через чистое ядро комнаты, без сети и реального времени.
- `client/render-check.html` — в `pnpm dev` открой `/render-check.html`, чтобы увидеть все уровни разом.

## Локально

```bash
pnpm install
pnpm dev             # сервер на :8787, клиент на http://localhost:5173 (прокси /ws на сервер)
```

Открой http://localhost:5173 в двух вкладках, чтобы поиграть с самим собой.

Боты, которые проходят игру по сети (удобно проверять сервер):

```bash
pnpm bots 4                                   # 4 бота в комнате BOTS на localhost
pnpm bots 2 wss://marchitecht.tech/games/whodoor/ws 60  # 2 бота против прода на 60 секунд
BOT_ROOM=ABCD pnpm bots 2                     # подселить ботов в свою комнату
```

Проверка типов и прод-сборка:

```bash
pnpm typecheck
pnpm build && PORT=8787 pnpm start            # всё на http://localhost:8787
```

## Деплой: marchitecht.tech/games/whodoor/

Игра живёт по пути на основном домене, отдельный домен не нужен. Нужна машина с Docker, куда смотрит домен (или любая VM,
на которую домен можно направить). Cloud Functions не подходят: WebSocket-соединения живут долго.

Контейнер `app` слушает только `127.0.0.1:8787`. Снаружи его открывает Caddy: срезает префикс `/games/whodoor`
и проксирует всё остальное, включая WebSocket. Клиент собран с этим путём (`BASE_PATH` в `.env`).

### Если на машине уже есть Caddy для marchitecht.tech

1. Код и запуск приложения:
   ```bash
   git clone https://github.com/marchitecht/whodoor.git && cd whodoor
   cp .env.example .env
   docker compose up -d --build
   curl http://127.0.0.1:8787/health          # {"ok":true,...}
   ```
2. В блок сайта в своём Caddyfile добавь:
   ```caddy
   marchitecht.tech {
   	redir /games/whodoor /games/whodoor/
   	handle_path /games/whodoor/* {
   		reverse_proxy localhost:8787
   	}
   	# ...всё, что там уже было
   }
   ```
   Если твой Caddy сам крутится в Docker, `localhost` будет его контейнером: либо подключи его к сети этого compose-проекта
   и пиши `app:8787`, либо используй `host.docker.internal:8787` (на Linux нужен `extra_hosts: ["host.docker.internal:host-gateway"]`).
3. `caddy reload` (или `docker compose restart` своего Caddy) и открой https://marchitecht.tech/games/whodoor/.

Для nginx то же самое: `location /games/whodoor/ { proxy_pass http://127.0.0.1:8787/; proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 1h; }`.

### Если сайта на машине ещё нет

В проекте есть свой Caddy, он выпустит сертификат сам:

```bash
cp .env.example .env                          # DOMAIN=marchitecht.tech
docker compose --profile standalone up -d --build
```

Домен должен уже смотреть на эту машину, порты 80 и 443 открыты. Этот Caddy отвечает только на `/games/whodoor/`,
остальные пути сайта он не обслуживает.

### Проверка и обновление

```bash
curl https://marchitecht.tech/games/whodoor/health
docker compose logs -f app
git pull && docker compose up -d --build     # после изменений
```

Другой путь: поменяй `BASE_PATH` в `.env` и путь в конфиге Caddy, затем пересобери (`docker compose up -d --build`).

## Как добавить уровень

1. Собери его из существующих компонентов в `packages/shared/src/levels.ts` — чаще всего этого хватает.
2. Если нужен новый механизм, напиши компонент: функцию, которая возвращает `behavior({ init, update, hits, solids, ... })`
   и держит своё состояние в `setSlot`/`modifySlot`. Состояние — простой JSON (оно целиком уходит по сети), с полем `kind`.
3. Если компонент нужно рисовать, добавь рисовальщик для его `kind` в `back` или `top` в `packages/client/src/render.ts`.

Общие ловушки должны восстанавливаться сами (пол отрастает, потолок поднимается): иначе один игрок может сломать уровень для всех.
