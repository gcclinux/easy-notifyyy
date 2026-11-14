import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { parseAntigravityTranscriptLine } from '../detectors/antigravityDetector';
import { EmailSender, formatNotificationEmail } from '../emailSender';
import { FocusStateTracker } from '../focusTracker';
import {
  installAntigravityMcpConfig,
  installClaudeCodeHooks,
} from '../hookConfigFiles';
import { NotificationCoordinator } from '../notificationCoordinator';
import { LocalNotifyServer } from '../server';
import { AiTaskEvent, EmailSecretsProvider, ExtensionConfig } from '../types';

function makeTestConfig(
  overrides: Partial<ExtensionConfig> = {}
): ExtensionConfig {
  return {
    mode: 'away',
    idleSeconds: 60,
    cooldownSeconds: 30,
    recipientEmail: 'dev@example.com',
    senderEmail: 'Easy Notifyyy <onboarding@resend.dev>',
    emailProvider: 'resend',
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: 'dev@example.com',
    },
    webhookUrl: '',
    includeSummary: true,
    serverPort: 0,
    minTerminalDurationSeconds: 15,
    detectors: {
      antigravity: true,
      copilot: true,
      claudeAndKiro: true,
      terminal: true,
    },
    ...overrides,
  };
}

class MemorySecrets implements EmailSecretsProvider {
  constructor(
    private readonly resendKey?: string,
    private readonly smtpPass?: string
  ) {}

  async getResendApiKey(): Promise<string | undefined> {
    return this.resendKey;
  }

  async getSmtpPassword(): Promise<string | undefined> {
    return this.smtpPass;
  }
}

test('FocusStateTracker respects away, always, muted, and idle threshold', () => {
  const startMs = 1_000_000;
  const tracker = new FocusStateTracker(true, startMs);

  // Active & focused: should not notify in away mode, should notify in always, never in muted
  assert.equal(tracker.shouldNotify('away', 60, startMs + 10_000), false);
  assert.equal(tracker.shouldNotify('always', 60, startMs + 10_000), true);
  assert.equal(tracker.shouldNotify('muted', 60, startMs + 10_000), false);

  // Idle past 60s threshold while still focused -> should notify in away mode
  assert.equal(tracker.shouldNotify('away', 60, startMs + 60_000), true);

  // Recording activity resets idle clock
  tracker.recordActivity(startMs + 60_000);
  assert.equal(tracker.shouldNotify('away', 60, startMs + 70_000), false);

  // Losing window focus triggers notification immediately in away mode
  tracker.setWindowFocused(false, startMs + 70_500);
  assert.equal(tracker.shouldNotify('away', 60, startMs + 71_000), true);
  assert.equal(tracker.shouldNotify('muted', 60, startMs + 71_000), false);

  // Refocusing resets activity and suppresses away notification
  tracker.setWindowFocused(true, startMs + 80_000);
  assert.equal(tracker.shouldNotify('away', 60, startMs + 85_000), false);
});

test('formatNotificationEmail escapes HTML and handles includeSummary toggle', () => {
  const event: AiTaskEvent = {
    source: 'antigravity',
    title: 'Build <script>alert(1)</script> finished',
    summary: 'Updated <b>auth.ts</b> & fixed bug.',
    status: 'completed',
    workspaceName: 'easy-notifyyy',
    timestamp: '2026-11-14T19:00:00.000Z',
  };

  const full = formatNotificationEmail(event, true);
  assert.match(full.subject, /\[Antigravity\]/);
  assert.match(full.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(full.html, /<script>/);
  assert.match(full.html, /Updated &lt;b&gt;auth\.ts&lt;\/b&gt; &amp; fixed bug\./);
  assert.match(full.text, /Updated <b>auth\.ts<\/b> & fixed bug\./);

  const redacted = formatNotificationEmail(event, false);
  assert.doesNotMatch(redacted.html, /auth\.ts/);
  assert.doesNotMatch(redacted.text, /auth\.ts/);
  assert.match(redacted.text, /includeSummary is disabled/);
});

test('parseAntigravityTranscriptLine distinguishes intermediate tools, final turns, and ask_question', () => {
  const userInput = JSON.stringify({
    type: 'USER_INPUT',
    status: 'DONE',
    content: 'Fix tests',
  });
  assert.deepEqual(parseAntigravityTranscriptLine(userInput), {
    isTurnEnd: false,
    needsInput: false,
  });

  const intermediateTool = JSON.stringify({
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    content: 'Running command...',
    tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'npm test' } }],
  });
  assert.deepEqual(parseAntigravityTranscriptLine(intermediateTool), {
    isTurnEnd: false,
    needsInput: false,
  });

  const finalTurn = JSON.stringify({
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    content: 'All tests pass!',
    tool_calls: [],
  });
  assert.deepEqual(parseAntigravityTranscriptLine(finalTurn), {
    isTurnEnd: true,
    needsInput: false,
    summary: 'All tests pass!',
  });

  const askQuestionTurn = JSON.stringify({
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    content: '',
    tool_calls: [
      {
        name: 'ask_question',
        arguments: {
          questions: [{ question: 'Which email provider should be default?' }],
        },
      },
    ],
  });
  assert.deepEqual(parseAntigravityTranscriptLine(askQuestionTurn), {
    isTurnEnd: true,
    needsInput: true,
    summary: 'Which email provider should be default?',
  });

  assert.deepEqual(parseAntigravityTranscriptLine('not json'), {
    isTurnEnd: false,
    needsInput: false,
  });
});

test('NotificationCoordinator filters by focus/detector and enforces cooldown with needs_input upgrade', async () => {
  let nowMs = 1_000_000;
  const sentPayloads: Array<{ subject: string; to: string[] }> = [];

  const mockFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      subject: string;
      to: string[];
    };
    sentPayloads.push(body);
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
  };

  const tracker = new FocusStateTracker(true, nowMs);
  const sender = new EmailSender(new MemorySecrets('re_test_key'), {
    fetchFn: mockFetch,
  });

  let currentConfig = makeTestConfig({ cooldownSeconds: 30 });
  const coordinator = new NotificationCoordinator({
    getConfig: () => currentConfig,
    focusTracker: tracker,
    emailSender: sender,
    getDefaultWorkspaceName: () => 'my-app',
    nowFn: () => nowMs,
  });

  // User is focused & active -> skipped
  const r1 = await coordinator.notify({
    source: 'copilot',
    title: 'Copilot done',
    status: 'completed',
  });
  assert.deepEqual(r1, { sent: false, reason: 'user_active_or_muted' });

  // User walks away (unfocused) -> sent
  tracker.setWindowFocused(false, nowMs);
  const r2 = await coordinator.notify({
    source: 'copilot',
    title: 'Copilot done',
    status: 'completed',
  });
  assert.deepEqual(r2, { sent: true });
  assert.equal(sentPayloads.length, 1);

  // Within 30s cooldown, another completed event is suppressed
  nowMs += 5_000;
  const r3 = await coordinator.notify({
    source: 'antigravity',
    title: 'Antigravity done',
    status: 'completed',
  });
  assert.deepEqual(r3, { sent: false, reason: 'cooldown' });

  // Within cooldown, a needs_input event upgrades and sends immediately
  nowMs += 1_000;
  const r4 = await coordinator.notify({
    source: 'antigravity',
    title: 'Question for you',
    status: 'needs_input',
  });
  assert.deepEqual(r4, { sent: true });
  assert.equal(sentPayloads.length, 2);

  // Disabled detector is ignored
  nowMs += 60_000;
  currentConfig = makeTestConfig({
    detectors: {
      antigravity: true,
      copilot: false,
      claudeAndKiro: true,
      terminal: true,
    },
  });
  const r5 = await coordinator.notify({
    source: 'copilot',
    title: 'Should be ignored',
    status: 'completed',
  });
  assert.deepEqual(r5, { sent: false, reason: 'detector_disabled' });
});

test('LocalNotifyServer handles /health, /notify (direct & Claude hooks), and /mcp JSON-RPC', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'easy-notifyyy-test-'));
  const serverInfoPath = path.join(tempDir, 'server.json');
  const receivedEvents: AiTaskEvent[] = [];
  const receivedForces: Array<boolean | undefined> = [];

  const server = new LocalNotifyServer({
    port: 0,
    serverInfoPath,
    onEvent: async (event, opts) => {
      receivedEvents.push(event);
      receivedForces.push(opts?.force);
      return { sent: true };
    },
  });

  try {
    const info = await server.start();
    assert.ok(info.port > 0);

    // Verify server.json written
    const savedInfo = JSON.parse(
      await fsp.readFile(serverInfoPath, 'utf8')
    ) as { port: number; mcpUrl: string };
    assert.equal(savedInfo.port, info.port);

    // 1. GET /health
    const healthRes = await fetch(`${info.url}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { ok: boolean; port: number };
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.port, info.port);

    // 2. POST /notify with direct payload and force=true
    const directRes = await fetch(`${info.url}/notify?force=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'kiro',
        title: 'Kiro build complete',
        summary: 'All checks passed',
        status: 'completed',
      }),
    });
    assert.equal(directRes.status, 200);
    assert.equal(receivedEvents.at(-1)?.source, 'kiro');
    assert.equal(receivedEvents.at(-1)?.title, 'Kiro build complete');
    assert.equal(receivedForces.at(-1), true);

    // 3. POST /notify with Claude Code hook payload
    const claudeHookRes = await fetch(`${info.url}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'Notification',
        message: 'Claude Code needs permission to run rm',
        cwd: '/tmp/sample-repo',
      }),
    });
    assert.equal(claudeHookRes.status, 200);
    assert.equal(receivedEvents.at(-1)?.source, 'claude');
    assert.equal(receivedEvents.at(-1)?.status, 'needs_input');
    assert.equal(receivedEvents.at(-1)?.workspaceName, 'sample-repo');

    // 4. POST /mcp tools/list
    const listRes = await fetch(info.mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    assert.equal(listJson.result.tools[0]?.name, 'notify_user');

    // 5. POST /mcp tools/call notify_user
    const callRes = await fetch(info.mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'notify_user',
          arguments: {
            title: 'Refactor ready',
            summary: 'Updated 3 modules',
            status: 'completed',
            agent: 'copilot',
          },
        },
      }),
    });
    assert.equal(callRes.status, 200);
    const callJson = (await callRes.json()) as {
      result: { content: Array<{ text: string }> };
    };
    assert.match(callJson.result.content[0]?.text ?? '', /Email notification sent/);
    assert.equal(receivedEvents.at(-1)?.source, 'copilot');
    assert.equal(receivedEvents.at(-1)?.title, 'Refactor ready');
  } finally {
    await server.stop();
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test('installClaudeCodeHooks and installAntigravityMcpConfig preserve existing entries and remain idempotent', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'easy-notifyyy-hooks-'));
  const claudeSettingsPath = path.join(tempDir, 'claude-settings.json');
  const antigravityMcpPath = path.join(tempDir, 'mcp_config.json');

  try {
    await fsp.writeFile(
      claudeSettingsPath,
      JSON.stringify({
        model: 'sonnet',
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'echo custom-stop' }] }],
        },
      }),
      'utf8'
    );

    await installClaudeCodeHooks(47831, claudeSettingsPath);
    await installClaudeCodeHooks(47831, claudeSettingsPath);

    const claudeParsed = JSON.parse(
      await fsp.readFile(claudeSettingsPath, 'utf8')
    ) as {
      model: string;
      hooks: {
        Stop: Array<{ hooks: Array<{ command: string }> }>;
        Notification: Array<{ hooks: Array<{ command: string }> }>;
      };
    };

    assert.equal(claudeParsed.model, 'sonnet');
    assert.equal(claudeParsed.hooks.Stop.length, 2);
    assert.equal(claudeParsed.hooks.Stop[0]?.hooks[0]?.command, 'echo custom-stop');
    assert.match(claudeParsed.hooks.Stop[1]?.hooks[0]?.command ?? '', /\.easy-notifyyy/);
    assert.equal(claudeParsed.hooks.Notification.length, 1);

    await fsp.writeFile(
      antigravityMcpPath,
      JSON.stringify({
        mcpServers: {
          otherTool: { command: 'npx', args: ['other-mcp'] },
        },
      }),
      'utf8'
    );

    await installAntigravityMcpConfig('/tmp/dist/mcp-stdio.js', antigravityMcpPath);
    await installAntigravityMcpConfig('/tmp/dist/mcp-stdio.js', antigravityMcpPath);

    const mcpParsed = JSON.parse(
      await fsp.readFile(antigravityMcpPath, 'utf8')
    ) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

    assert.deepEqual(mcpParsed.mcpServers.otherTool, {
      command: 'npx',
      args: ['other-mcp'],
    });
    assert.deepEqual(mcpParsed.mcpServers['easy-notifyyy'], {
      command: 'node',
      args: ['/tmp/dist/mcp-stdio.js'],
    });
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test('EmailSender falls back to SMTP when Resend key is absent and normalizes port 587 STARTTLS', async () => {
  const capturedTransportOptions: Array<{
    host?: string;
    port?: number;
    secure?: boolean;
    requireTLS?: boolean;
  }> = [];
  const sentMessages: Array<{ from?: string; to?: string; subject?: string }> = [];

  const mockCreateTransport = ((opts: {
    host?: string;
    port?: number;
    secure?: boolean;
    requireTLS?: boolean;
  }) => {
    capturedTransportOptions.push(opts);
    return {
      sendMail: async (mail: { from?: string; to?: string; subject?: string }) => {
        sentMessages.push(mail);
        return { messageId: 'mock-id' };
      },
    };
  }) as unknown as typeof import('nodemailer').createTransport;

  const sender = new EmailSender(new MemorySecrets(undefined, 'app-pass-1234'), {
    createTransportFn: mockCreateTransport,
  });

  await sender.send(
    {
      source: 'manual',
      title: 'Test SMTP fallback',
      status: 'completed',
    },
    makeTestConfig({
      emailProvider: 'resend',
      senderEmail: 'sender@gmail.com',
      recipientEmail: 'dest@gmail.com',
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: true,
        user: 'sender@gmail.com',
      },
    })
  );

  assert.equal(capturedTransportOptions.length, 1);
  assert.equal(capturedTransportOptions[0]?.port, 587);
  assert.equal(capturedTransportOptions[0]?.secure, false);
  assert.equal(capturedTransportOptions[0]?.requireTLS, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.to, 'dest@gmail.com');
  assert.equal(sentMessages[0]?.from, 'sender@gmail.com');
});
