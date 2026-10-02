import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';

import type { Position } from '@aioption/shared';

import { api } from '../api/client';

const resultTag = (position: Position) => {
  if (position.settlementStatus === 'REFUNDED') {
    return <Tag color="blue">REFUND</Tag>;
  }
  const pnl = position.realizedPnl ?? 0;
  return pnl > 0 ? <Tag color="green">WIN</Tag> : pnl < 0 ? <Tag color="red">LOSE</Tag> : <Tag>FLAT</Tag>;
};

/** Recent settled / refunded Classic Options (Phase 6.5.1). */
export function SettledPositionsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['classic-history'],
    queryFn: () => api.classicHistory(20),
    refetchInterval: 5000,
  });

  const columns: TableProps<Position>['columns'] = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    { title: 'Side', dataIndex: 'side', width: 80, render: (v: Position['side']) => <Tag>{v}</Tag> },
    {
      title: 'Stake',
      dataIndex: 'stakeUsd',
      width: 90,
      render: (v: number | undefined) => (v === undefined ? '—' : `$${v.toFixed(2)}`),
    },
    {
      title: 'Duration',
      dataIndex: 'durationSeconds',
      width: 90,
      render: (v: number | null) => (v ? `${Math.round(v / 60)} min` : '—'),
    },
    { title: 'Strike', dataIndex: 'strikePrice', width: 110, render: (v: number) => v.toFixed(2) },
    {
      title: 'Settlement price',
      dataIndex: 'settlementPrice',
      width: 130,
      render: (v: number | null) => (v === null ? '—' : v.toFixed(2)),
    },
    { title: 'Result', key: 'result', width: 90, render: (_v, record) => resultTag(record) },
    {
      title: 'PnL',
      dataIndex: 'realizedPnl',
      width: 100,
      render: (v: number | null) =>
        v === null ? '—' : <span style={{ color: v >= 0 ? '#3f8600' : '#cf1322' }}>${v.toFixed(2)}</span>,
    },
    {
      title: 'Settled',
      dataIndex: 'settledAt',
      width: 170,
      render: (v: string | null, record: Position) => {
        const at = v ?? record.closedAt;
        return at ? new Date(at).toLocaleString() : '—';
      },
    },
    {
      title: 'Reason',
      dataIndex: 'settlementReason',
      ellipsis: true,
      render: (v: string | null) => <Typography.Text type="secondary">{v ?? '—'}</Typography.Text>,
    },
  ];

  return (
    <Card title="Recent settled positions" size="small">
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
