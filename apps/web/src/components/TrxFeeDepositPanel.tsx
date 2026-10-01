import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, InputNumber, List, Space, Tag, Typography, message } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

import type { TrxFeeDeposit } from '@aioption/shared';

import { api } from '../api/client';

/**
 * TRX fee-wallet deposit panel: address + QR + reserve status + deposit
 * history + simulated deposit (paper/simulated mode only).
 */
export function TrxFeeDepositPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [amount, setAmount] = useState(100);

  const { data: info } = useQuery({
    queryKey: ['tron-fee-deposit-info'],
    queryFn: api.tronFeeDepositInfo,
    refetchInterval: 15000,
  });
  const { data: status } = useQuery({
    queryKey: ['tron-fee-status'],
    queryFn: api.tronFeeStatus,
    refetchInterval: 10000,
  });
  const { data: deposits } = useQuery({
    queryKey: ['tron-fee-deposits'],
    queryFn: api.tronFeeDeposits,
    refetchInterval: 10000,
  });

  const simulateMutation = useMutation({
    mutationFn: api.simulateTrxDeposit,
    onSuccess: () => {
      messageApi.success('Simulated TRX fee deposit credited');
      void queryClient.invalidateQueries({ queryKey: ['tron-fee-status'] });
      void queryClient.invalidateQueries({ queryKey: ['tron-fee-deposits'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet-records'] });
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const copyAddress = () => {
    if (info) {
      void navigator.clipboard.writeText(info.feeWalletAddress);
      messageApi.success('Fee wallet address copied');
    }
  };

  if (!info) {
    return (
      <Card title="TRX fee wallet" size="small">
        <Typography.Text type="secondary">Loading fee wallet…</Typography.Text>
      </Card>
    );
  }

  return (
    <Card
      title="TRX fee wallet"
      size="small"
      extra={
        <Button size="small" onClick={copyAddress}>
          Copy address
        </Button>
      }
    >
      {contextHolder}
      <Alert type="warning" showIcon message={info.warning} style={{ marginBottom: 12 }} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {!compact && (
          <div style={{ padding: 8, background: '#fff', border: '1px solid #eee' }}>
            <QRCodeSVG value={info.feeWalletAddress} size={128} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 280 }}>
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="Fee wallet address">
              <Typography.Text copyable={!compact}>{info.feeWalletAddress}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="Asset">TRX</Descriptions.Item>
            <Descriptions.Item label="Network">Tron</Descriptions.Item>
            <Descriptions.Item label="Purpose">network fee reserve</Descriptions.Item>
            <Descriptions.Item label="Required confirmations">
              {info.requiredConfirmations}
            </Descriptions.Item>
            {info.sameAddressAsDeposit && (
              <Descriptions.Item label="Note">
                TRX and USDC deposits use the same address.
              </Descriptions.Item>
            )}
          </Descriptions>
        </div>
      </div>

      {status && (
        <Descriptions size="small" column={3} style={{ marginTop: 12 }}>
          <Descriptions.Item label="TRX balance">
            <b>{status.trxBalance}</b>
          </Descriptions.Item>
          <Descriptions.Item label="Min reserve">{status.minTrxFeeReserve}</Descriptions.Item>
          <Descriptions.Item label="Withdrawals supported">
            {status.estimatedWithdrawalsSupported}
          </Descriptions.Item>
        </Descriptions>
      )}
      {status && !status.sufficientFeeReserve && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 8 }}
          message={`Insufficient TRX fee reserve. Fund the fee wallet with at least ${status.minTrxFeeReserve} TRX before withdrawing USDC.`}
        />
      )}

      <Space style={{ marginTop: 12 }}>
        <InputNumber min={1} value={amount} onChange={(value) => setAmount(value ?? 100)} addonAfter="TRX" />
        <Button
          type="primary"
          size="small"
          loading={simulateMutation.isPending}
          onClick={() => simulateMutation.mutate(amount)}
        >
          Simulate TRX fee deposit
        </Button>
      </Space>

      <div style={{ marginTop: 12 }}>
        <Typography.Text strong>Recent TRX fee deposits</Typography.Text>
        <List
          size="small"
          dataSource={deposits ?? []}
          locale={{ emptyText: 'No TRX fee deposits yet.' }}
          renderItem={(deposit: TrxFeeDeposit) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <>
                    +{deposit.amountTrx} TRX{' '}
                    <Tag color={deposit.status === 'CREDITED' ? 'green' : 'blue'}>{deposit.status}</Tag>
                  </>
                }
                description={`${new Date(deposit.createdAt).toLocaleString()} · ${deposit.txid ?? '—'}`}
              />
            </List.Item>
          )}
        />
      </div>
    </Card>
  );
}
