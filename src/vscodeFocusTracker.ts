import * as vscode from 'vscode';
import { FocusStateTracker } from './focusTracker';

export function createVsCodeFocusTracker(
  disposables: vscode.Disposable[]
): FocusStateTracker {
  const tracker = new FocusStateTracker(vscode.window.state.focused);

  disposables.push(
    vscode.window.onDidChangeWindowState((state) => {
      tracker.setWindowFocused(state.focused);
    }),
    vscode.workspace.onDidChangeTextDocument(() => {
      tracker.recordActivity();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      tracker.recordActivity();
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      tracker.recordActivity();
    }),
    vscode.window.onDidChangeActiveTerminal(() => {
      tracker.recordActivity();
    })
  );

  return tracker;
}
