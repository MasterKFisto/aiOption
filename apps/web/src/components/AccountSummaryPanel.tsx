import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Tag, Typography } from 'antd';

import { api } from '../api/client';

const money = (value: number) =>
  value >= 0
    ? { color: '#3f8600', prefix: '$' }
    : { color: '#cf1322', prefix: '-$' };

/** Account summary: equity, balances, PnL, loss-limit floor, daily loss remaining. */
export function AccountSummaryPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['summary'],
    queryFn: api.summary,
    refetchInterval: 3000, // polling fallback; SSE invalidates on change
  });

  if (isLoading) {
    return <Card title="Account">Loading…</Card>;
  }
  if (error || !data) {
    return (
      <Card title="Account">
        <Typography.Text type="danger">{(error as Error).message}</Typography.Text>
      </Card>
    );
  }

  const { account } = data;
  const lossFloor =
    account.startingEquity > 0
      ? account.startingEquity * (1 - account.lossLimitPercent / 100)
      : null;
  const dailyLossRemaining =
    lossFloor !== null ? Math.max(account.equity - lossFloor, 0) : null;
  const absRealized = Math.abs(data.realizedPnl);
  const absUnrealized = Math.abs(data.unrealizedPnl);

  return (
    <Card
      title="Account"
      extra={
        <>
          <Tag color={data.loopRunning ? 'green' : 'red'}>
            {data.loopRunning ? 'RUNNING' : 'STOPPED'}
          </Tag>
          <Tag>{account.mode}</Tag>
        </>
      }
    >
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={8}>
          <Statistic title="Total equity" value={account.equity} precision={2} prefix="$" />
        </Col>
        <Col xs={12} lg={8}>
          <Statistic title="Available balance" value={account.cashBalance} precision={2} prefix="$" />
        </Col>
        <Col xs={12} lg={8}>
          <Statistic title="Locked balance" value={account.lockedBalance} precision={2} prefix="$" />
        </Col>
        <Col xs={12} lg={8}>
          <Statistic
            title="Unrealized PnL"
            value={absUnrealized}
            precision={2}
            valueStyle={money(data.unrealizedPnl)}
            prefix={money(data.unrealizedPnl).prefix}
          />
        </Col>
        <Col xs={12} lg={8}>
          <Statistic
            title="Realized PnL"
            value={absRealized}
            precision={2}
            valueStyle={money(data.realizedPnl)}
            prefix={money(data.realizedPnl).prefix}
          />
        </Col>
        <Col xs={12} lg={8}>
          <Statistic
            title="Loss-limit floor"
            value={lossFloor ?? '—'}
            {...(lossFloor !== null ? { precision: 2, prefix: '$' } : {})}
          />
        </Col>
        <Col xs={12} lg={8}>
          <Statistic
            title="Daily loss remaining"
            value={dailyLossRemaining ?? '—'}
            {...(dailyLossRemaining !== null ? { precision: 2, prefix: '$' } : {})}
          />
        </Col>
        <Col xs={24}>
          <Typography.Text type="secondary">
            Last updated: {new Date(account.updatedAt).toLocaleTimeString()}
          </Typography.Text>
        </Col>
      </Row>
    </Card>
  );
}
