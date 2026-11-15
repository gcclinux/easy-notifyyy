# Easy Notifyyy — AI Task Email Notifier

**Walk away from your desk while your AI coding assistant works — get notified by email the moment it finishes or needs your input.**

Easy Notifyyy runs inside **Antigravity IDE**, **VS Code (GitHub Copilot)**, **Kiro**, **Claude Code**, **Cursor**, **Windsurf**, and **VSCodium** so you never have to sit watching a loading spinner again.

---

## Why Easy Notifyyy?

- **Smart Away Detection**: In **Away** mode (default), emails are only sent when you switch away from the IDE window or remain idle longer than your configured threshold—zero inbox noise while you are actively coding.
- **Built-in Visual Settings UI**: Configure your recipient email, provider credentials, agent detectors, and test alerts straight from the **Easy Notifyyy** sidebar—no JSON files to edit manually.
- **Flexible Email Delivery**: Send notifications via **Gmail / Outlook / custom SMTP**, **Resend API**, or a **Custom Webhook**.
- **Privacy & OS Keychain Security**: API keys and SMTP passwords are stored securely in your operating system's keychain, and you can toggle off AI task summaries in emails for sensitive codebases.

---

## Quick Start (Inside the Extension)

1. Click the **Easy Notifyyy bell icon** in the left Activity Bar (or click **`Easy Notify: Away`** in the bottom-right status bar -> **Open Settings Dashboard...**).
2. Enter your **Recipient Email Address** (where alerts should arrive).
3. Choose your **Email Provider**:
   - **SMTP (Gmail, Outlook, iCloud, Custom)**: Enter your SMTP host (e.g. `smtp.gmail.com`), port (`587`), email username, and password / App Password.
   - **Resend API**: Paste your `re_...` API key directly into the masked field.
   - **Custom Webhook**: Enter a webhook URL to receive JSON POST notifications.
4. *(Optional)* Click **Auto-Configure Antigravity MCP** or **Auto-Configure Claude Code Hooks** inside section **3. AI Detectors & One-Click Setup** to wire up tool/hook integrations automatically.
5. Click **`📨 Save & Send Test Email`** at the top of the panel to verify delivery right away.

---

## Screenshot at a glance

![Screenshot](./screentshot.png)

## Gmail App Password Setup (SMTP)

If your sender Gmail account has **2-Step Verification** enabled, Google rejects normal account passwords over SMTP with `534-5.7.9 Application-specific password required`. Generate a **Google App Password** instead:

1. Open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) while signed into your sender Gmail account.
2. Enter an app name such as **`Easy Notifyyy`** and click **Create**.
3. Copy the **16-character App Password**.
4. In the **Easy Notifyyy** panel:
   - **Email Provider**: `SMTP`
   - **SMTP Host**: `smtp.gmail.com`
   - **SMTP Port & TLS**:
     - Port **`587`** uses STARTTLS — leave **Use implicit TLS** unchecked.
     - Port **`465`** uses implicit TLS — check **Use implicit TLS**.
   - **SMTP Username / Email**: Your full Gmail address (e.g. `you@gmail.com`).
   - **SMTP Password / App Password**: Paste the 16-character Google App Password.
5. Click **`📨 Save & Send Test Email`** to confirm your inbox receives the test alert.

---

## Supported AI Assistants & Tasks

| Assistant / Source | How Easy Notifyyy Detects Completion |
| --- | --- |
| **Antigravity** | Watches Antigravity conversation transcripts for completed turns and `ask_question` prompts, plus one-click MCP `notify_user` tool setup. |
| **GitHub Copilot / Cursor** | Watches workspace chat session files and triggers once an assistant response settles. |
| **Claude Code** | One-click setup installs native `Stop` and `Notification` hooks into `~/.claude/settings.json`. |
| **Kiro** | Includes a one-click copyable hook command (`POST /notify?source=kiro`) and MCP `notify_user` support. |
| **Any MCP Agent** | Exposes a built-in `notify_user` MCP tool so agents can email you directly when finished or blocked. |
| **Terminal Commands** | Automatically alerts you when long-running shell commands (default `15s` or longer) finish or fail. |

---

## Notification Modes & Key Settings

Click **`Easy Notify: Away`** in the bottom-right status bar anytime to switch modes or send a test email:

| Mode | Behavior |
| --- | --- |
| **Away** *(Default)* | Sends an email only when the IDE window is unfocused or you have been idle for `idleSeconds` (default `60s`). |
| **Always** | Sends an email every time a supported AI or long-running terminal task finishes. |
| **Muted** | Pauses all email notifications until you re-enable them. |

### Helpful Settings

| Setting | Default | Description |
| --- | --- | --- |
| `easyNotifyyy.mode` | `"away"` | Controls when emails are sent (`away`, `always`, or `muted`). |
| `easyNotifyyy.idleSeconds` | `60` | Seconds of inactivity before considering you away from your desk. |
| `easyNotifyyy.cooldownSeconds` | `30` | Minimum wait between notifications (urgent `needs_input` prompts still notify right away). |
| `easyNotifyyy.includeSummary` | `true` | Include the AI's response snippet in the email body; disable for private/sensitive projects. |
| `easyNotifyyy.minTerminalDurationSeconds` | `15` | Minimum command runtime in seconds before a terminal completion triggers an email. |
