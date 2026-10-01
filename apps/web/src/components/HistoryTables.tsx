import { useQuery } from '@tanstack/react-query';
import { Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';

import type { Deposit, Withdrawal, WithdrawalStatus } from '@aioption/shared';

import { api } from '../api/client';

const WITHDRAWAL_COLORS: Record<WithdrawalStatus, string> = {
  REQUESTED: 'orange',
  PENDING_FEE: 'volcano',
  APPROVED: 'blue',
  BROADCAST: 'geekblue',
  CONFIRMED: 'green',
  FAILED: 'red',
  DISABLED: 'default',
  SIMULATED: 'purple',
};

export function DepositHistoryTable() {
  const { data, isLoading } = useQuery({
    queryKey: ['deposits'],
    queryFn: api.deposits,
    refetchInterval: 5000,
  });

  const columns: TableProps<Deposit>['columns'] = [
    {
      title: 'Time',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    { title: 'Amount', dataIndex: 'amount', width: 120, render: (v: number) => `$${v.toFixed(2)}` },
    { title: 'Network', dataIndex: 'network', width: 90 },
    { title: 'Asset', dataIndex: 'asset', width: 90 },
    { title: 'Standard', dataIndex: 'tokenStandard', width: 90 },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (status: Deposit['status']) => (
        <Tag color={status === 'CONFIRMED' ? 'green' : 'orange'}>{status}</Tag>
      ),
    },
    {
      title: 'Tx',
      dataIndex: 'txid',
      ellipsis: true,
      render: (v: string | null) => (v ? `${v.slice(0, 14)}…` : '—'),
    },
  ];

  return (
    <Table<Deposit>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={data}
      loading={isLoading}
      pagination={false}
      scroll={{ x: true }}
    />
  );
}

export function WithdrawalHistoryTable() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['withdrawals'],
    queryFn: api.withdrawals,
    refetchInterval: 5000,
  });

  const columns: TableProps<Withdrawal>['columns'] = [
    {
      title: 'Time',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    { title: 'Amount', dataIndex: 'amount', width: 110, render: (v: number) => `$${v.toFixed(2)}` },
    { title: 'Network', dataIndex: 'network', width: 80 },
    { title: 'Asset', dataIndex: 'asset', width: 80 },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (status: WithdrawalStatus) => (
        <Tag color={WITHDRAWAL_COLORS[status]}>{status}</Tag>
      ),
    },
    {
      title: 'Destination',
      dataIndex: 'destinationAddress',
      ellipsis: true,
      render: (v: string) => `${v.slice(0, 10)}…${v.slice(-6)}`,
    },
    { title: 'Tx', dataIndex: 'txid', ellipsis: true, render: (v: string | null) => (v ? `${v.slice(0, 14)}…` : '—') },
  ];

  return (
    <div>
      {error ? (
        <Typography.Text type="danger">{(error as Error).message}</Typography.Text>
      ) : (
        <Table<Withdrawal>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={data}
          loading={isLoading}
          pagination={false}
          scroll={{ x: true }}
        />
      )}
    </div>
  );
}
