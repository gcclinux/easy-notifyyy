import nodemailer from 'nodemailer';
import {
  AgentSource,
  AiTaskEvent,
  EmailSecretsProvider,
  ExtensionConfig,
  TaskStatus,
} from './types';

export interface FormattedEmail {
  subject: string;
  html: string;
  text: string;
}

const SOURCE_LABELS: Record<AgentSource, string> = {
  antigravity: 'Antigravity',
  copilot: 'GitHub Copilot',
  claude: 'Claude Code',
  kiro: 'Kiro',
  mcp: 'MCP Agent',
  terminal: 'Terminal Task',
  manual: 'Manual Trigger',
};

const STATUS_META: Record<
  TaskStatus,
  { label: string; emoji: string; badgeBg: string; badgeColor: string }
> = {
  completed: {
    label: 'Ready for Review',
    emoji: '✅',
    badgeBg: '#dcfce7',
    badgeColor: '#166534',
  },
  needs_input: {
    label: 'Needs Your Input',
    emoji: '❓',
    badgeBg: '#fef3c7',
    badgeColor: '#92400e',
  },
  error: {
    label: 'Needs Attention (Error)',
    emoji: '⚠️',
    badgeBg: '#fee2e2',
    badgeColor: '#991b1b',
  },
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatNotificationEmail(
  event: AiTaskEvent,
  includeSummary: boolean
): FormattedEmail {
  const sourceLabel = SOURCE_LABELS[event.source] ?? event.source;
  const statusMeta = STATUS_META[event.status] ?? STATUS_META.completed;
  const workspaceLabel = event.workspaceName || 'Workspace';
  const timestamp = event.timestamp || new Date().toISOString();

  const subject = `${statusMeta.emoji} [${sourceLabel}] ${event.title} (${workspaceLabel})`;

  const summaryContent = includeSummary
    ? event.summary?.trim() || 'Your AI assistant has finished and is ready for you to check.'
    : 'Summary omitted (easyNotifyyy.includeSummary is disabled for privacy).';

  const textLines = [
    `${statusMeta.emoji} ${sourceLabel} — ${statusMeta.label}`,
    `Project: ${workspaceLabel}`,
    `Title: ${event.title}`,
    `Time: ${timestamp}`,
    '',
    summaryContent,
  ];

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827; background-color: #f9fafb; margin: 0; padding: 24px;">
    <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
      <div style="padding: 20px 24px; border-bottom: 1px solid #e5e7eb;">
        <span style="display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; background-color: ${statusMeta.badgeBg}; color: ${statusMeta.badgeColor};">
          ${escapeHtml(statusMeta.emoji)} ${escapeHtml(statusMeta.label)}
        </span>
        <h2 style="margin: 12px 0 4px 0; font-size: 18px; color: #111827;">
          ${escapeHtml(event.title)}
        </h2>
        <p style="margin: 0; font-size: 13px; color: #6b7280;">
          <strong>${escapeHtml(sourceLabel)}</strong> &middot; ${escapeHtml(workspaceLabel)} &middot; ${escapeHtml(timestamp)}
        </p>
      </div>
      <div style="padding: 20px 24px; font-size: 14px; line-height: 1.6; color: #374151; white-space: pre-wrap;">${escapeHtml(summaryContent)}</div>
      <div style="padding: 12px 24px; background-color: #f3f4f6; font-size: 12px; color: #6b7280;">
        Sent by Easy Notifyyy
      </div>
    </div>
  </body>
</html>`;

  return {
    subject,
    html,
    text: textLines.join('\n'),
  };
}

export interface EmailSenderDeps {
  fetchFn?: typeof fetch;
  createTransportFn?: typeof nodemailer.createTransport;
}

export class EmailSender {
  private readonly fetchFn: typeof fetch;
  private readonly createTransportFn: typeof nodemailer.createTransport;

  constructor(
    private readonly secrets: EmailSecretsProvider,
    deps: EmailSenderDeps = {}
  ) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.createTransportFn =
      deps.createTransportFn ?? nodemailer.createTransport.bind(nodemailer);
  }

  async send(event: AiTaskEvent, config: ExtensionConfig): Promise<void> {
    const formatted = formatNotificationEmail(event, config.includeSummary);

    let effectiveProvider = config.emailProvider;
    if (effectiveProvider === 'resend') {
      const apiKey = await this.secrets.getResendApiKey();
      if (!apiKey && config.smtp.user) {
        effectiveProvider = 'smtp';
      }
    }

    switch (effectiveProvider) {
      case 'resend':
        await this.sendViaResend(formatted, config);
        return;
      case 'smtp':
        await this.sendViaSmtp(formatted, config);
        return;
      case 'webhook':
        await this.sendViaWebhook(event, formatted, config);
        return;
    }
  }

  private assertRecipient(config: ExtensionConfig): string {
    if (!config.recipientEmail) {
      throw new Error(
        'Recipient email is not configured. Set "easyNotifyyy.recipientEmail" in settings.'
      );
    }
    return config.recipientEmail;
  }

  private async sendViaResend(
    formatted: FormattedEmail,
    config: ExtensionConfig
  ): Promise<void> {
    const to = this.assertRecipient(config);
    const apiKey = await this.secrets.getResendApiKey();
    if (!apiKey) {
      throw new Error(
        'Resend API key is not configured. Run "Easy Notifyyy: Configure Email Credentials".'
      );
    }

    const response = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.senderEmail,
        to: [to],
        subject: formatted.subject,
        html: formatted.html,
        text: formatted.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Resend API error (${response.status}): ${body || response.statusText}`);
    }
  }

  private async sendViaSmtp(
    formatted: FormattedEmail,
    config: ExtensionConfig
  ): Promise<void> {
    const to = this.assertRecipient(config);
    if (!config.smtp.host || !config.smtp.user) {
      throw new Error(
        'SMTP host and user must be configured in "easyNotifyyy.smtp.*".'
      );
    }

    const pass = await this.secrets.getSmtpPassword();
    if (!pass) {
      throw new Error(
        'SMTP password is not configured. Run "Easy Notifyyy: Configure Email Credentials".'
      );
    }

    const useImplicitTls =
      config.smtp.port === 465
        ? true
        : config.smtp.port === 587
          ? false
          : config.smtp.secure;

    const transporter = this.createTransportFn({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: useImplicitTls,
      ...(config.smtp.secure && config.smtp.port === 587
        ? { requireTLS: true }
        : {}),
      auth: {
        user: config.smtp.user,
        pass,
      },
    });

    const from =
      config.senderEmail && config.senderEmail !== 'Easy Notifyyy <onboarding@resend.dev>'
        ? config.senderEmail
        : config.smtp.user;

    await transporter.sendMail({
      from,
      to,
      subject: formatted.subject,
      text: formatted.text,
      html: formatted.html,
    });
  }

  private async sendViaWebhook(
    event: AiTaskEvent,
    formatted: FormattedEmail,
    config: ExtensionConfig
  ): Promise<void> {
    if (!config.webhookUrl) {
      throw new Error(
        'Webhook URL is not configured. Set "easyNotifyyy.webhookUrl" in settings.'
      );
    }

    const response = await this.fetchFn(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          ...event,
          summary: config.includeSummary ? event.summary : undefined,
        },
        recipientEmail: config.recipientEmail || undefined,
        subject: formatted.subject,
        text: formatted.text,
        html: formatted.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Webhook error (${response.status}): ${body || response.statusText}`);
    }
  }
}
