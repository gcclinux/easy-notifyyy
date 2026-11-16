import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  buildHookNotifyCommand,
  buildMcpConfigSnippets,
  installAntigravityMcpConfig,
  installClaudeCodeHooks,
  installKiroConfig,
} from './hookConfigFiles';

export {
  buildHookNotifyCommand,
  buildMcpConfigSnippets,
  installAntigravityMcpConfig,
  installClaudeCodeHooks,
  installKiroConfig,
};

export function getKiroHooksDirs(): string[] {
  const dirs = [path.join(os.homedir(), '.kiro', 'hooks')];
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (folder) {
    dirs.push(path.join(folder, '.kiro', 'hooks'));
  }
  return dirs;
}

export async function setupAgentHooksWizard(
  context: vscode.ExtensionContext,
  serverPort: number
): Promise<void> {
  const mcpStdioPath = path.join(context.extensionPath, 'dist', 'mcp-stdio.js');

  const pick = await vscode.window.showQuickPick(
    [
      {
        id: 'antigravity',
        label: '$(rocket) Install Antigravity MCP Server (~/.gemini/antigravity/mcp_config.json)',
        description: 'Registers easy-notifyyy notify_user tool in Antigravity',
      },
      {
        id: 'claude',
        label: '$(terminal) Install Claude Code Stop & Notification Hooks',
        description: 'Writes Stop + Notification hooks to ~/.claude/settings.json',
      },
      {
        id: 'kiro',
        label: '$(zap) Install Kiro Hook, MCP Server & Steering (~/.kiro)',
        description: 'Stop hook + notify_user MCP tool for Kiro',
      },
      {
        id: 'mcp-doc',
        label: '$(json) Open MCP & Hook Configuration Snippets',
        description: 'For Antigravity, GitHub Copilot (.vscode/mcp.json), Cursor, and Kiro',
      },
      {
        id: 'copy-stdio',
        label: '$(copy) Copy MCP Stdio Server Config',
        description: `node ${mcpStdioPath}`,
      },
      {
        id: 'copy-kiro',
        label: '$(copy) Copy Kiro Hook Notification Command',
        description: 'Command that sends POST /notify?source=kiro to Easy Notifyyy',
      },
    ],
    {
      placeHolder: 'Choose how to connect AI agents to Easy Notifyyy',
    }
  );

  if (!pick) {
    return;
  }

  if (pick.id === 'antigravity') {
    try {
      const targetPath = await installAntigravityMcpConfig(mcpStdioPath);
      void vscode.window.showInformationMessage(
        `Easy Notifyyy MCP server installed in ${targetPath}.`
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to install Antigravity MCP config: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return;
  }

  if (pick.id === 'claude') {
    try {
      const targetPath = await installClaudeCodeHooks(serverPort);
      void vscode.window.showInformationMessage(
        `Easy Notifyyy hooks installed in ${targetPath}.`
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to install Claude Code hooks: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return;
  }

  if (pick.id === 'kiro') {
    try {
      const result = await installKiroConfig(
        mcpStdioPath,
        serverPort,
        { hooksDirs: getKiroHooksDirs() }
      );
      void vscode.window.showInformationMessage(
        `Easy Notifyyy Kiro setup done. Hook: ${result.hookFiles.join(', ')}. MCP: ${result.mcpConfigPath}. Restart Kiro or reload its MCP servers to apply.`
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to install Kiro config: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return;
  }
  if (pick.id === 'mcp-doc') {
    const content = buildMcpConfigSnippets(mcpStdioPath, serverPort);
    const doc = await vscode.workspace.openTextDocument({
      language: 'json',
      content,
    });
    await vscode.window.showTextDocument(doc);
    return;
  }

  if (pick.id === 'copy-stdio') {
    const snippet = JSON.stringify(
      {
        'easy-notifyyy': {
          command: 'node',
          args: [mcpStdioPath],
        },
      },
      null,
      2
    );
    await vscode.env.clipboard.writeText(snippet);
    void vscode.window.showInformationMessage(
      'Copied Easy Notifyyy MCP stdio config to clipboard.'
    );
    return;
  }

  if (pick.id === 'copy-kiro') {
    await vscode.env.clipboard.writeText(
      buildHookNotifyCommand(serverPort, 'kiro')
    );
    void vscode.window.showInformationMessage(
      'Copied Kiro hook command to clipboard.'
    );
  }
}
