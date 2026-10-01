import { useQuery } from '@tanstack/react-query';
import { Card, List, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';

import type { AiDecision, Position, RiskEvent } from '@aioption/shared';

import { api } from '../api/client';

export function OpenPositionsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['positions', 'OPEN'],
    queryFn: () => api.positions('OPEN'),
    refetchInterval: 1000,
  });

  const columns: TableProps<Position>['columns'] = [
    { title: 'Instrument', dataIndex: 'symbol', ellipsis: true },
    { title: 'Side', dataIndex: 'side', width: 80, render: (v: Position['side']) => <Tag>{v}</Tag> },
    { title: 'Qty', dataIndex: 'quantity', width: 70 },
    {
      title: 'Stake',
      dataIndex: 'stakeUsd',
      width: 90,
      render: (v: number | undefined) => (v === undefined ? '—' : `$${v.toFixed(2)}`),
    },
    {
      title: 'Entry',
      dataIndex: 'entryPremium',
      width: 100,
      render: (v: number) => `$${v.toFixed(2)}`,
    },
    {
      title: 'Expires',
      dataIndex: 'expiresAt',
      width: 170,
      render: (v: string | null) => (v ? new Date(v).toLocaleTimeString() : '—'),
    },
    {
      title: 'Countdown',
      dataIndex: 'secondsRemaining',
      width: 100,
      render: (v: number | undefined) => {
        if (v === undefined) return '—';
        const m = Math.floor(v / 60);
        const s = v % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
      },
    },
    {
      title: 'Unrealized PnL',
      dataIndex: 'unrealizedPnl',
      width: 120,
      render: (v: number | undefined) =>
        v === undefined ? '—' : <span style={{ color: v >= 0 ? '#3f8600' : '#cf1322' }}>${v.toFixed(2)}</span>,
    },
    {
      title: 'Opened',
      dataIndex: 'openedAt',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString(),
    },
  ];

  return (
    <Card title={`Open positions (${data?.length ?? 0})`} size="small">
      <Table<Position>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={data}
        loading={isLoading}
        pagination={false}
        scroll={{ x: true }}
      />
    </Card>
  );
}

export function RecentDecisionsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['decisions'],
    queryFn: () => api.decisions(5),
    refetchInterval: 10000,
  });

  return (
    <Card title="Recent AI decisions" size="small">
      <List
        size="small"
        loading={isLoading}
        dataSource={data ?? []}
        renderItem={(d: AiDecision) => (
          <List.Item>
            <List.Item.Meta
              title={
                <>
                  <Tag
                    color={d.signal === 'BULLISH' ? 'green' : d.signal === 'BEARISH' ? 'red' : 'default'}
                  >
                    {d.signal}
                  </Tag>
                  {d.symbol}
                </>
              }
              description={`${(d.confidence * 100).toFixed(1)}% confidence · ${d.action} · ${
                d.executed ? 'executed' : 'skipped'
              }`}
            />
          </List.Item>
        )}
      />
    </Card>
  );
}

export function RiskEventsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['risk-events'],
    queryFn: () => api.riskEvents(5),
    refetchInterval: 10000,
  });

  return (
    <Card title="Recent risk events" size="small">
      {!data || data.length === 0 ? (
        <Typography.Text type="secondary">No risk events.</Typography.Text>
      ) : (
        <List
          size="small"
          loading={isLoading}
          dataSource={data}
          renderItem={(event: RiskEvent) => (
            <List.Item>
              <List.Item.Meta
                title={<Tag color="red">{event.type}</Tag>}
                description={`${new Date(event.triggeredAt).toLocaleString()} · ${event.message}`}
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}
