import { useQuery } from '@tanstack/react-query';
import { Segmented, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { useState } from 'react';

import type { Position } from '@aioption/shared';

import { api } from '../api/client';

type Filter = 'ALL' | 'OPEN' | 'CLOSED';

const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString() : '—';

export function PositionsPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const { data, isLoading, error } = useQuery({
    queryKey: ['positions', filter],
    queryFn: () => api.positions(filter === 'ALL' ? undefined : filter),
    refetchInterval: 5000,
  });

  const columns: TableProps<Position>['columns'] = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    { title: 'Instrument', dataIndex: 'symbol' },
    {
      title: 'Side',
      dataIndex: 'side',
      width: 90,
      render: (side: Position['side']) => (
        <Tag color={side === 'CALL' ? 'green' : 'orange'}>{side}</Tag>
      ),
    },
    { title: 'Strike', dataIndex: 'strikePrice', width: 110, render: (v: number) => v.toFixed(0) },
    { title: 'Expiry', dataIndex: 'expiry', width: 120 },
    {
      title: 'Expires at',
      dataIndex: 'expiresAt',
      width: 170,
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : '—'),
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
    { title: 'Qty', dataIndex: 'quantity', width: 90 },
    {
      title: 'Entry Premium',
      dataIndex: 'entryPremium',
      width: 120,
      render: (v: number) => `$${v.toFixed(2)}`,
    },
    {
      title: 'Exit Premium',
      dataIndex: 'exitPremium',
      width: 120,
      render: (v: number | null) => (v === null ? '—' : `$${v.toFixed(2)}`),
    },
    {
      title: 'Settlement',
      dataIndex: 'settlementStatus',
      width: 110,
      render: (v: string | null, record: Position) => (
        <>
          <Tag color={v === 'SETTLED' ? 'green' : v === 'REFUNDED' ? 'blue' : 'default'}>
            {v ?? '—'}
          </Tag>
          {record.settlementPrice !== null && record.settlementPrice !== undefined && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              @ {record.settlementPrice.toFixed(2)}
            </Typography.Text>
          )}
        </>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (status: Position['status']) => (
        <Tag color={status === 'OPEN' ? 'blue' : 'default'}>{status}</Tag>
      ),
    },
    {
      title: 'Realized PnL',
      dataIndex: 'realizedPnl',
      width: 120,
      render: (v: number | null) =>
        v === null ? '—' : <span style={{ color: v >= 0 ? '#3f8600' : '#cf1322' }}>${v.toFixed(2)}</span>,
    },
    { title: 'Opened', dataIndex: 'openedAt', render: formatDate },
    { title: 'Closed', dataIndex: 'closedAt', render: formatDate },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Positions
      </Typography.Title>
      <Segmented
        options={['ALL', 'OPEN', 'CLOSED']}
        value={filter}
        onChange={(value) => setFilter(value as Filter)}
        style={{ marginBottom: 16 }}
      />
      {error ? (
        <Typography.Text type="danger">{(error as Error).message}</Typography.Text>
      ) : (
        <Table<Position>
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
