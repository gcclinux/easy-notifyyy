import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getExtensionConfig, VsCodeSecretsProvider } from './config';
import {
  buildHookNotifyCommand,
  installAntigravityMcpConfig,
  installClaudeCodeHooks,
} from './hookConfigFiles';
import {
  EmailProviderType,
  ExtensionConfig,
  NotificationMode,
} from './types';

export interface SettingsUiState {
  config: ExtensionConfig;
  hasResendKey: boolean;
  hasSmtpPassword: boolean;
  activePort: number;
}

export interface SaveSettingsPayload {
  mode: NotificationMode;
  idleSeconds: number;
  cooldownSeconds: number;
  recipientEmail: string;
  senderEmail: string;
  emailProvider: EmailProviderType;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  webhookUrl: string;
  includeSummary: boolean;
  minTerminalDurationSeconds: number;
  detectorAntigravity: boolean;
  detectorCopilot: boolean;
  detectorClaudeAndKiro: boolean;
  detectorTerminal: boolean;
  resendApiKey?: string;
  smtpPassword?: string;
  clearResendApiKey?: boolean;
  clearSmtpPassword?: boolean;
}

export interface SettingsControllerDeps {
  context: vscode.ExtensionContext;
  secretsProvider: VsCodeSecretsProvider;
  getActivePort: () => number;
  sendTestEmail: () => Promise<void>;
  onSettingsChanged?: () => void;
}

function clampNumber(value: unknown, fallback: number, min: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.max(min, Math.round(num));
}

export async function saveSettingsPayload(
  payload: SaveSettingsPayload,
  secretsProvider: VsCodeSecretsProvider
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('easyNotifyyy');
  const target = vscode.ConfigurationTarget.Global;

  const mode: NotificationMode =
    payload.mode === 'always' || payload.mode === 'muted' ? payload.mode : 'away';
  const emailProvider: EmailProviderType =
    payload.emailProvider === 'smtp' || payload.emailProvider === 'webhook'
      ? payload.emailProvider
      : 'resend';

  await Promise.all([
    cfg.update('mode', mode, target),
    cfg.update('idleSeconds', clampNumber(payload.idleSeconds, 60, 5), target),
    cfg.update(
      'cooldownSeconds',
      clampNumber(payload.cooldownSeconds, 30, 0),
      target
    ),
    cfg.update('recipientEmail', (payload.recipientEmail ?? '').trim(), target),
    cfg.update(
      'senderEmail',
      (payload.senderEmail ?? '').trim() ||
        'Easy Notifyyy <onboarding@resend.dev>',
      target
    ),
    cfg.update('emailProvider', emailProvider, target),
    cfg.update('smtp.host', (payload.smtpHost ?? '').trim() || 'smtp.gmail.com', target),
    (() => {
      const port = clampNumber(payload.smtpPort, 587, 1);
      const secure =
        port === 587 ? false : port === 465 ? true : Boolean(payload.smtpSecure);
      return Promise.all([
        cfg.update('smtp.port', port, target),
        cfg.update('smtp.secure', secure, target),
      ]);
    })(),
    cfg.update('smtp.user', (payload.smtpUser ?? '').trim(), target),
    cfg.update('webhookUrl', (payload.webhookUrl ?? '').trim(), target),
    cfg.update('includeSummary', Boolean(payload.includeSummary), target),
    cfg.update(
      'minTerminalDurationSeconds',
      clampNumber(payload.minTerminalDurationSeconds, 15, 1),
      target
    ),
    cfg.update('detectors.antigravity', Boolean(payload.detectorAntigravity), target),
    cfg.update('detectors.copilot', Boolean(payload.detectorCopilot), target),
    cfg.update(
      'detectors.claudeAndKiro',
      Boolean(payload.detectorClaudeAndKiro),
      target
    ),
    cfg.update('detectors.terminal', Boolean(payload.detectorTerminal), target),
  ]);

  if (payload.clearResendApiKey) {
    await Promise.all([
      secretsProvider.setResendApiKey(''),
      cfg.update('resendApiKey', '', target),
    ]);
  } else if (typeof payload.resendApiKey === 'string' && payload.resendApiKey.trim()) {
    await secretsProvider.setResendApiKey(payload.resendApiKey);
  }

  if (payload.clearSmtpPassword) {
    await Promise.all([
      secretsProvider.setSmtpPassword(''),
      cfg.update('smtp.password', '', target),
    ]);
  } else if (typeof payload.smtpPassword === 'string' && payload.smtpPassword.trim()) {
    await secretsProvider.setSmtpPassword(payload.smtpPassword);
  }
}

export async function loadSettingsUiState(
  deps: SettingsControllerDeps
): Promise<SettingsUiState> {
  const [resendKey, smtpPass] = await Promise.all([
    deps.secretsProvider.getResendApiKey(),
    deps.secretsProvider.getSmtpPassword(),
  ]);

  return {
    config: getExtensionConfig(),
    hasResendKey: Boolean(resendKey),
    hasSmtpPassword: Boolean(smtpPass),
    activePort: deps.getActivePort(),
  };
}

export function getSettingsHtml(
  webview: vscode.Webview,
  initialState: SettingsUiState,
  nonce: string
): string {
  const serializedState = JSON.stringify(initialState).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
  />
  <title>Easy Notifyyy Settings</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 14px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
      line-height: 1.45;
    }
    .container {
      max-width: 680px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .header h1 {
      margin: 0;
      font-size: 1.15em;
      font-weight: 600;
    }
    .port-pill {
      font-size: 0.85em;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .card {
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.25)));
      border-radius: 6px;
      padding: 12px;
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .card-title {
      font-weight: 600;
      font-size: 0.95em;
      margin: 0;
      color: var(--vscode-foreground);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .row-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    @media (max-width: 420px) {
      .row-2 {
        grid-template-columns: 1fr;
      }
    }
    label {
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    input[type="text"],
    input[type="email"],
    input[type="number"],
    input[type="password"],
    input[type="url"],
    select {
      width: 100%;
      padding: 6px 8px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.35));
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: inherit;
    }
    input:focus,
    select:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.92em;
      color: var(--vscode-foreground);
      cursor: pointer;
    }
    .checkbox-row input[type="checkbox"] {
      accent-color: var(--vscode-button-background);
      margin: 0;
      width: 15px;
      height: 15px;
    }
    .hint {
      font-size: 0.82em;
      color: var(--vscode-descriptionForeground);
    }
    .badge-saved {
      font-size: 0.78em;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(34, 197, 94, 0.16);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.35);
    }
    .secret-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .secret-row input {
      flex: 1;
    }
    button {
      border: none;
      border-radius: 4px;
      padding: 7px 12px;
      font-family: inherit;
      font-size: 0.92em;
      font-weight: 500;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    button.small {
      padding: 5px 9px;
      font-size: 0.82em;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .actions button {
      flex: 1;
      min-width: 140px;
    }
    .setup-buttons {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .setup-buttons button {
      text-align: left;
    }
    .banner {
      padding: 8px 10px;
      border-radius: 5px;
      font-size: 0.9em;
      display: none;
    }
    .banner.visible {
      display: block;
    }
    .banner.success {
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.4);
      color: var(--vscode-foreground);
    }
    .banner.error {
      background: var(--vscode-inputValidation-errorBackground, rgba(239, 68, 68, 0.16));
      border: 1px solid var(--vscode-inputValidation-errorBorder, rgba(239, 68, 68, 0.5));
      color: var(--vscode-foreground);
    }
    .banner.info {
      background: var(--vscode-inputValidation-infoBackground, rgba(59, 130, 246, 0.15));
      border: 1px solid var(--vscode-inputValidation-infoBorder, rgba(59, 130, 246, 0.45));
      color: var(--vscode-foreground);
    }
    .hidden {
      display: none !important;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Easy Notifyyy</h1>
      <span class="port-pill" id="portBadge">Port: 47831</span>
    </div>

    <div class="actions">
      <button type="button" class="js-save-btn">Save Settings</button>
      <button type="button" class="secondary js-test-btn">📨 Save &amp; Send Test Email</button>
    </div>

    <div id="statusBanner" class="banner" role="status"></div>

    <div class="card">
      <h2 class="card-title">1. Mode &amp; Timing</h2>
      <div class="field">
        <label for="mode">Notification Mode</label>
        <select id="mode">
          <option value="away">Away — Only when IDE is unfocused or idle</option>
          <option value="always">Always — Notify on every completed task</option>
          <option value="muted">Muted — Pause all email notifications</option>
        </select>
      </div>
      <div class="row-2">
        <div class="field">
          <label for="idleSeconds">Idle Threshold (sec)</label>
          <input id="idleSeconds" type="number" min="5" step="5" />
        </div>
        <div class="field">
          <label for="cooldownSeconds">Cooldown (sec)</label>
          <input id="cooldownSeconds" type="number" min="0" step="5" />
        </div>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">2. Email Delivery &amp; Keychain Credentials</h2>
      <div class="field">
        <label for="recipientEmail">Recipient Email Address</label>
        <input id="recipientEmail" type="email" placeholder="you@example.com" />
      </div>

      <div class="field">
        <label for="emailProvider">Email Provider</label>
        <select id="emailProvider">
          <option value="resend">Resend API (Recommended — HTTPS)</option>
          <option value="smtp">SMTP (Gmail App Password, Outlook, Custom)</option>
          <option value="webhook">Custom HTTP Webhook</option>
        </select>
      </div>

      <div id="resendSection" class="field">
        <div class="field">
          <label for="senderEmail">Sender Email (From)</label>
          <input id="senderEmail" type="text" placeholder="Easy Notifyyy <onboarding@resend.dev>" />
        </div>
        <div class="field" style="margin-top: 6px;">
          <label for="resendApiKey">
            <span>Resend API Key</span>
            <span id="resendSavedBadge" class="badge-saved hidden">✓ Saved in Keychain</span>
          </label>
          <div class="secret-row">
            <input id="resendApiKey" type="password" placeholder="re_... (leave blank to keep existing)" autocomplete="off" />
            <button id="clearResendBtn" type="button" class="secondary small hidden">Clear</button>
          </div>
          <span class="hint">Stored securely in your OS Keychain (never in settings.json).</span>
        </div>
      </div>

      <div id="smtpSection" class="field hidden">
        <div class="row-2">
          <div class="field">
            <label for="smtpHost">SMTP Host</label>
            <input id="smtpHost" type="text" placeholder="smtp.gmail.com" />
          </div>
          <div class="field">
            <label for="smtpPort">SMTP Port</label>
            <input id="smtpPort" type="number" min="1" max="65535" />
          </div>
        </div>
        <label class="checkbox-row" style="margin-top: 4px;">
          <input id="smtpSecure" type="checkbox" />
          <span>Use implicit TLS (enable for port 465; off for 587 STARTTLS)</span>
        </label>
        <div class="field" style="margin-top: 4px;">
          <label for="smtpUser">SMTP Username / Email</label>
          <input id="smtpUser" type="text" placeholder="you@gmail.com" />
        </div>
        <div class="field" style="margin-top: 4px;">
          <label for="smtpPassword">
            <span>SMTP Password / App Password</span>
            <span id="smtpSavedBadge" class="badge-saved hidden">✓ Saved in Keychain</span>
          </label>
          <div class="secret-row">
            <input id="smtpPassword" type="password" placeholder="App password (leave blank to keep existing)" autocomplete="off" />
            <button id="clearSmtpBtn" type="button" class="secondary small hidden">Clear</button>
          </div>
          <span class="hint">For Gmail with 2FA, create a Google App Password and paste it here.</span>
        </div>
      </div>

      <div id="webhookSection" class="field hidden">
        <label for="webhookUrl">Webhook URL</label>
        <input id="webhookUrl" type="url" placeholder="https://your-worker.example.com/notify" />
      </div>

      <label class="checkbox-row" style="margin-top: 4px;">
        <input id="includeSummary" type="checkbox" />
        <span>Include AI response summary in email body</span>
      </label>
    </div>

    <div class="card">
      <h2 class="card-title">3. AI Detectors &amp; One-Click Setup</h2>
      <label class="checkbox-row">
        <input id="detectorAntigravity" type="checkbox" />
        <span>Antigravity (watches conversation transcripts)</span>
      </label>
      <label class="checkbox-row">
        <input id="detectorCopilot" type="checkbox" />
        <span>GitHub Copilot / Cursor (watches workspace chat sessions)</span>
      </label>
      <label class="checkbox-row">
        <input id="detectorClaudeAndKiro" type="checkbox" />
        <span>Claude Code &amp; Kiro (local HTTP hook endpoint)</span>
      </label>
      <label class="checkbox-row">
        <input id="detectorTerminal" type="checkbox" />
        <span>Long-running Terminal Commands</span>
      </label>
      <div class="field">
        <label for="minTerminalDurationSeconds">Min Terminal Duration (sec)</label>
        <input id="minTerminalDurationSeconds" type="number" min="1" step="1" />
      </div>

      <div class="setup-buttons" style="margin-top: 4px;">
        <button id="installAntigravityBtn" type="button" class="secondary">
          ⚡ Auto-Configure Antigravity MCP (~/.gemini/antigravity/mcp_config.json)
        </button>
        <button id="installClaudeBtn" type="button" class="secondary">
          ⚡ Auto-Configure Claude Code Hooks (~/.claude/settings.json)
        </button>
        <button id="copyKiroBtn" type="button" class="secondary">
          📋 Copy Kiro Hook Notification Command
        </button>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="js-save-btn">Save Settings</button>
      <button type="button" class="secondary js-test-btn">📨 Save &amp; Send Test Email</button>
    </div>
  </div>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const initialState = ${serializedState};

      const el = (id) => document.getElementById(id);

      let clearResendRequested = false;
      let clearSmtpRequested = false;

      function showBanner(kind, message) {
        const banner = el('statusBanner');
        banner.className = 'banner visible ' + kind;
        banner.textContent = message;
      }

      function toggleProviderSections() {
        const provider = el('emailProvider').value;
        el('resendSection').classList.toggle('hidden', provider !== 'resend');
        el('smtpSection').classList.toggle('hidden', provider !== 'smtp');
        el('webhookSection').classList.toggle('hidden', provider !== 'webhook');
      }

      function applyState(state) {
        const c = state.config;
        el('portBadge').textContent = 'Port: ' + (state.activePort || c.serverPort);
        el('mode').value = c.mode;
        el('idleSeconds').value = String(c.idleSeconds);
        el('cooldownSeconds').value = String(c.cooldownSeconds);
        el('recipientEmail').value = c.recipientEmail || '';
        el('senderEmail').value = c.senderEmail || '';
        el('emailProvider').value = c.emailProvider;
        el('smtpHost').value = c.smtp.host || 'smtp.gmail.com';
        el('smtpPort').value = String(c.smtp.port || 587);
        el('smtpSecure').checked = Boolean(c.smtp.secure);
        el('smtpUser').value = c.smtp.user || '';
        el('webhookUrl').value = c.webhookUrl || '';
        el('includeSummary').checked = Boolean(c.includeSummary);
        el('detectorAntigravity').checked = Boolean(c.detectors.antigravity);
        el('detectorCopilot').checked = Boolean(c.detectors.copilot);
        el('detectorClaudeAndKiro').checked = Boolean(c.detectors.claudeAndKiro);
        el('detectorTerminal').checked = Boolean(c.detectors.terminal);
        el('minTerminalDurationSeconds').value = String(c.minTerminalDurationSeconds);

        el('resendSavedBadge').classList.toggle('hidden', !state.hasResendKey);
        el('clearResendBtn').classList.toggle('hidden', !state.hasResendKey);
        el('smtpSavedBadge').classList.toggle('hidden', !state.hasSmtpPassword);
        el('clearSmtpBtn').classList.toggle('hidden', !state.hasSmtpPassword);

        el('resendApiKey').value = '';
        el('smtpPassword').value = '';
        clearResendRequested = false;
        clearSmtpRequested = false;

        toggleProviderSections();
      }

      function collectPayload() {
        return {
          mode: el('mode').value,
          idleSeconds: Number(el('idleSeconds').value),
          cooldownSeconds: Number(el('cooldownSeconds').value),
          recipientEmail: el('recipientEmail').value,
          senderEmail: el('senderEmail').value,
          emailProvider: el('emailProvider').value,
          smtpHost: el('smtpHost').value,
          smtpPort: Number(el('smtpPort').value),
          smtpSecure: el('smtpSecure').checked,
          smtpUser: el('smtpUser').value,
          webhookUrl: el('webhookUrl').value,
          includeSummary: el('includeSummary').checked,
          minTerminalDurationSeconds: Number(el('minTerminalDurationSeconds').value),
          detectorAntigravity: el('detectorAntigravity').checked,
          detectorCopilot: el('detectorCopilot').checked,
          detectorClaudeAndKiro: el('detectorClaudeAndKiro').checked,
          detectorTerminal: el('detectorTerminal').checked,
          resendApiKey: el('resendApiKey').value,
          smtpPassword: el('smtpPassword').value,
          clearResendApiKey: clearResendRequested,
          clearSmtpPassword: clearSmtpRequested,
        };
      }

      function setBusy(busy) {
        document
          .querySelectorAll('.js-save-btn, .js-test-btn')
          .forEach((btn) => {
            btn.disabled = busy;
          });
      }

      el('emailProvider').addEventListener('change', toggleProviderSections);

      el('smtpPort').addEventListener('change', () => {
        const port = Number(el('smtpPort').value);
        if (port === 587) {
          el('smtpSecure').checked = false;
        } else if (port === 465) {
          el('smtpSecure').checked = true;
        }
      });

      el('clearResendBtn').addEventListener('click', () => {
        clearResendRequested = true;
        el('resendApiKey').value = '';
        el('resendSavedBadge').classList.add('hidden');
        showBanner('info', 'Resend API key marked for removal. Click Save Settings to apply.');
      });

      el('clearSmtpBtn').addEventListener('click', () => {
        clearSmtpRequested = true;
        el('smtpPassword').value = '';
        el('smtpSavedBadge').classList.add('hidden');
        showBanner('info', 'SMTP password marked for removal. Click Save Settings to apply.');
      });

      document.querySelectorAll('.js-save-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          setBusy(true);
          vscode.postMessage({ type: 'save', payload: collectPayload() });
        });
      });

      document.querySelectorAll('.js-test-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          setBusy(true);
          showBanner('info', 'Saving settings and sending test email...');
          vscode.postMessage({ type: 'sendTest', payload: collectPayload() });
        });
      });

      el('installAntigravityBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'installAntigravityMcp' });
      });

      el('installClaudeBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'installClaudeHooks' });
      });

      el('copyKiroBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'copyKiroHook' });
      });

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'state') {
          applyState(msg.state);
        } else if (msg.type === 'result') {
          setBusy(false);
          showBanner(msg.ok ? 'success' : 'error', msg.message);
        }
      });

      applyState(initialState);
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}

async function handleWebviewMessage(
  webview: vscode.Webview,
  message: { type?: string; payload?: SaveSettingsPayload },
  deps: SettingsControllerDeps
): Promise<void> {
  const mcpStdioPath = path.join(
    deps.context.extensionPath,
    'dist',
    'mcp-stdio.js'
  );

  switch (message.type) {
    case 'ready': {
      const state = await loadSettingsUiState(deps);
      await webview.postMessage({ type: 'state', state });
      return;
    }

    case 'save': {
      try {
        if (!message.payload) {
          throw new Error('Missing settings payload.');
        }
        await saveSettingsPayload(message.payload, deps.secretsProvider);
        deps.onSettingsChanged?.();
        const state = await loadSettingsUiState(deps);
        await webview.postMessage({ type: 'state', state });
        await webview.postMessage({
          type: 'result',
          ok: true,
          message: 'Settings saved.',
        });
      } catch (err) {
        await webview.postMessage({
          type: 'result',
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    case 'sendTest': {
      try {
        if (message.payload) {
          await saveSettingsPayload(message.payload, deps.secretsProvider);
          deps.onSettingsChanged?.();
        }
        const state = await loadSettingsUiState(deps);
        await webview.postMessage({ type: 'state', state });
        await deps.sendTestEmail();
        await webview.postMessage({
          type: 'result',
          ok: true,
          message: 'Settings saved and test notification email sent!',
        });
      } catch (err) {
        await webview.postMessage({
          type: 'result',
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    case 'installAntigravityMcp': {
      try {
        const target = await installAntigravityMcpConfig(mcpStdioPath);
        await webview.postMessage({
          type: 'result',
          ok: true,
          message: `Antigravity MCP installed in ${target}.`,
        });
      } catch (err) {
        await webview.postMessage({
          type: 'result',
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    case 'installClaudeHooks': {
      try {
        const target = await installClaudeCodeHooks(deps.getActivePort());
        await webview.postMessage({
          type: 'result',
          ok: true,
          message: `Claude Code Stop & Notification hooks installed in ${target}.`,
        });
      } catch (err) {
        await webview.postMessage({
          type: 'result',
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    case 'copyKiroHook': {
      const cmd = buildHookNotifyCommand(deps.getActivePort(), 'kiro');
      await vscode.env.clipboard.writeText(cmd);
      await webview.postMessage({
        type: 'result',
        ok: true,
        message: 'Copied Kiro hook command to clipboard.',
      });
    }
  }
}

export class EasyNotifySidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'easyNotifyyy.sidebarView';
  private view: vscode.WebviewView | undefined;

  constructor(private readonly deps: SettingsControllerDeps) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    const initialState = await loadSettingsUiState(this.deps);
    const nonce = crypto.randomBytes(16).toString('hex');
    webviewView.webview.html = getSettingsHtml(
      webviewView.webview,
      initialState,
      nonce
    );

    webviewView.webview.onDidReceiveMessage((msg) => {
      void handleWebviewMessage(webviewView.webview, msg, this.deps);
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const state = await loadSettingsUiState(this.deps);
    await this.view.webview.postMessage({ type: 'state', state });
  }
}

export class EasyNotifySettingsPanel {
  private static currentPanel: EasyNotifySettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly deps: SettingsControllerDeps;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    deps: SettingsControllerDeps
  ) {
    this.panel = panel;
    this.deps = deps;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        void handleWebviewMessage(this.panel.webview, msg, this.deps);
      },
      null,
      this.disposables
    );
  }

  static async openOrShow(deps: SettingsControllerDeps): Promise<void> {
    if (EasyNotifySettingsPanel.currentPanel) {
      EasyNotifySettingsPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      await EasyNotifySettingsPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'easyNotifyyySettings',
      'Easy Notifyyy Settings',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    const instance = new EasyNotifySettingsPanel(panel, deps);
    EasyNotifySettingsPanel.currentPanel = instance;

    const state = await loadSettingsUiState(deps);
    const nonce = crypto.randomBytes(16).toString('hex');
    panel.webview.html = getSettingsHtml(panel.webview, state, nonce);
  }

  static async refreshIfOpen(): Promise<void> {
    if (EasyNotifySettingsPanel.currentPanel) {
      await EasyNotifySettingsPanel.currentPanel.refresh();
    }
  }

  async refresh(): Promise<void> {
    const state = await loadSettingsUiState(this.deps);
    await this.panel.webview.postMessage({ type: 'state', state });
  }

  private dispose(): void {
    EasyNotifySettingsPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}
