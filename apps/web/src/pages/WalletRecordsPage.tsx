import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Col,
  Descriptions,
  Drawer,
  Row,
  Segmented,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';

import type { WalletRecord } from '@aioption/shared';

import { api } from '../api/client';
import { AccountSummaryBar } from '../components/AccountSummaryBar';
import { TradeAddressPanel } from '../components/TradeAddressPanel';
import { TrxFeeDepositPanel } from '../components/TrxFeeDepositPanel';

type Filter = 'ALL' | 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE' | 'FEE' | 'REFUND' | 'FEE_DEPOSIT';

const KIND_COLORS: Record<string, string> = {
  DEPOSIT: 'green',
  WITHDRAWAL: 'blue',
  TRADE: 'purple',
  FEE: 'orange',
  REFUND: 'cyan',
  FEE_DEPOSIT: 'geekblue',
};

const statusTag = (record: WalletRecord) => (
  <Tag color={record.status === 'FAILED' ? 'red' : record.status === 'RECORDED' ? 'default' : 'blue'}>
    {record.status}
  </Tag>
);

/** Unified wallet records: deposits, withdrawals, trades, fees, refunds. */
export function WalletRecordsPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [detail, setDetail] = useState<WalletRecord | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['wallet-records', filter],
    queryFn: () => api.walletRecords(filter, 100, 0),
    refetchInterval: 5000,
  });

  const summary = data?.summary;
  const records = data?.records ?? [];

  return (
    <div>
      <AccountSummaryBar />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <TradeAddressPanel />
        </Col>
        <Col xs={24} xl={12}>
          <TrxFeeDepositPanel />
        </Col>
      </Row>
      <div style={{ marginTop: 16 }}>
        <Card title="Wallet records" size="small">
        {summary && (
          <Row gutter={8} style={{ marginBottom: 12 }}>
            <Col span={4}>
              <Statistic title="Available" value={summary.availableBalance} precision={2} prefix="$" valueStyle={{ fontSize: 16 }} />
            </Col>
            <Col span={4}>
              <Statistic title="Locked" value={summary.lockedBalance} precision={2} prefix="$" valueStyle={{ fontSize: 16 }} />
            </Col>
            <Col span={4}>
              <Statistic title="Total equity" value={summary.totalEquity} precision={2} prefix="$" valueStyle={{ fontSize: 16 }} />
            </Col>
            <Col span={4}>
              <Statistic title="Pending withdrawals" value={summary.pendingWithdrawals} precision={2} prefix="$" valueStyle={{ fontSize: 16 }} />
            </Col>
            <Col span={4}>
              <Statistic title="Pending deposits" value={summary.pendingDeposits} precision={2} prefix="$" valueStyle={{ fontSize: 16 }} />
            </Col>
            <Col span={4}>
              <Statistic
                title="Hot wallet TRX"
                value={summary.hotWalletTrxBalance}
                valueStyle={{ fontSize: 16, color: summary.feeResourcesSufficient ? '#3f8600' : '#cf1322' }}
                suffix={summary.feeResourcesSufficient ? '' : ' ⚠'}
              />
            </Col>
          </Row>
        )}
        <Segmented
          style={{ marginBottom: 12 }}
          options={[
            { label: 'All', value: 'ALL' },
            { label: 'Deposits', value: 'DEPOSIT' },
            { label: 'Withdrawals', value: 'WITHDRAWAL' },
            { label: 'Trades', value: 'TRADE' },
            { label: 'Fees', value: 'FEE' },
            { label: 'Refunds', value: 'REFUND' },
            { label: 'TRX Fee', value: 'FEE_DEPOSIT' },
          ]}
          value={filter}
          onChange={(value) => setFilter(value as Filter)}
        />
        <Table<WalletRecord>
          size="small"
          rowKey="id"
          loading={isLoading}
          dataSource={records}
          pagination={{ pageSize: 20 }}
          scroll={{ x: true }}
          onRow={(record) => ({ onClick: () => setDetail(record), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Time', dataIndex: 'time', width: 90, render: (v: string) => new Date(v).toLocaleTimeString() },
            {
              title: 'Type',
              dataIndex: 'type',
              width: 150,
              render: (value: string, record: WalletRecord) => (
                <>
                  <Tag color={KIND_COLORS[record.kind] ?? 'default'}>{record.kind}</Tag>
                  {value}
                </>
              ),
            },
            {
              title: 'Amount',
              dataIndex: 'amount',
              width: 100,
              render: (value: number) => (
                <span style={{ color: value >= 0 ? '#3f8600' : '#cf1322' }}>
                  {value >= 0 ? '+' : ''}
                  {value.toFixed(2)}
                </span>
              ),
            },
            { title: 'Asset', dataIndex: 'asset', width: 70 },
            { title: 'Network', dataIndex: 'network', width: 80, render: (v: string | null) => v ?? '—' },
            { title: 'Status', dataIndex: 'status', width: 110, render: (_v: string, record: WalletRecord) => statusTag(record) },
            {
              title: 'Txid',
              dataIndex: 'txid',
              ellipsis: true,
              render: (value: string | null, record: WalletRecord) =>
                value ? (
                  record.explorerUrl ? (
                    <a href={record.explorerUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      {value.slice(0, 14)}…
                    </a>
                  ) : (
                    <Typography.Text>{value.slice(0, 14)}…</Typography.Text>
                  )
                ) : (
                  '—'
                ),
            },
            {
              title: 'Fee (TRX/USD)',
              width: 110,
              render: (_v: unknown, record: WalletRecord) =>
                record.feeEstimateTrx === null ? '—' : `${record.feeEstimateTrx} / $${(record.feeEstimateUsd ?? 0).toFixed(2)}`,
            },
            {
              title: 'Notes',
              dataIndex: 'notes',
              ellipsis: true,
              render: (value: string | null) => value ?? '—',
            },
          ]}
        />
      </Card>
      </div>

      <Drawer title="Wallet record" open={detail !== null} onClose={() => setDetail(null)} width={480}>
        {detail && (
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="ID">{detail.id}</Descriptions.Item>
            <Descriptions.Item label="Time">{new Date(detail.time).toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="Kind">{detail.kind}</Descriptions.Item>
            <Descriptions.Item label="Type">{detail.type}</Descriptions.Item>
            <Descriptions.Item label="Amount">
              {detail.amount >= 0 ? '+' : ''}
              {detail.amount.toFixed(2)} {detail.asset}
            </Descriptions.Item>
            <Descriptions.Item label="Network">{detail.network ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Status">{detail.status}</Descriptions.Item>
            <Descriptions.Item label="Reference">{detail.reference ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Txid">
              {detail.txid ? (
                detail.explorerUrl ? (
                  <a href={detail.explorerUrl} target="_blank" rel="noreferrer">
                    {detail.txid}
                  </a>
                ) : (
                  detail.txid
                )
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Destination">{detail.destinationAddress ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Deposit address">{detail.depositAddress ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Fee estimate (TRX)">
              {detail.feeEstimateTrx === null ? '—' : detail.feeEstimateTrx}
            </Descriptions.Item>
            <Descriptions.Item label="Fee estimate (USD)">
              {detail.feeEstimateUsd === null ? '—' : `$${detail.feeEstimateUsd.toFixed(2)}`}
            </Descriptions.Item>
            <Descriptions.Item label="Fee paid by">{detail.feePaidBy ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Notes">{detail.notes ?? '—'}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
