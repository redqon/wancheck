# WAN Check

**[wanchk.ru](https://wanchk.ru)** — a lightweight, client-side PWA that checks the availability of WAN services directly from your browser.

No backend, no server — all checks run in the browser using `fetch` in `no-cors` mode, measuring real RTT from the client.

## Features

- **Real-time availability monitoring** — pings a configurable list of services every 30 seconds
- **Ping chart** — a live canvas chart showing ping history and outage moments
- **IP geolocation** — shows your public IP, city, and ISP (via [ipinfo.io](https://ipinfo.io))
- **Whitelist detection** — identifies when only whitelisted (domestic) services are reachable while the rest are down
- **Customizable service list** — enable/disable individual targets via the settings panel; preferences are saved in `localStorage`
- **Share snapshots** — encode the current check result into a URL hash and share it; recipients see a read-only snapshot
- **PWA** — installable on desktop and mobile; works offline thanks to a Service Worker with cache-first strategy for assets and network-first for data
- **Responsive** — adapts to mobile, tablet, and desktop screens
- **Zero dependencies** — pure HTML, CSS, and vanilla JavaScript

## Project Structure

```
├── index.html            # Single-page app shell
├── manifest.json         # PWA manifest
├── sw.js                 # Service Worker (precaching + fetch strategies)
├── CNAME                 # GitHub Pages custom domain (wanchk.ru)
├── data/
│   └── targets.json      # List of services to check
├── assets/
│   ├── css/
│   │   └── app.css       # Styles (minimal, monochrome)
│   ├── js/
│   │   └── app.js        # All application logic
│   └── icons/            # PWA icons and screenshots
```

## How It Works

1. On load, `targets.json` is fetched (and cached in `localStorage` for offline fallback).
2. For each enabled target, a `HEAD` request is made with `mode: 'no-cors'` and a 6-second timeout. If the request succeeds, the service is considered online; the round-trip time is measured via `performance.now()`.
3. IP, city, and ISP are fetched from `https://ipinfo.io/json`.
4. Results are rendered: overall status (Online / Offline / Partial / Whitelist), metadata grid, service table, and ping chart.
5. The check repeats every 30 seconds with a progress bar at the bottom.

### Status Logic

| Status        | Condition                                                                      |
| ------------- | ------------------------------------------------------------------------------ |
| **Online**    | ≥ 50% of services are reachable                                                |
| **Partial**   | < 50% of services are reachable                                                |
| **Whitelist** | Only services marked `whitelist: true` in targets respond; all others are down |
| **Offline**   | No services respond                                                            |

## Adding / Editing Targets

Edit `data/targets.json`. Each entry:

```json
{
  "name": "Google",
  "host": "google.com",
  "url": "https://google.com",
  "on": true,
  "whitelist": true
}
```

| Field       | Description                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| `name`      | Display name                                                                 |
| `host`      | Hostname (used as unique ID)                                                 |
| `url`       | URL to ping                                                                  |
| `on`        | `true` = enabled by default on first visit                                   |
| `whitelist` | `true` = treated as a whitelisted (domestic) service for whitelist detection |

## Deployment

The app is a static site. Deploy to any static hosting:

- **GitHub Pages** — push to the `main` branch; the `CNAME` file handles the custom domain.
- **Any HTTP server** — serve the root directory as-is.

## License

MIT

---

# WAN Check (RU)

**[wanchk.ru](https://wanchk.ru)** — легковесное PWA-приложение для проверки доступности WAN-сервисов прямо из браузера.

Без бэкенда и сервера — все проверки выполняются в браузере через `fetch` в режиме `no-cors`, измеряя реальный RTT клиента.

## Возможности

- **Мониторинг в реальном времени** — пингует настраиваемый список сервисов каждые 30 секунд
- **График пинга** — живой canvas-график с историей пинга и моментами обрыва
- **IP-геолокация** — показывает публичный IP, город и провайдера (через [ipinfo.io](https://ipinfo.io))
- **Определение белого списка** — обнаруживает ситуацию, когда доступны только отечественные (whitelisted) сервисы, а остальные недоступны
- **Настраиваемый список сервисов** — включение/отключение отдельных целей через панель настроек; предпочтения сохраняются в `localStorage`
- **Поделиться снимком** — результат проверки кодируется в хеш URL и может быть передан другим; получатель видит снимок в режиме просмотра
- **PWA** — устанавливается на десктоп и мобильные устройства; работает офлайн благодаря Service Worker с кэшированием
- **Адаптивный дизайн** — корректно отображается на мобильных, планшетах и десктопах
- **Без зависимостей** — чистый HTML, CSS и ванильный JavaScript

## Структура проекта

```
├── index.html            # Одностраничное приложение
├── manifest.json         # Манифест PWA
├── sw.js                 # Service Worker (предкэширование + стратегии загрузки)
├── CNAME                 # Кастомный домен для GitHub Pages (wanchk.ru)
├── data/
│   └── targets.json      # Список сервисов для проверки
├── assets/
│   ├── css/
│   │   └── app.css       # Стили (минимализм, монохром)
│   ├── js/
│   │   └── app.js        # Вся логика приложения
│   └── icons/            # Иконки и скриншоты PWA
```

## Как это работает

1. При загрузке из `targets.json` загружается список целей (кэшируется в `localStorage` для офлайн-работы).
2. Для каждого включённого сервиса выполняется `HEAD`-запрос с `mode: 'no-cors'` и таймаутом 6 секунд. Если запрос успешен — сервис считается онлайн; время отклика замеряется через `performance.now()`.
3. IP, город и провайдер определяются через `https://ipinfo.io/json`.
4. Результаты отображаются: общий статус (Онлайн / Офлайн / Частично / Белый список), сетка метаданных, таблица сервисов и график пинга.
5. Проверка повторяется каждые 30 секунд с полосой прогресса внизу страницы.

### Логика статусов

| Статус           | Условие                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| **Онлайн**       | ≥ 50% сервисов доступны                                                  |
| **Частично**     | < 50% сервисов доступны                                                  |
| **Белый список** | Отвечают только сервисы с флагом `whitelist: true`; остальные недоступны |
| **Офлайн**       | Ни один сервис не отвечает                                               |

## Добавление / редактирование целей

Отредактируйте `data/targets.json`. Формат записи:

```json
{
  "name": "Google",
  "host": "google.com",
  "url": "https://google.com",
  "on": true,
  "whitelist": true
}
```

| Поле        | Описание                                                     |
| ----------- | ------------------------------------------------------------ |
| `name`      | Отображаемое имя                                             |
| `host`      | Хост (уникальный идентификатор)                              |
| `url`       | URL для проверки                                             |
| `on`        | `true` = включён по умолчанию при первом визите              |
| `whitelist` | `true` = считается сервисом из белого списка (отечественным) |

## Развёртывание

Приложение полностью статическое. Подходит любой статический хостинг:

- **GitHub Pages** — пуш в ветку `main`; файл `CNAME` указывает кастомный домен.
- **Любой HTTP-сервер** — отдавайте корневую директорию как есть.

## Лицензия

MIT
