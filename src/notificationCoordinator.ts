import { EmailSender } from './emailSender';
import { FocusStateTracker } from './focusTracker';
import { AiTaskEvent, ExtensionConfig, TaskStatus } from './types';

export interface NotificationResult {
  sent: boolean;
  reason?:
    | 'detector_disabled'
    | 'user_active_or_muted'
    | 'cooldown';
}

export interface NotificationCoordinatorDeps {
  getConfig: () => ExtensionConfig;
  focusTracker: FocusStateTracker;
  emailSender: EmailSender;
  getDefaultWorkspaceName?: () => string | undefined;
  log?: (message: string) => void;
  onDidSend?: (event: AiTaskEvent) => void;
  nowFn?: () => number;
}

export class NotificationCoordinator {
  private lastSentAtMs = 0;
  private lastSentStatus: TaskStatus | undefined;

  constructor(private readonly deps: NotificationCoordinatorDeps) {}

  private isDetectorEnabled(event: AiTaskEvent, config: ExtensionConfig): boolean {
    switch (event.source) {
      case 'antigravity':
        return config.detectors.antigravity;
      case 'copilot':
        return config.detectors.copilot;
      case 'claude':
      case 'kiro':
        return config.detectors.claudeAndKiro;
      case 'terminal':
        return config.detectors.terminal;
      case 'mcp':
      case 'manual':
        return true;
    }
  }

  async notify(
    event: AiTaskEvent,
    options: { force?: boolean } = {}
  ): Promise<NotificationResult> {
    const config = this.deps.getConfig();
    const nowMs = (this.deps.nowFn ?? Date.now)();
    const force = options.force === true;

    if (!force && !this.isDetectorEnabled(event, config)) {
      this.deps.log?.(`Ignored event from disabled detector: ${event.source}`);
      return { sent: false, reason: 'detector_disabled' };
    }

    if (
      !force &&
      !this.deps.focusTracker.shouldNotify(config.mode, config.idleSeconds, nowMs)
    ) {
      this.deps.log?.(
        `Skipped notification (${event.source}): mode=${config.mode}, focused=${this.deps.focusTracker.isWindowFocused}`
      );
      return { sent: false, reason: 'user_active_or_muted' };
    }

    if (!force && config.cooldownSeconds > 0 && this.lastSentAtMs > 0) {
      const elapsedMs = nowMs - this.lastSentAtMs;
      const withinCooldown = elapsedMs < config.cooldownSeconds * 1000;
      const isUrgentUpgrade =
        event.status === 'needs_input' && this.lastSentStatus !== 'needs_input';

      if (withinCooldown && !isUrgentUpgrade) {
        this.deps.log?.(
          `Skipped notification (${event.source}) due to ${config.cooldownSeconds}s cooldown.`
        );
        return { sent: false, reason: 'cooldown' };
      }
    }

    const enrichedEvent: AiTaskEvent = {
      ...event,
      workspaceName:
        event.workspaceName || this.deps.getDefaultWorkspaceName?.() || 'Workspace',
      timestamp: event.timestamp || new Date(nowMs).toISOString(),
    };

    await this.deps.emailSender.send(enrichedEvent, config);
    this.lastSentAtMs = nowMs;
    this.lastSentStatus = enrichedEvent.status;
    this.deps.log?.(
      `Sent notification email for ${enrichedEvent.source}: "${enrichedEvent.title}"`
    );
    this.deps.onDidSend?.(enrichedEvent);
    return { sent: true };
  }
}
