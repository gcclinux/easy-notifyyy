import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  getExtensionConfig,
  setNotificationMode,
  VsCodeSecretsProvider,
} from './config';
import { AntigravityDetector } from './detectors/antigravityDetector';
import { CopilotDetector } from './detectors/copilotDetector';
import { registerTerminalDetector } from './detectors/terminalDetector';
import { EmailSender } from './emailSender';
import { setupAgentHooksWizard } from './hookInstaller';
import { NotificationCoordinator } from './notificationCoordinator';
import { LocalNotifyServer } from './server';
import {
  EasyNotifySettingsPanel,
  EasyNotifySidebarProvider,
  SettingsControllerDeps,
} from './settingsView';
import { StatusBarController } from './statusBar';
import { AiTaskEvent, NotificationMode } from './types';
import { createVsCodeFocusTracker } from './vscodeFocusTracker';

let activeServer: LocalNotifyServer | undefined;

function getDefaultWorkspaceName(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.name;
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const output = vscode.window.createOutputChannel('Easy Notifyyy');
  const log = (message: string) => {
    output.appendLine(`[${new Date().toISOString()}] ${message}`);
  };

  const secretsProvider = new VsCodeSecretsProvider(context.secrets);
  const focusTracker = createVsCodeFocusTracker(context.subscriptions);
  const emailSender = new EmailSender(secretsProvider);
  const statusBar = new StatusBarController();

  const coordinator = new NotificationCoordinator({
    getConfig: getExtensionConfig,
    focusTracker,
    emailSender,
    getDefaultWorkspaceName,
    log,
  });

  const handleDetectedEvent = async (
    event: AiTaskEvent,
    options?: { force?: boolean }
  ) => {
    try {
      return await coordinator.notify(event, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Failed to send notification: ${message}`);
      return { sent: false };
    }
  };

  const sendTestEmail = async (): Promise<void> => {
    await coordinator.notify(
      {
        source: 'manual',
        title: 'Test notification from Easy Notifyyy',
        summary:
          'If you received this email, Easy Notifyyy is configured and ready to alert you when your AI agents finish.',
        status: 'completed',
      },
      { force: true }
    );
  };

  const initialConfig = getExtensionConfig();
  let currentServerPort = initialConfig.serverPort;

  const settingsDeps: SettingsControllerDeps = {
    context,
    secretsProvider,
    getActivePort: () => activeServer?.port ?? getExtensionConfig().serverPort,
    sendTestEmail,
    onSettingsChanged: () => {
      statusBar.update(getExtensionConfig(), activeServer?.port);
      void sidebarProvider.refresh();
      void EasyNotifySettingsPanel.refreshIfOpen();
    },
  };

  const sidebarProvider = new EasyNotifySidebarProvider(settingsDeps);

  const startServer = async (port: number) => {
    if (activeServer) {
      await activeServer.stop();
      activeServer = undefined;
    }
    const server = new LocalNotifyServer({
      port,
      onEvent: handleDetectedEvent,
      log,
    });
    const info = await server.start();
    activeServer = server;
    currentServerPort = port;
    statusBar.update(getExtensionConfig(), info.port);
    void sidebarProvider.refresh();
    void EasyNotifySettingsPanel.refreshIfOpen();
    return info;
  };

  try {
    await startServer(initialConfig.serverPort);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to start local notify server: ${message}`);
    statusBar.update(initialConfig);
  }

  const antigravityDetector = new AntigravityDetector({
    isEnabled: () => getExtensionConfig().detectors.antigravity,
    onEvent: handleDetectedEvent,
    log,
  });
  void antigravityDetector.start();

  const workspaceStorageDir = context.storageUri
    ? path.dirname(context.storageUri.fsPath)
    : undefined;
  const copilotDetector = new CopilotDetector({
    workspaceStorageDir,
    isEnabled: () => getExtensionConfig().detectors.copilot,
    onEvent: handleDetectedEvent,
    log,
  });
  void copilotDetector.start();

  const terminalDetector = registerTerminalDetector({
    getConfig: getExtensionConfig,
    onEvent: handleDetectedEvent,
    log,
  });

  context.subscriptions.push(
    output,
    statusBar,
    antigravityDetector,
    copilotDetector,
    terminalDetector,
    vscode.window.registerWebviewViewProvider(
      EasyNotifySidebarProvider.viewType,
      sidebarProvider
    ),
    {
      dispose: () => {
        if (activeServer) {
          void activeServer.stop();
          activeServer = undefined;
        }
      },
    }
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('easyNotifyyy')) {
        return;
      }
      const updated = getExtensionConfig();
      statusBar.update(updated, activeServer?.port);
      void sidebarProvider.refresh();
      void EasyNotifySettingsPanel.refreshIfOpen();
      if (updated.serverPort !== currentServerPort) {
        void startServer(updated.serverPort).catch((err) => {
          log(
            `Failed restarting server on port ${updated.serverPort}: ${err instanceof Error ? err.message : String(err)}`
          );
        });
      }
    })
  );

  const runSendTestEmailCommand = async () => {
    try {
      await sendTestEmail();
      void vscode.window.showInformationMessage(
        'Easy Notifyyy: Test notification email sent!'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const picked = await vscode.window.showErrorMessage(
        `Easy Notifyyy: ${message}`,
        'Open Settings'
      );
      if (picked === 'Open Settings') {
        await EasyNotifySettingsPanel.openOrShow(settingsDeps);
      }
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('easyNotifyyy.openSettings', async () => {
      await EasyNotifySettingsPanel.openOrShow(settingsDeps);
    }),

    vscode.commands.registerCommand('easyNotifyyy.setCredentials', async () => {
      await EasyNotifySettingsPanel.openOrShow(settingsDeps);
    }),

    vscode.commands.registerCommand('easyNotifyyy.toggleMode', async () => {
      const current = getExtensionConfig().mode;
      const items: Array<{
        label: string;
        description: string;
        action: 'openSettings' | 'sendTest' | NotificationMode;
      }> = [
        {
          label: '$(gear) Open Settings Dashboard...',
          description:
            'Configure email, API key / SMTP password, detectors, and hooks',
          action: 'openSettings',
        },
        {
          label: '$(mail) Send Test Notification Email Now',
          description: 'Send a test email immediately using your current settings',
          action: 'sendTest',
        },
        {
          label: '$(bell) Away',
          description:
            'Notify only when IDE is unfocused or idle (Recommended)',
          action: 'away',
        },
        {
          label: '$(bell-dot) Always',
          description: 'Always notify when a task completes',
          action: 'always',
        },
        {
          label: '$(bell-slash) Muted',
          description: 'Disable all email notifications',
          action: 'muted',
        },
      ];

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: `Current mode: ${current}. Select notification mode or action:`,
      });
      if (!pick) {
        return;
      }

      if (pick.action === 'openSettings') {
        await EasyNotifySettingsPanel.openOrShow(settingsDeps);
        return;
      }

      if (pick.action === 'sendTest') {
        await runSendTestEmailCommand();
        return;
      }

      await setNotificationMode(pick.action);
      statusBar.update(getExtensionConfig(), activeServer?.port);
      void sidebarProvider.refresh();
      void EasyNotifySettingsPanel.refreshIfOpen();
      void vscode.window.showInformationMessage(
        `Easy Notifyyy mode set to "${pick.action}".`
      );
    }),

    vscode.commands.registerCommand(
      'easyNotifyyy.sendTestEmail',
      runSendTestEmailCommand
    ),

    vscode.commands.registerCommand('easyNotifyyy.setupAgentHooks', async () => {
      await setupAgentHooksWizard(
        context,
        activeServer?.port ?? getExtensionConfig().serverPort
      );
    }),

    vscode.commands.registerCommand('easyNotifyyy.notifyNow', async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'Notification title',
        value: 'Task ready for review',
      });
      if (!title) {
        return;
      }
      try {
        await coordinator.notify(
          {
            source: 'manual',
            title: title.trim(),
            status: 'completed',
          },
          { force: true }
        );
        void vscode.window.showInformationMessage(
          `Easy Notifyyy: Sent "${title.trim()}".`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Easy Notifyyy: ${message}`);
      }
    })
  );
}

export async function deactivate(): Promise<void> {
  if (activeServer) {
    await activeServer.stop();
    activeServer = undefined;
  }
}
