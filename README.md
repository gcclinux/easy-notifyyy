# Easy Notifyyy — AI Task Email Notifier

Get notified by email when your AI coding assistant finishes its task or needs your input, so you can walk away from your desk and come back only when your IDE is ready for review.

Works across **Antigravity**, **VS Code (GitHub Copilot)**, **Kiro**, **Claude Code**, **Cursor**, **Windsurf**, and **VSCodium**.

---

## Features

- **Multi-Agent Detection**
  - **Antigravity**: Watches conversation transcript logs (`~/.gemini/antigravity/brain`) and triggers when a planner turn finishes or calls `ask_question`.
  - **GitHub Copilot / Cursor**: Watches workspace `chatSessions` files for settled assistant responses.
  - **Claude Code & Kiro**: Built-in localhost HTTP endpoint (`POST /notify`) accepts native `Stop` and `Notification` hooks.
  - **Universal MCP Server**: Built-in MCP tool (`notify_user`) over HTTP (`POST /mcp`) and stdio (`dist/mcp-stdio.js`) so any MCP-capable agent can alert you directly.
  - **Long-Running Terminal Tasks**: Detects shell commands running longer than `easyNotifyyy.minTerminalDurationSeconds` (default `15s`) via VS Code terminal shell integration.
- **Smart Away / Focus Detection**
  - In **`away`** mode (default), emails are only sent when your IDE window is unfocused **or** you have been idle longer than `easyNotifyyy.idleSeconds` (default `60s`).
  - Switch quickly between **Away**, **Always**, and **Muted** from the bottom status bar (`Easy Notify: Away`).
- **Flexible Email Delivery**
  - **Resend API** (HTTPS `fetch`, great free tier, zero SMTP setup).
  - **SMTP** (`nodemailer` — works with Gmail App Passwords, Outlook, iCloud, Fastmail, or custom SMTP servers).
  - **Custom Webhook** (POST JSON payload to Slack/Discord/n8n/Cloudflare Worker).
- **Privacy & Keychain Security**
  - API keys and SMTP passwords are stored in your OS keychain via VS Code `SecretStorage` (never written to `settings.json`).
  - Toggle `easyNotifyyy.includeSummary` off to omit AI message details from email bodies on sensitive repositories.

---

## Quick Start (Built-in Settings UI)

No manual JSON editing required — open the **Easy Notifyyy** bell icon in the Activity Bar (left sidebar) or run **Easy Notifyyy: Open Settings UI** (`Cmd+Shift+P` / `Ctrl+Shift+P`):

1. **Enter your Recipient Email** (`you@example.com`).
2. **Choose your Email Provider**:
   - **Resend API (Default)**: Paste your `re_...` API key directly into the password box (stored in your OS keychain).
   - **SMTP (Gmail App Password / Outlook / Custom)**: Enter SMTP host (`smtp.gmail.com`), port (`587`), email username, and App Password.
   - **Custom Webhook**: Enter a webhook URL to receive JSON POST payloads.
3. **One-Click Agent Setup**: Click **Auto-Configure Antigravity MCP** or **Auto-Configure Claude Code Hooks** right inside the Settings UI.
4. Click **Save & Send Test Email** to verify everything immediately.

### Gmail App Password Setup (SMTP)

If you use a Gmail account with 2-Step Verification enabled, Google rejects your regular account password over SMTP with `534-5.7.9 Application-specific password required`. Use a **Google App Password** instead:

1. Open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) while signed into your sender Gmail account (2-Step Verification must be enabled on the Google account).
2. Enter an app name such as **`Easy Notifyyy`** and click **Create**.
3. Copy the generated **16-character App Password** (you can remove or keep the spaces).
4. In the **Easy Notifyyy** Settings UI (or `easyNotifyyy.smtp.*` in Settings):
   - **Email Provider**: `smtp`
   - **SMTP Host**: `smtp.gmail.com`
   - **SMTP Port & TLS**:
     - Port **`587`** uses STARTTLS -> leave **Use implicit TLS** (`easyNotifyyy.smtp.secure`) **unchecked (`false`)**.
     - Port **`465`** uses implicit TLS -> check **Use implicit TLS** (`easyNotifyyy.smtp.secure`: `true`).
   - **SMTP Username / Email**: your full Gmail address (e.g. `you@gmail.com`).
   - **SMTP Password / App Password**: paste the 16-character Google App Password.
5. Click **Save & Send Test Email** to confirm delivery.

---

## How Away / Focus Detection Works

Easy Notifyyy tracks IDE window focus (`vscode.window.state.focused`) and user editor/terminal activity:

- **`away` (Recommended)**: Notifies only if the IDE window is unfocused **or** no typing/selection/tab activity has happened for at least `easyNotifyyy.idleSeconds` seconds.
- **`always`**: Always sends an email whenever a task finishes, even while actively using the IDE.
- **`muted`**: Pauses all email notifications.

A configurable `easyNotifyyy.cooldownSeconds` window (default `30s`) prevents duplicate inbox spam if multiple detectors fire close together, while immediately allowing `needs_input` alerts through.

---

## Setting Up MCP & Agent Hooks

Run **Easy Notifyyy: Setup Agent Hooks & MCP** from the Command Palette (`easyNotifyyy.setupAgentHooks`) to:

1. **Auto-install Claude Code Hooks**: Automatically adds `Stop` and `Notification` hooks to `~/.claude/settings.json` while preserving your existing settings.
2. **Open MCP & Hook Snippets**: Generates ready-to-paste JSON for:
   - Stdio MCP clients (`mcpServers` for Antigravity `~/.gemini/antigravity/mcp_config.json`, Cursor `~/.cursor/mcp.json`, Claude, Kiro) using `node <extensionPath>/dist/mcp-stdio.js`.
   - VS Code / Copilot HTTP MCP (`.vscode/mcp.json`) pointing to `http://127.0.0.1:47831/mcp`.
   - Kiro hook command posting to `POST http://127.0.0.1:47831/notify?source=kiro`.

At startup, the extension writes its active port and URLs to `~/.easy-notifyyy/server.json`.

---

## Development, Packaging & Publishing

### Local Build & Tests

```bash
npm install
npm run typecheck
npm run build
npm test
```

### Package `.vsix`

```bash
npm run build
npm run package:vsix
```

### Publish to OpenVSX (Antigravity, Kiro, Cursor, VSCodium)

```bash
npx ovsx publish easy-notifyyy-0.1.0.vsix -p <OPENVSX_TOKEN>
```

### Publish to VS Code Marketplace

```bash
npx @vscode/vsce publish -p <VSCE_PAT>
```
