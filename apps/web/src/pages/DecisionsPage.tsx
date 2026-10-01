import { useQuery } from '@tanstack/react-query';
import { Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';

import type { AiDecision, MarketSignal } from '@aioption/shared';

import { api } from '../api/client';

const SIGNAL_COLORS: Record<MarketSignal, string> = {
  BULLISH: 'green',
  BEARISH: 'red',
  NEUTRAL: 'default',
};

export function DecisionsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['decisions'],
    queryFn: () => api.decisions(100),
    refetchInterval: 10000,
  });

  const columns: TableProps<AiDecision>['columns'] = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    {
      title: 'Time',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    { title: 'Symbol', dataIndex: 'symbol', width: 110 },
    {
      title: 'Signal',
      dataIndex: 'signal',
      width: 110,
      render: (signal: MarketSignal) => <Tag color={SIGNAL_COLORS[signal]}>{signal}</Tag>,
    },
    { title: 'Action', dataIndex: 'action', width: 120 },
    {
      title: 'Confidence',
      dataIndex: 'confidence',
      width: 120,
      render: (v: number) => `${(v * 100).toFixed(1)}%`,
    },
    {
      title: 'Expected Return',
      dataIndex: 'expectedReturn',
      width: 140,
      render: (v: number) => `${(v * 100).toFixed(2)}%`,
    },
    {
      title: 'Proposed Size',
      dataIndex: 'proposedTradeSizeUsd',
      width: 120,
      render: (v: number) => `$${v.toFixed(2)}`,
    },
    {
      title: 'Approval',
      dataIndex: 'executed',
      width: 110,
      render: (executed: boolean) =>
        executed ? <Tag color="green">executed</Tag> : <Tag>skipped</Tag>,
    },
    {
      title: 'Position',
      dataIndex: 'positionId',
      width: 90,
      render: (v: number | null) => (v === null ? '—' : `#${v}`),
    },
    { title: 'Rationale', dataIndex: 'rationale', ellipsis: true },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        AI Decisions
      </Typography.Title>
      {error ? (
        <Typography.Text type="danger">{(error as Error).message}</Typography.Text>
      ) : (
        <Table<AiDecision>
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: true }}
        />
      )}
    </div>
  );
}
