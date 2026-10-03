import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, InputNumber, Modal, Spin, Typography, message } from 'antd';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

import {
  BASE_CURRENCY_LABEL,
  TESTNET_ASSET_NOTICE,
  TRON_DEPOSIT_WARNING,
} from '@aioption/shared';

import { api } from '../api/client';
import { DepositHistoryTable } from './HistoryTables';

/**
 * Tron USDT (TRC20) deposit flow. The network is fixed — the user cannot
 * select anything else. In paper/simulated mode a "Simulate Tron USDT
 * deposit" button is available for testing.
 */
export function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [simulateAmount, setSimulateAmount] = useState<number>(100);

  const { data: info, isPending, error } = useQuery({
    queryKey: ['deposits-info'],
    queryFn: api.depositsInfo,
    enabled: open,
  });

  const simulateMutation = useMutation({
    mutationFn: api.simulateDeposit,
    onSuccess: (result) => {
      messageApi.success(`Simulated deposit of $${result.deposit?.amount} credited`);
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
      void queryClient.invalidateQueries({ queryKey: ['deposits'] });
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['deposits'] });
    void queryClient.invalidateQueries({ queryKey: ['deposits-info'] });
    messageApi.info('Deposits refreshed');
  };

  const paperMode = !info || info.tronMode === 'SIMULATED';
  const testnet = info?.tronMode === 'SHASTA' || info?.tronMode === 'NILE';

  return (
    <Modal title={`Deposit ${BASE_CURRENCY_LABEL}`} open={open} onCancel={onClose} footer={null} width={560}>
      {contextHolder}
      {isPending || !info ? (
        <Spin />
      ) : error ? (
        <Alert type="error" message={(error as Error).message} />
      ) : (
        <>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Asset">{BASE_CURRENCY_LABEL}</Descriptions.Item>
            <Descriptions.Item label="Network">Tron (fixed)</Descriptions.Item>
            <Descriptions.Item label="Token standard">TRC20</Descriptions.Item>
            <Descriptions.Item label="Deposit address">
              <Typography.Text copyable>{info.address}</Typography.Text>
              {info.addressSource === 'SIMULATED' && (
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  Simulated placeholder — set your own address under Classic Options → {BASE_CURRENCY_LABEL} Tron trade address.
                </Typography.Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Min confirmations">
              {info.requiredConfirmations}
            </Descriptions.Item>
          </Descriptions>
          <div style={{ textAlign: 'center', padding: 16 }}>
            <QRCodeSVG value={info.address} size={180} />
          </div>
          <Alert
            type="warning"
            showIcon
            message={TRON_DEPOSIT_WARNING}
            style={{ marginBottom: 16 }}
          />
          {testnet && (
            <Alert
              type="info"
              showIcon
              data-testid="testnet-asset-notice"
              message={TESTNET_ASSET_NOTICE}
              style={{ marginBottom: 16 }}
            />
          )}

          {paperMode && (
            <Card size="small" title={`Simulate Tron ${BASE_CURRENCY_LABEL} deposit (testing)`} style={{ marginBottom: 16 }}>
              <InputNumber
                min={0.01}
                value={simulateAmount}
                onChange={(v) => setSimulateAmount(Number(v))}
                style={{ marginRight: 8 }}
              />
              <Button
                type="primary"
                loading={simulateMutation.isPending}
                onClick={() => simulateMutation.mutate(simulateAmount)}
              >
                Simulate Tron {BASE_CURRENCY_LABEL} deposit
              </Button>
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                Simulated deposits are recorded as network=TRON, asset={BASE_CURRENCY_LABEL}, TRC20.
              </Typography.Paragraph>
            </Card>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              Recent deposits
            </Typography.Title>
            <Button onClick={refresh}>Refresh deposits</Button>
          </div>
          <DepositHistoryTable />
        </>
      )}
    </Modal>
  );
}
