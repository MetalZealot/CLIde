import { useTranslation } from 'react-i18next';

import type { ChatMessage, PendingPermissionRequest } from '../../types/types';
import { buildClaudeToolPermissionEntry, formatToolInputForDisplay } from '../../utils/chatPermissions';
import { getClaudeSettings } from '../../utils/chatStorage';
import { getPermissionPanel, registerPermissionPanel } from '../../tools/configs/permissionPanelRegistry';
import { UserInputRequestPanel } from '../../tools/components/InteractiveRenderers';
import { Button } from '../../../../shared/view/ui';
import { describeOperation, waitingLabel } from '../../utils/toolActivity';

import OperationDetail from './OperationDetail';

registerPermissionPanel('AskUserQuestion', UserInputRequestPanel);
registerPermissionPanel('request_user_input', UserInputRequestPanel);

type Translate = ReturnType<typeof useTranslation>['t'];

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  codex: 'messageTypes.codex',
  cursor: 'messageTypes.cursor',
  opencode: 'messageTypes.opencode',
};

const approvalMessages = new WeakMap<PendingPermissionRequest, ChatMessage>();

/** The waiting call as a chat message, so its detail renders like any opened call. */
function approvalMessage(request: PendingPermissionRequest): ChatMessage {
  let message = approvalMessages.get(request);
  if (!message) {
    // Codex wraps a file-change approval's changes under `changes`.
    const input = request.toolName === 'FileChanges' && request.input && typeof request.input === 'object' && 'changes' in request.input
      ? (request.input as { changes?: unknown }).changes ?? {}
      : request.input;
    message = {
      id: request.requestId,
      type: 'assistant',
      content: '',
      isToolUse: true,
      toolId: request.toolId,
      toolName: request.toolName,
      toolInput: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
      toolResult: null,
      timestamp: new Date(),
    };
    approvalMessages.set(request, message);
  }
  return message;
}

function readReason(input: unknown): string {
  const reason = input && typeof input === 'object' ? (input as { reason?: unknown }).reason : null;
  return typeof reason === 'string' ? reason.trim() : '';
}

function approvalTitle(request: PendingPermissionRequest, message: ChatMessage, t: Translate): string {
  const provider = t(PROVIDER_LABEL_KEYS[request.provider ?? ''] ?? 'messageTypes.claude');
  if (request.requestType === 'permission_approval') return t('activity.approval.permissions', { provider });
  const operation = describeOperation(message);
  if (operation.kind === 'bash' && !operation.description) return t('activity.approval.command', { provider });
  const action = waitingLabel(operation, t);
  return t('activity.approval.ask', { provider, action: action.charAt(0).toLowerCase() + action.slice(1) });
}

interface PermissionRequestsBannerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: {
      requestType?: PendingPermissionRequest['requestType'];
      decision?: 'allow_once' | 'allow_session' | 'deny' | 'cancel';
      answers?: Record<string, string[]>;
      allow?: boolean;
      message?: string;
      rememberEntry?: string | null;
      updatedInput?: unknown;
      toolId?: string;
    },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
}

export default function PermissionRequestsBanner({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
}: PermissionRequestsBannerProps) {
  const { t } = useTranslation('chat');
  // Filter out plan tool requests — they are handled inline by PlanDisplay
  const filteredRequests = pendingPermissionRequests.filter(
    (r) => r.toolName !== 'ExitPlanMode' && r.toolName !== 'exit_plan_mode'
  );

  if (!filteredRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      {filteredRequests.map((request) => {
        const CustomPanel = getPermissionPanel(request.toolName);
        if (CustomPanel) {
          return (
            <CustomPanel
              key={request.requestId}
              request={request}
              onDecision={handlePermissionDecision}
            />
          );
        }

        const rawInput = formatToolInputForDisplay(request.input);
        const permissionEntry = request.provider === 'codex'
          ? null
          : buildClaudeToolPermissionEntry(request.toolName, rawInput);
        const settings = getClaudeSettings();
        const alreadyAllowed = permissionEntry ? settings.allowedTools.includes(permissionEntry) : false;
        const matchingRequestIds = permissionEntry
          ? filteredRequests
              .filter(
                (item) =>
                  buildClaudeToolPermissionEntry(item.toolName, formatToolInputForDisplay(item.input)) === permissionEntry,
              )
              .map((item) => item.requestId)
          : [request.requestId];
        const message = approvalMessage(request);
        const reason = readReason(request.input);

        return (
          <OperationDetail
            key={request.requestId}
            message={message}
            heading={(
              <>
                <div className="text-[13px] leading-5 text-foreground">{approvalTitle(request, message, t)}</div>
                {reason && <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{reason}</div>}
              </>
            )}
            footer={(
              <div className="mt-2 font-sans">
                {permissionEntry && (
                  <div className="mb-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {t('activity.approval.sessionCovers', { entry: permissionEntry })}
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => handlePermissionDecision(request.requestId, {
                      requestType: request.requestType,
                      decision: 'cancel',
                      allow: false,
                      message: 'User cancelled the request',
                    })}
                  >
                    {t('activity.approval.cancel')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handlePermissionDecision(request.requestId, {
                      requestType: request.requestType,
                      decision: 'deny',
                      allow: false,
                      message: 'User denied the request',
                    })}
                  >
                    {t('activity.approval.deny')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (permissionEntry && !alreadyAllowed) {
                        handleGrantToolPermission({ entry: permissionEntry, toolName: request.toolName });
                      }
                      handlePermissionDecision(matchingRequestIds, {
                        requestType: request.requestType,
                        decision: 'allow_session',
                        allow: true,
                        rememberEntry: permissionEntry,
                      });
                    }}
                  >
                    {alreadyAllowed ? t('activity.approval.allowSessionSaved') : t('activity.approval.allowSession')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handlePermissionDecision(request.requestId, {
                      requestType: request.requestType,
                      decision: 'allow_once',
                      allow: true,
                    })}
                  >
                    {t('activity.approval.allowOnce')}
                  </Button>
                </div>
              </div>
            )}
          />
        );
      })}
    </div>
  );
}
