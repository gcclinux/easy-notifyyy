import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AiTaskEvent } from '../types';

export interface AntigravityParseResult {
  isTurnEnd: boolean;
  needsInput: boolean;
  summary?: string;
}

function truncateText(text: string, maxLength = 500): string {
  const cleaned = text.trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 3)}...`;
}

function extractToolName(toolCall: unknown): string | undefined {
  if (typeof toolCall !== 'object' || toolCall === null) {
    return undefined;
  }
  const obj = toolCall as Record<string, unknown>;
  if (typeof obj.name === 'string') {
    return obj.name;
  }
  if (typeof obj.tool_name === 'string') {
    return obj.tool_name;
  }
  if (typeof obj.function === 'object' && obj.function !== null) {
    const fn = obj.function as Record<string, unknown>;
    if (typeof fn.name === 'string') {
      return fn.name;
    }
  }
  return undefined;
}

function extractQuestionSummary(toolCall: unknown): string | undefined {
  if (typeof toolCall !== 'object' || toolCall === null) {
    return undefined;
  }
  const obj = toolCall as Record<string, unknown>;
  const rawArgs = obj.arguments ?? obj.args;
  let parsedArgs: Record<string, unknown> | undefined;

  if (typeof rawArgs === 'string') {
    try {
      parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  } else if (typeof rawArgs === 'object' && rawArgs !== null) {
    parsedArgs = rawArgs as Record<string, unknown>;
  }

  if (!parsedArgs) {
    return undefined;
  }

  if (Array.isArray(parsedArgs.questions) && parsedArgs.questions.length > 0) {
    const first = parsedArgs.questions[0] as Record<string, unknown> | undefined;
    if (first && typeof first.question === 'string' && first.question.trim()) {
      return truncateText(first.question);
    }
  }
  if (typeof parsedArgs.question === 'string' && parsedArgs.question.trim()) {
    return truncateText(parsedArgs.question);
  }
  return undefined;
}

export function parseAntigravityTranscriptLine(
  line: string
): AntigravityParseResult {
  const trimmed = line.trim();
  if (!trimmed) {
    return { isTurnEnd: false, needsInput: false };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { isTurnEnd: false, needsInput: false };
  }

  if (parsed.type !== 'PLANNER_RESPONSE' || parsed.status !== 'DONE') {
    return { isTurnEnd: false, needsInput: false };
  }

  const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
  const rawContent =
    typeof parsed.content === 'string' && parsed.content.trim()
      ? truncateText(parsed.content)
      : undefined;

  if (toolCalls.length === 0) {
    return {
      isTurnEnd: true,
      needsInput: false,
      summary: rawContent,
    };
  }

  const askQuestionCall = toolCalls.find(
    (tc) => extractToolName(tc) === 'ask_question'
  );
  if (askQuestionCall) {
    return {
      isTurnEnd: true,
      needsInput: true,
      summary: extractQuestionSummary(askQuestionCall) ?? rawContent,
    };
  }

  return { isTurnEnd: false, needsInput: false };
}

export interface AntigravityDetectorOptions {
  brainDir?: string;
  debounceMs?: number;
  isEnabled: () => boolean;
  onEvent: (event: AiTaskEvent) => void | Promise<unknown>;
  log?: (message: string) => void;
}

export class AntigravityDetector {
  private readonly brainDir: string;
  private readonly debounceMs: number;
  private readonly fileOffsets = new Map<string, number>();
  private readonly lineRemainders = new Map<string, string>();
  private watcher: fs.FSWatcher | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly options: AntigravityDetectorOptions) {
    this.brainDir =
      options.brainDir ?? path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
    this.debounceMs = options.debounceMs ?? 2500;
  }

  async start(): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.seedExistingTranscriptOffsets();
    this.attachWatcher();
  }

  dispose(): void {
    this.disposed = true;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.clearPendingNotification();
  }

  private clearPendingNotification(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  private async seedExistingTranscriptOffsets(): Promise<void> {
    try {
      const entries = await fsp.readdir(this.brainDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const transcriptPath = path.join(
          this.brainDir,
          entry.name,
          '.system_generated',
          'logs',
          'transcript.jsonl'
        );
        try {
          const stat = await fsp.stat(transcriptPath);
          this.fileOffsets.set(transcriptPath, stat.size);
        } catch {
          // Transcript does not exist yet for this conversation.
        }
      }
    } catch {
      // Brain directory does not exist yet.
    }
  }

  private attachWatcher(): void {
    if (this.disposed || this.watcher) {
      return;
    }

    if (!fs.existsSync(this.brainDir)) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        this.attachWatcher();
      }, 15_000);
      return;
    }

    try {
      this.watcher = fs.watch(
        this.brainDir,
        { recursive: true },
        (_eventType, filename) => {
          if (!filename || this.disposed) {
            return;
          }
          const normalized = filename.replace(/\\/g, '/');
          if (!normalized.endsWith('/transcript.jsonl') && normalized !== 'transcript.jsonl') {
            return;
          }
          const fullPath = path.join(this.brainDir, filename);
          void this.processTranscriptChanges(fullPath);
        }
      );
      this.watcher.on('error', (err) => {
        this.options.log?.(`Antigravity watcher error: ${err.message}`);
      });
      this.options.log?.(`Watching Antigravity transcripts in ${this.brainDir}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.log?.(`Could not watch ${this.brainDir}: ${message}`);
    }
  }

  async processTranscriptChanges(transcriptPath: string): Promise<void> {
    if (this.disposed || !this.options.isEnabled()) {
      return;
    }

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(transcriptPath);
    } catch {
      return;
    }

    let offset = this.fileOffsets.get(transcriptPath) ?? 0;
    if (stat.size < offset) {
      offset = 0;
      this.lineRemainders.delete(transcriptPath);
    }
    if (stat.size === offset) {
      return;
    }

    let handle: fsp.FileHandle | undefined;
    try {
      handle = await fsp.open(transcriptPath, 'r');
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      this.fileOffsets.set(transcriptPath, stat.size);

      const chunk = (this.lineRemainders.get(transcriptPath) ?? '') + buffer.toString('utf8');
      const lines = chunk.split('\n');
      const remainder = lines.pop() ?? '';
      this.lineRemainders.set(transcriptPath, remainder);

      for (const line of lines) {
        const result = parseAntigravityTranscriptLine(line);
        if (result.isTurnEnd) {
          this.scheduleNotification(result);
        } else if (line.trim()) {
          this.clearPendingNotification();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.log?.(`Failed reading Antigravity transcript: ${message}`);
    } finally {
      await handle?.close();
    }
  }

  private scheduleNotification(result: AntigravityParseResult): void {
    this.clearPendingNotification();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      if (this.disposed || !this.options.isEnabled()) {
        return;
      }

      const event: AiTaskEvent = {
        source: 'antigravity',
        title: result.needsInput
          ? 'Antigravity needs your input'
          : 'Antigravity finished its task',
        summary: result.summary,
        status: result.needsInput ? 'needs_input' : 'completed',
      };

      void this.options.onEvent(event);
    }, this.debounceMs);
  }
}
