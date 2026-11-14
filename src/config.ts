import * as vscode from 'vscode';
import {
  EmailProviderType,
  EmailSecretsProvider,
  ExtensionConfig,
  NotificationMode,
} from './types';

export const SECRET_KEYS = {
  resendApiKey: 'easyNotifyyy.resendApiKey',
  smtpPassword: 'easyNotifyyy.smtpPassword',
} as const;

export function getExtensionConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('easyNotifyyy');

  const rawMode = cfg.get<string>('mode', 'away');
  const mode: NotificationMode =
    rawMode === 'always' || rawMode === 'muted' || rawMode === 'away'
      ? rawMode
      : 'away';

  const rawProvider = cfg.get<string>('emailProvider', 'resend');
  const emailProvider: EmailProviderType =
    rawProvider === 'smtp' || rawProvider === 'webhook' || rawProvider === 'resend'
      ? rawProvider
      : 'resend';

  return {
    mode,
    idleSeconds: Math.max(5, cfg.get<number>('idleSeconds', 60)),
    cooldownSeconds: Math.max(0, cfg.get<number>('cooldownSeconds', 30)),
    recipientEmail: cfg.get<string>('recipientEmail', '').trim(),
    senderEmail:
      cfg.get<string>('senderEmail', 'Easy Notifyyy <onboarding@resend.dev>').trim() ||
      'Easy Notifyyy <onboarding@resend.dev>',
    emailProvider,
    smtp: {
      host: cfg.get<string>('smtp.host', 'smtp.gmail.com').trim(),
      port: cfg.get<number>('smtp.port', 587),
      secure: cfg.get<boolean>('smtp.secure', false),
      user: cfg.get<string>('smtp.user', '').trim(),
    },
    webhookUrl: cfg.get<string>('webhookUrl', '').trim(),
    includeSummary: cfg.get<boolean>('includeSummary', true),
    serverPort: cfg.get<number>('serverPort', 47831),
    minTerminalDurationSeconds: Math.max(
      1,
      cfg.get<number>('minTerminalDurationSeconds', 15)
    ),
    detectors: {
      antigravity: cfg.get<boolean>('detectors.antigravity', true),
      copilot: cfg.get<boolean>('detectors.copilot', true),
      claudeAndKiro: cfg.get<boolean>('detectors.claudeAndKiro', true),
      terminal: cfg.get<boolean>('detectors.terminal', true),
    },
  };
}

export async function setNotificationMode(mode: NotificationMode): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('easyNotifyyy');
  await cfg.update('mode', mode, vscode.ConfigurationTarget.Global);
}

export class VsCodeSecretsProvider implements EmailSecretsProvider {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getResendApiKey(): Promise<string | undefined> {
    const val = await this.secrets.get(SECRET_KEYS.resendApiKey);
    if (val?.trim()) {
      return val.trim();
    }
    const cfgVal = vscode.workspace
      .getConfiguration('easyNotifyyy')
      .get<string>('resendApiKey', '');
    return cfgVal.trim() || undefined;
  }

  async setResendApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      await this.secrets.delete(SECRET_KEYS.resendApiKey);
      return;
    }
    await this.secrets.store(SECRET_KEYS.resendApiKey, trimmed);
  }

  async getSmtpPassword(): Promise<string | undefined> {
    const val = await this.secrets.get(SECRET_KEYS.smtpPassword);
    if (val?.trim()) {
      return val.trim();
    }
    const cfgVal = vscode.workspace
      .getConfiguration('easyNotifyyy')
      .get<string>('smtp.password', '');
    return cfgVal.trim() || undefined;
  }

  async setSmtpPassword(password: string): Promise<void> {
    const trimmed = password.trim();
    if (!trimmed) {
      await this.secrets.delete(SECRET_KEYS.smtpPassword);
      return;
    }
    await this.secrets.store(SECRET_KEYS.smtpPassword, trimmed);
  }
}
