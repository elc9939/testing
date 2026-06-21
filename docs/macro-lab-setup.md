# Macro Lab Setup

Date: 2026-06-16

Macro Lab is a local Windows desktop automation daemon plus a Mini Hub control page.

## Services

- Hub UI: `http://127.0.0.1:5173/macro-lab`
- Macro Lab API: `http://127.0.0.1:8792`
- Ollama hook: `http://127.0.0.1:11434`

## Install

```powershell
cd apps\macro-lab-api
py -3 -m venv .venv
.venv\Scripts\python -m pip install -U pip
.venv\Scripts\python -m pip install -e .[test]
```

If you want to reuse the existing AI OS virtual environment during development, install the
Macro Lab package into that venv:

```powershell
cd apps\macro-lab-api
..\ai-os-api\.venv\Scripts\python -m pip install -e .[test]
```

## Run

From the repo root:

```powershell
pnpm macro-lab:start
pnpm macro-lab:status
pnpm dev:hub
```

Direct run:

```powershell
cd apps\macro-lab-api
.venv\Scripts\python -m macro_lab
```

Health:

```text
GET http://127.0.0.1:8792/api/macro-lab/health
GET http://127.0.0.1:8792/api/macro-lab/status
```

## Windows Permissions

- Global hotkeys and input playback use `pynput`. Some elevated/admin windows may ignore input
  unless Macro Lab is also running elevated.
- Clipboard history and transforms use `pyperclip`.
- Folder triggers use `watchdog`.
- Window focus/layout uses Windows `user32` through `ctypes`.
- Shell/file actions run with the same permissions as the Macro Lab process.

## Safety

- The panic hotkey defaults to `<ctrl>+<alt>+<pause>`.
- Panic can also be triggered from the UI or `POST /api/macro-lab/panic`.
- Panic stops trigger execution and cancels active runs.
- `dry_run=true` never executes side effects.
- Actions marked `input`, `system`, or `destructive` require either macro `armed=true` or
  one-shot API `confirm=true`.
- Default macros are dry-run-first and their triggers are disabled.
- Real file actions write recoverability metadata into each run step. `file.delete` snapshots
  the deleted path before removal; `file.move`, `file.copy`, and `file.batch_rename` record
  inverse-operation hints and snapshot any pre-existing target they might overwrite. Snapshot
  files live under `MACRO_LAB_ACTION_SNAPSHOTS_DIR` or `.macro-lab-data/action-snapshots`.

## Macro Shape

```json
{
  "id": "macro_example",
  "name": "Example",
  "group": "Scratch",
  "enabled": true,
  "armed": false,
  "dry_run_default": true,
  "variables": { "name": "Edward" },
  "actions": [
    {
      "id": "action_echo",
      "type": "shell.run",
      "label": "Echo",
      "enabled": true,
      "config": { "command": "echo hello {name}" }
    }
  ],
  "triggers": [
    {
      "id": "trigger_hotkey",
      "type": "hotkey",
      "label": "Ctrl Alt E",
      "enabled": false,
      "config": { "keys": "<ctrl>+<alt>+e" }
    }
  ]
}
```

## Implemented Actions

- `app.launch`: launch an executable, path, or URL.
- `app.focus`: focus the first matching window title.
- `app.close`: send `WM_CLOSE` to the first matching window title.
- `shell.run`: run a shell command with timeout and captured output.
- `input.hotkey`: send a key chord.
- `input.type_text`: type rendered text.
- `input.playback`: replay recorded keyboard/mouse events.
- `clipboard.set`: set clipboard text.
- `clipboard.paste_text`: set clipboard and press Ctrl+V.
- `clipboard.transform`: transform clipboard or selected text.
- `ollama.transform_clipboard`: send selected/clipboard text to local Ollama and paste result.
- `file.batch_rename`: rename matching files.
- `file.move`, `file.copy`, `file.delete`.
- `window.save_layout`, `window.restore_layout`.
- `workspace.mode`: launch apps/URLs and optionally restore a saved layout.

## Implemented Triggers

- `hotkey`: `{"keys":"<ctrl>+<alt>+s"}`
- `schedule`: `{"interval_seconds":300}` or `{"at":"09:00"}`
- `folder`: `{"path":"C:\\Inbox","pattern":"*.pdf","recursive":false}`
- `app_focus`: `{"query":"Notepad","poll_seconds":1}`

After editing trigger definitions, press Reload Triggers in the UI or call:

```text
POST /api/macro-lab/triggers/reload
```

## Input Recording

```text
POST /api/macro-lab/recording/start
POST /api/macro-lab/recording/stop
GET  /api/macro-lab/recording
```

The returned events can be placed in an `input.playback` action.

## Adding An Action

1. Add a handler in `apps/macro-lab-api/macro_lab/actions.py`.
2. Give it an `ActionSpec` with a safety level.
3. Register it in `build_action_registry()`.
4. Add a dry-run test and, when safe, a real execution test.

## Adding A Trigger

1. Add an adapter in `apps/macro-lab-api/macro_lab/triggers.py`.
2. Make it call `TriggerManager.submit(macro_id, trigger_id, context)`.
3. Make it respect panic and enabled state.
4. Register it in `TriggerManager.rebuild()`.

## Current Limits

- Active macro runs are in-process. Run history is durable, but an in-flight macro does not
  resume after process crash.
- UI automation is keystroke/window-title based. For deeply structured app control, add a
  dedicated action using that app's API or accessibility surface.
- Some elevated windows may reject input unless Macro Lab is elevated too.
- Destructive file actions are real. Keep dry-run enabled until the preview looks right.
