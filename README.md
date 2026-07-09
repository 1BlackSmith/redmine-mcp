# redmine-mcp

`redmine-mcp` — MCP-провайдер для Redmine. Он подключается к OpenCode, Codex, Cursor и другим MCP-клиентам и даёт доступ к Redmine REST API.

Провайдер собран в один исполняемый файл: [src/server.js](src/server.js). Отдельного wrapper-процесса нет.

## Возможности

Провайдер покрывает весь Redmine REST API через универсальные tools:

- `redmine_api_request` — вызывает любой REST endpoint относительно `REDMINE_URL`.
- `redmine_paginated_request` — вызывает списочные endpoints и проходит Redmine-пагинацию `limit`/`offset`.
- `redmine_upload_file` — загружает бинарный файл в `/uploads.json` и возвращает upload token.

Также есть resource tools для частых сценариев:

- задачи, связи задач, наблюдатели задач;
- проекты, участники проектов, версии, категории задач;
- трудозатраты;
- пользователи, группы, роли;
- трекеры, статусы задач, перечисления, custom fields, сохранённые queries;
- wiki, документы, файлы, новости, вложения;
- поиск и текущий пользователь.

Если нужного Redmine endpoint нет среди именованных tools, используйте `redmine_api_request`. Это основной слой совместимости для всех стандартных, версионных и plugin endpoints Redmine.

## Требования

- Node.js 18 или новее.
- Redmine с включённым REST API.
- API key Redmine или логин/пароль для Basic auth.

## Установка и запуск

Установите опубликованный npm-пакет глобально:

```bash
npm install -g @pavelsmith/redmine-mcp
```

После установки команда должна быть доступна в `PATH`:

```bash
redmine-mcp
```

Для локального checkout до публикации запускайте единственный файл провайдера напрямую:

```bash
node /absolute/path/to/redmine-mcp/src/server.js
```

## Аутентификация

Доступы передаются через переменные окружения MCP-сервера:

- `REDMINE_URL` — обязательный URL Redmine, например `https://redmine.example.com` или `https://example.com/redmine`.
- `REDMINE_API_KEY` — предпочтительный способ авторизации.
- `REDMINE_TOKEN` или `REDMINE_ACCESS_TOKEN` — алиасы для API key.
- `REDMINE_USERNAME` и `REDMINE_PASSWORD` — fallback для HTTP Basic auth, если API key недоступен.

## Ограничение доступных tools и actions

По умолчанию MCP-сервер публикует все tools и все actions внутри resource tools. Ограничения задаются аргументами команды в `mcp.json`.

Запретить все `delete` actions:

```json
{
  "mcpServers": {
    "redmine": {
      "command": "redmine-mcp",
      "args": ["--deny-action", "delete"],
      "env": {
        "REDMINE_URL": "https://redmine.example.com",
        "REDMINE_API_KEY": "your-api-key"
      }
    }
  }
}
```

В этом режиме из схем исчезнут все actions, которые выполняют HTTP `DELETE`, включая actions с другими именами, например `remove` и `remove_user`. Прямой вызов таких actions будет отклонён, а в `redmine_api_request` будет скрыт и заблокирован HTTP method `DELETE`.

Оставить только выбранные blocks/tools и actions внутри них:

```json
{
  "mcpServers": {
    "redmine": {
      "command": "redmine-mcp",
      "args": [
        "--tool",
        "redmine_current_user",
        "--tool",
        "redmine_issues:list,get,create,update,add_note",
        "--tool",
        "redmine_projects:list,get"
      ],
      "env": {
        "REDMINE_URL": "https://redmine.example.com",
        "REDMINE_API_KEY": "your-api-key"
      }
    }
  }
}
```

`--tool` можно повторять. Формат значения: `tool_name` или `tool_name:action,action`. Если `--tool` не указан, доступны все tools, кроме actions/methods, запрещённых через `--deny-action`.

`--deny-action` тоже можно повторять. Формат значения: `action` для глобального запрета или `tool_name:action,action` для запрета внутри конкретного tool.

Ограничение применяется и к `tools/list`, и к `tools/call`: скрытый tool/action не будет показан клиенту и не сможет быть вызван напрямую.

## Настройка OpenCode

OpenCode использует секцию `mcp`, а не `mcpServers`. Для локального MCP-сервера нужны:

- `type: "local"`;
- `command` как массив строк;
- `environment` для переменных окружения;
- `enabled: true`.

### Вариант 1: глобальная npm-установка

Добавьте в OpenCode config, например в `.opencode/opencode.json` проекта или пользовательский config OpenCode:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "redmine": {
      "type": "local",
      "command": ["redmine-mcp"],
      "environment": {
        "REDMINE_URL": "https://redmine.example.com",
        "REDMINE_API_KEY": "your-api-key"
      },
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

То же самое через CLI OpenCode:

```bash
opencode mcp remove redmine
opencode mcp add redmine \
  --env REDMINE_URL=https://redmine.example.com \
  --env REDMINE_API_KEY=your-api-key \
  -- redmine-mcp
```

### Вариант 2: локальный checkout

Если пакет ещё не опубликован или вы разрабатываете его локально:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "redmine": {
      "type": "local",
      "command": ["node", "/absolute/path/to/redmine-mcp/src/server.js"],
      "environment": {
        "REDMINE_URL": "https://redmine.example.com",
        "REDMINE_API_KEY": "your-api-key"
      },
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

Через CLI OpenCode:

```bash
opencode mcp remove redmine
opencode mcp add redmine \
  --env REDMINE_URL=https://redmine.example.com \
  --env REDMINE_API_KEY=your-api-key \
  -- node /absolute/path/to/redmine-mcp/src/server.js
```

### Проверка OpenCode

```bash
opencode mcp list
```

Ожидаемый результат:

```text
✓ redmine connected
```

Если OpenCode показывает `Operation timed out after 30000ms`, обычно он всё ещё запускает старую команду. Перерегистрируйте сервер:

```bash
opencode mcp remove redmine
opencode mcp add redmine \
  --env REDMINE_URL=https://redmine.example.com \
  --env REDMINE_API_KEY=your-api-key \
  -- node /absolute/path/to/redmine-mcp/src/server.js
```

После этого снова выполните:

```bash
opencode mcp list
```

## Настройка Codex, Cursor и других MCP-клиентов

Некоторые клиенты используют общий JSON-формат `mcpServers`.

Для глобально установленного npm-пакета:

```json
{
  "mcpServers": {
    "redmine": {
      "command": "redmine-mcp",
      "args": [],
      "env": {
        "REDMINE_URL": "https://redmine.example.com",
        "REDMINE_API_KEY": "your-api-key"
      }
    }
  }
}
```

Для локального checkout:

```json
{
  "mcpServers": {
    "redmine": {
      "command": "node",
      "args": ["/absolute/path/to/redmine-mcp/src/server.js"],
      "env": {
        "REDMINE_URL": "https://redmine.example.com",
        "REDMINE_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Примеры вызовов tools

Получить задачу с журналом и вложениями:

```json
{
  "action": "get",
  "issue_id": "123",
  "include": ["journals", "attachments"]
}
```

Создать задачу:

```json
{
  "action": "create",
  "issue": {
    "project_id": "demo",
    "subject": "Created through MCP",
    "description": "Issue body",
    "tracker_id": 1
  }
}
```

Вызвать любой endpoint напрямую:

```json
{
  "method": "GET",
  "path": "/issues.json",
  "query": {
    "project_id": "demo",
    "status_id": "open"
  }
}
```

Загрузить файл и получить upload token:

```json
{
  "filename": "report.txt",
  "content_base64": "UmVwb3J0IGNvbnRlbnQK",
  "content_type": "text/plain"
}
```

## Локальная разработка

```bash
npm run check
npm start
```

Провайдер использует только встроенные возможности Node.js, внешних runtime-зависимостей нет.
