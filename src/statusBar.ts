import * as vscode from 'vscode';
import { ExtensionConfig, NotificationMode } from './types';

const MODE_DISPLAY: Record<
  NotificationMode,
  { icon: string; label: string; detail: string }
> = {
  away: {
    icon: '$(bell)',
    label: 'Away',
    detail: 'Emails when IDE is unfocused or idle',
  },
  always: {
    icon: '$(bell-dot)',
    label: 'Always',
    detail: 'Emails on every completed AI/terminal task',
  },
  muted: {
    icon: '$(bell-slash)',
    label: 'Muted',
    detail: 'Email notifications paused',
  },
};

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'easyNotifyyy.toggleMode';
    this.item.show();
  }

  update(config: ExtensionConfig, activePort?: number): void {
    const modeInfo = MODE_DISPLAY[config.mode];
    this.item.text = `${modeInfo.icon} Easy Notify: ${modeInfo.label}`;

    const recipientText = config.recipientEmail || 'Not configured';
    const portText = activePort ? String(activePort) : String(config.serverPort);

    this.item.tooltip = [
      `Easy Notifyyy — ${modeInfo.detail}`,
      `Provider: ${config.emailProvider}`,
      `Recipient: ${recipientText}`,
      `Local MCP/Hook Port: ${portText}`,
      'Click to switch mode or open Settings UI',
    ].join('\n');
  }

  dispose(): void {
    this.item.dispose();
  }
}
