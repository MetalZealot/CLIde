import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';
import { usePermission } from '../../../../contexts/PermissionContext';
import { DetailPanel } from '../../view/subcomponents/DetailPanel';
import { DisclosureRow } from '../../view/subcomponents/DisclosureRow';

import { MarkdownContent } from './ContentRenderers';

interface PlanDisplayProps {
  content: string;
  /** No result yet: the plan may still be waiting for a decision. */
  isStreaming?: boolean;
  toolId?: string;
}

// Full-contrast prose: a plan is read to be approved, not skimmed like thinking.
const PLAN_TEXT_CLASS = 'prose prose-sm max-w-none font-prose text-[13px] leading-5 dark:prose-invert prose-headings:mb-1 prose-headings:mt-3 prose-headings:text-[13px] prose-headings:font-semibold [&>*:first-child]:mt-0 [&>*:first-child]:pr-6';

/** A proposed plan as one row; it stays open with Build and Revise while it waits for a decision. */
export const PlanDisplay: React.FC<PlanDisplayProps> = ({ content, isStreaming = false, toolId }) => {
  const { t } = useTranslation('chat');
  const permissionCtx = usePermission();

  const pendingRequest = isStreaming
    ? permissionCtx?.pendingPermissionRequests.find(
      (r) => (r.toolName === 'ExitPlanMode' || r.toolName === 'exit_plan_mode') && (!r.toolId || !toolId || r.toolId === toolId),
    )
    : undefined;
  const isPending = Boolean(pendingRequest && permissionCtx);
  const [isOpen, setIsOpen] = useState(isPending);

  useEffect(() => {
    if (isPending) setIsOpen(true);
  }, [isPending]);

  const decide = (allow: boolean) => {
    if (!pendingRequest || !permissionCtx) return;
    permissionCtx.handlePermissionDecision(
      pendingRequest.requestId,
      allow ? { allow: true } : { allow: false, message: 'User asked to revise the plan' },
    );
  };

  return (
    <div>
      <DisclosureRow label={t('activity.plan.proposed')} isOpen={isOpen} onToggle={() => setIsOpen((current) => !current)} />
      {isOpen && (
        <DetailPanel copyText={content}>
          {content
            ? <MarkdownContent content={content} className={PLAN_TEXT_CLASS} />
            : <div className="text-[13px] text-muted-foreground">{t('activity.detail.empty')}</div>}
        </DetailPanel>
      )}
      {isPending && (
        <div className="mb-1 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => decide(false)} className="text-muted-foreground">
            {t('activity.plan.revise')}
          </Button>
          <Button size="sm" onClick={() => decide(true)}>{t('activity.plan.build')}</Button>
        </div>
      )}
    </div>
  );
};
