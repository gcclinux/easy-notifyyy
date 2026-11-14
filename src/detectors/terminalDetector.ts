import * as vscode from 'vscode';
import { AiTaskEvent, ExtensionConfig } from '../types';

export interface TerminalDetectorOptions {
  getConfig: () => ExtensionConfig;
  onEvent: (event: AiTaskEvent) => void | Promise<unknown>;
  log?: (message: string) => void;
}

export function registerTerminalDetector(
  options: TerminalDetectorOptions
): vscode.Disposable {
  const startTimes = new WeakMap<vscode.TerminalShellExecution, number>();

  const startSub = vscode.window.onDidStartTerminalShellExecution((event) => {
    startTimes.set(event.execution, Date.now());
  });

  const endSub = vscode.window.onDidEndTerminalShellExecution((event) => {
    const config = options.getConfig();
    if (!config.detectors.terminal) {
      return;
    }

    const startedAt = startTimes.get(event.execution);
    if (startedAt === undefined) {
      return;
    }

    const durationSeconds = (Date.now() - startedAt) / 1000;
    if (durationSeconds < config.minTerminalDurationSeconds) {
      return;
    }

    const commandLine =
      event.execution.commandLine.value.trim() || 'Terminal command';
    const shortCommand =
      commandLine.length > 60 ? `${commandLine.slice(0, 57)}...` : commandLine;
    const failed = event.exitCode !== undefined && event.exitCode !== 0;

    options.log?.(
      `Terminal command ended after ${Math.round(durationSeconds)}s (exit=${event.exitCode ?? 'unknown'}): ${shortCommand}`
    );

    void options.onEvent({
      source: 'terminal',
      title: `Terminal command ${failed ? 'failed' : 'finished'}: ${shortCommand}`,
      summary: [
        `Command: ${commandLine}`,
        `Duration: ${Math.round(durationSeconds)}s`,
        `Exit code: ${event.exitCode ?? 'unknown'}`,
      ].join('\n'),
      status: failed ? 'error' : 'completed',
    });
  });

  return vscode.Disposable.from(startSub, endSub);
}
