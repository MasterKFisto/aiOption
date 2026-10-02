import { useQuery } from '@tanstack/react-query';
import { Card, List, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { useEffect, useState } from 'react';

import type { AiDecision, Position, RiskEvent } from '@aioption/shared';

import { api } from '../api/client';

/** Seconds until an ISO expiry, recomputed on the client every second. */
export function formatCountdown(expiresAt: string | null, nowMs: number): string {
  if (!expiresAt) {
    return '—';
  }
  const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - nowMs) / 1000));
  if (remaining === 0) {
    return 'settling…';
  }
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function OpenPositionsPanel() {
  const nowMs = useNow();
  const { data, isLoading } = useQuery({
    queryKey: ['positions', 'OPEN'],
    queryFn: () => api.positions('OPEN'),
    refetchInterval: 2000,
  });

  const columns: TableProps<Position>['columns'] = [
    { title: 'Instrument', dataIndex: 'symbol', ellipsis: true },
    { title: 'Side', dataIndex: 'side', width: 80, render: (v: Position['side']) => <Tag>{v}</Tag> },
    {
      title: 'Stake (locked)',
      dataIndex: 'stakeUsd',
      width: 110,
      render: (v: number | undefined) => (v === undefined ? '—' : `$${v.toFixed(2)}`),
    },
    {
      title: 'Strike',
      dataIndex: 'strikePrice',
      width: 100,
      render: (v: number) => v.toFixed(2),
    },
    {
      title: 'Duration',
      dataIndex: 'durationSeconds',
      width: 90,
      render: (v: number | null) => (v ? `${Math.round(v / 60)} min` : '—'),
    },
    {
      title: 'Expires',
      dataIndex: 'expiresAt',
      width: 120,
      render: (v: string | null) => (v ? new Date(v).toLocaleTimeString() : '—'),
    },
    {
      title: 'Countdown',
      dataIndex: 'expiresAt',
      key: 'countdown',
      width: 110,
      render: (v: string | null) => formatCountdown(v, nowMs),
    },
    {
      title: 'Source',
      dataIndex: 'source',
      width: 80,
      render: (v: string) => <Tag color={v === 'AI' ? 'purple' : 'default'}>{v}</Tag>,
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
