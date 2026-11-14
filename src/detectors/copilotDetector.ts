import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { AiTaskEvent } from '../types';

export interface CopilotDetectorOptions {
  workspaceStorageDir?: string;
  debounceMs?: number;
  isEnabled: () => boolean;
  onEvent: (event: AiTaskEvent) => void | Promise<unknown>;
  log?: (message: string) => void;
}

export class CopilotDetector {
  private readonly chatSessionsDir: string | undefined;
  private readonly debounceMs: number;
  private readonly knownMtimes = new Map<string, number>();
  private watcher: fs.FSWatcher | undefined;
  private parentWatcher: fs.FSWatcher | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly options: CopilotDetectorOptions) {
    this.chatSessionsDir = options.workspaceStorageDir
      ? path.join(options.workspaceStorageDir, 'chatSessions')
      : undefined;
    this.debounceMs = options.debounceMs ?? 3000;
  }

  async start(): Promise<void> {
    if (this.disposed || !this.chatSessionsDir) {
      return;
    }

    await this.seedExistingSessions();
    this.attachWatcher();
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.close();
    this.watcher = undefined;
    this.parentWatcher?.close();
    this.parentWatcher = undefined;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  private async seedExistingSessions(): Promise<void> {
    if (!this.chatSessionsDir) return;
    try {
      const files = await fsp.readdir(this.chatSessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue;
        const fullPath = path.join(this.chatSessionsDir, file);
        const stat = await fsp.stat(fullPath);
        this.knownMtimes.set(fullPath, stat.mtimeMs);
      }
    } catch {
      // chatSessions directory may not exist yet.
    }
  }

  private attachWatcher(): void {
    if (this.disposed || !this.chatSessionsDir || this.watcher) {
      return;
    }

    if (!fs.existsSync(this.chatSessionsDir)) {
      const parentDir = path.dirname(this.chatSessionsDir);
      if (fs.existsSync(parentDir) && !this.parentWatcher) {
        try {
          this.parentWatcher = fs.watch(parentDir, (_event, filename) => {
            if (filename === 'chatSessions' && fs.existsSync(this.chatSessionsDir!)) {
              this.parentWatcher?.close();
              this.parentWatcher = undefined;
              this.attachWatcher();
            }
          });
        } catch {
          // Ignore watcher attachment errors on parent directory.
        }
      }
      return;
    }

    try {
      this.watcher = fs.watch(this.chatSessionsDir, (_eventType, filename) => {
        if (!filename || this.disposed) return;
        if (!filename.endsWith('.json') && !filename.endsWith('.jsonl')) return;
        const fullPath = path.join(this.chatSessionsDir!, filename);
        void this.handleSessionFileChange(fullPath);
      });
      this.options.log?.(`Watching Copilot chat sessions in ${this.chatSessionsDir}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.log?.(`Could not watch Copilot chatSessions: ${message}`);
    }
  }

  private async handleSessionFileChange(sessionFilePath: string): Promise<void> {
    if (this.disposed || !this.options.isEnabled()) {
      return;
    }

    try {
      const stat = await fsp.stat(sessionFilePath);
      const prevMtime = this.knownMtimes.get(sessionFilePath) ?? 0;
      if (stat.mtimeMs <= prevMtime) {
        return;
      }
      this.knownMtimes.set(sessionFilePath, stat.mtimeMs);

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = undefined;
        if (this.disposed || !this.options.isEnabled()) {
          return;
        }
        void this.emitSessionNotification(sessionFilePath);
      }, this.debounceMs);
    } catch {
      // File may have been deleted or rotated.
    }
  }

  private async emitSessionNotification(sessionFilePath: string): Promise<void> {
    let summary: string | undefined;
    try {
      const raw = await fsp.readFile(sessionFilePath, 'utf8');
      const parsed = JSON.parse(raw) as {
        requests?: Array<{
          message?: { text?: string };
          response?: Array<{ value?: string }>;
        }>;
      };

      const requests = Array.isArray(parsed.requests) ? parsed.requests : [];
      const lastRequest = requests[requests.length - 1];
      const promptText = lastRequest?.message?.text?.trim();
      const responseText = lastRequest?.response
        ?.map((part) => (typeof part?.value === 'string' ? part.value : ''))
        .join('')
        .trim();

      if (responseText) {
        summary =
          responseText.length > 400
            ? `${responseText.slice(0, 397)}...`
            : responseText;
      } else if (promptText) {
        summary = `Completed response for: "${promptText.slice(0, 200)}"`;
      }
    } catch {
      // JSONL or locked files still trigger generic completion notification.
    }

    await this.options.onEvent({
      source: 'copilot',
      title: 'GitHub Copilot finished responding',
      summary,
      status: 'completed',
    });
  }
}
