import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, InputNumber, Modal, Spin, Typography, message } from 'antd';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

import { api } from '../api/client';
import { DepositHistoryTable } from './HistoryTables';

/**
 * Tron USDC (TRC20) deposit flow. The network is fixed — the user cannot
 * select anything else. In paper/simulated mode a "Simulate Tron USDC
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

  return (
    <Modal title="Deposit USDC" open={open} onCancel={onClose} footer={null} width={560}>
      {contextHolder}
      {isPending || !info ? (
        <Spin />
      ) : error ? (
        <Alert type="error" message={(error as Error).message} />
      ) : (
        <>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Asset">USDC</Descriptions.Item>
            <Descriptions.Item label="Network">Tron (fixed)</Descriptions.Item>
            <Descriptions.Item label="Token standard">TRC20</Descriptions.Item>
            <Descriptions.Item label="Deposit address">
              <Typography.Text copyable>{info.address}</Typography.Text>
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
            message="Only send USDC on the Tron network (TRC20) to this address."
            description="Deposits sent on any other network or token standard may be permanently lost."
            style={{ marginBottom: 16 }}
          />

          {paperMode && (
            <Card size="small" title="Simulate Tron USDC deposit (testing)" style={{ marginBottom: 16 }}>
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
                Simulate Tron USDC deposit
              </Button>
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                Simulated deposits are recorded as network=TRON, asset=USDC, TRC20.
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
