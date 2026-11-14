export type NotificationMode = 'away' | 'always' | 'muted';

export type EmailProviderType = 'resend' | 'smtp' | 'webhook';

export type AgentSource =
  | 'antigravity'
  | 'copilot'
  | 'claude'
  | 'kiro'
  | 'mcp'
  | 'terminal'
  | 'manual';

export type TaskStatus = 'completed' | 'needs_input' | 'error';

export interface AiTaskEvent {
  source: AgentSource;
  title: string;
  summary?: string;
  status: TaskStatus;
  workspaceName?: string;
  timestamp?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
}

export interface DetectorConfig {
  antigravity: boolean;
  copilot: boolean;
  claudeAndKiro: boolean;
  terminal: boolean;
}

export interface ExtensionConfig {
  mode: NotificationMode;
  idleSeconds: number;
  cooldownSeconds: number;
  recipientEmail: string;
  senderEmail: string;
  emailProvider: EmailProviderType;
  smtp: SmtpConfig;
  webhookUrl: string;
  includeSummary: boolean;
  serverPort: number;
  minTerminalDurationSeconds: number;
  detectors: DetectorConfig;
}

export interface EmailSecretsProvider {
  getResendApiKey(): Promise<string | undefined>;
  getSmtpPassword(): Promise<string | undefined>;
}
