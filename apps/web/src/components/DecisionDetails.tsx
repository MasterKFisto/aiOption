import { Alert, Descriptions, Drawer, Tag, Typography } from 'antd';

import type { AiDecision } from '@aioption/shared';

/** One-line human reason for a decision's outcome. */
export function decisionOutcome(decision: AiDecision): { label: string; color: string } {
  const f = decision.features;
  if (decision.executed) {
    return f?.rebalanceReason
      ? { label: `Executed ${f.finalSignal} (rebalance)`, color: 'cyan' }
      : { label: `Executed ${f?.finalSignal ?? ''}`.trim(), color: 'green' };
  }
  if (f?.rejectionReason) {
    return { label: `Blocked: ${f.rejectionReason}`, color: 'red' };
  }
  if (f?.filterReason) {
    return { label: `Blocked: ${f.filterReason}`, color: 'orange' };
  }
  return { label: 'Skipped', color: 'default' };
}

/** Full indicator snapshot of one AI decision. */
export function DecisionDrawer({ decision, onClose }: { decision: AiDecision | null; onClose: () => void }) {
  const f = decision?.features ?? null;
  return (
    <Drawer
      title={decision ? `AI decision #${decision.id}` : 'AI decision'}
      open={decision !== null}
      onClose={onClose}
      width={480}
    >
      {decision && (
        <>
          <Alert
            type={decision.executed ? 'success' : f?.rejectionReason ? 'error' : 'info'}
            showIcon
            message={decisionOutcome(decision).label}
            style={{ marginBottom: 16 }}
          />
          {f ? (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Final signal">
                <Tag>{f.finalSignal}</Tag> (momentum alone: {f.rawSignal})
              </Descriptions.Item>
              <Descriptions.Item label="Current price">{f.currentPrice.toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="Momentum">
                {f.momentumPercent.toFixed(3)}% over {f.momentumPeriod} candles
              </Descriptions.Item>
              <Descriptions.Item label={`RSI (${f.rsiPeriod})`}>
                {f.rsi === null ? 'n/a' : f.rsi.toFixed(2)} — <Tag>{f.regime}</Tag> oversold &lt;{' '}
                {f.rsiOversold}, overbought &gt; {f.rsiOverbought}
              </Descriptions.Item>
              <Descriptions.Item label="Volatility">
                {f.volatilityPercent.toFixed(1)}% (threshold {f.volatilityThreshold}%)
              </Descriptions.Item>
              <Descriptions.Item label="Consecutive PUT">{f.consecutivePutCount}</Descriptions.Item>
              <Descriptions.Item label="Consecutive CALL">{f.consecutiveCallCount}</Descriptions.Item>
              <Descriptions.Item label="Price data">
                <Tag color={f.marketSource === 'LIVE' ? 'green' : 'default'}>{f.marketSource ?? 'SIMULATED'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Rebalance">{f.rebalanceReason ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Strategy filter">{f.filterReason ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Risk rejection">{f.rejectionReason ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Confidence">{(decision.confidence * 100).toFixed(1)}%</Descriptions.Item>
            </Descriptions>
          ) : (
            <Typography.Text type="secondary">
              No indicator snapshot (decision recorded before Phase 6.5.2).
            </Typography.Text>
          )}
          <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            {decision.rationale}
          </Typography.Paragraph>
        </>
      )}
    </Drawer>
  );
}
