import { AgentSource, AiTaskEvent, TaskStatus } from './types';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export const NOTIFY_USER_TOOL_DEFINITION = {
  name: 'notify_user',
  description:
    'Send an email notification to the user when an AI task finishes, fails, or requires user input/review so they can return to their workstation.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short summary of what finished or what needs user attention.',
      },
      summary: {
        type: 'string',
        description: 'Optional details or next steps for the user.',
      },
      status: {
        type: 'string',
        enum: ['completed', 'needs_input', 'error'],
        default: 'completed',
        description: 'Current outcome or state of the AI task.',
      },
      agent: {
        type: 'string',
        description:
          'Name of the AI assistant sending the notification (e.g. antigravity, copilot, claude, kiro).',
      },
    },
    required: ['title'],
  },
} as const;

export function normalizeAgentSource(raw?: unknown): AgentSource {
  if (typeof raw !== 'string') {
    return 'mcp';
  }
  const lower = raw.trim().toLowerCase();
  if (lower.includes('antigravity')) return 'antigravity';
  if (lower.includes('copilot')) return 'copilot';
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('kiro')) return 'kiro';
  if (lower.includes('terminal')) return 'terminal';
  if (lower.includes('manual')) return 'manual';
  return 'mcp';
}

export function normalizeTaskStatus(raw?: unknown): TaskStatus {
  if (raw === 'needs_input' || raw === 'error' || raw === 'completed') {
    return raw;
  }
  return 'completed';
}

export async function handleMcpJsonRpc(
  request: JsonRpcRequest,
  onNotifyToolCall: (event: AiTaskEvent) => Promise<{
    sent: boolean;
    reason?: string;
  }>
): Promise<JsonRpcResponse | null> {
  const hasId = request.id !== undefined && request.id !== null;
  const id = request.id ?? null;
  const method = request.method;

  if (!method) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request: missing method' },
    };
  }

  if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
    return hasId ? { jsonrpc: '2.0', id, result: {} } : null;
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'easy-notifyyy',
          version: '0.1.0',
        },
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [NOTIFY_USER_TOOL_DEFINITION],
      },
    };
  }

  if (method === 'tools/call') {
    const params = request.params ?? {};
    const toolName = params.name;
    if (toolName !== 'notify_user') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unknown tool: ${String(toolName)}` },
      };
    }

    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const rawTitle = typeof args.title === 'string' ? args.title.trim() : '';
    if (!rawTitle) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing required argument: title' },
      };
    }

    const event: AiTaskEvent = {
      source: normalizeAgentSource(args.agent),
      title: rawTitle,
      summary: typeof args.summary === 'string' ? args.summary : undefined,
      status: normalizeTaskStatus(args.status),
    };

    try {
      const outcome = await onNotifyToolCall(event);
      const message = outcome.sent
        ? `Email notification sent for "${event.title}".`
        : `Notification processed but not emailed (${outcome.reason ?? 'skipped'}).`;

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: message }],
        },
      };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `Failed to notify user: ${errMessage}` }],
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}
