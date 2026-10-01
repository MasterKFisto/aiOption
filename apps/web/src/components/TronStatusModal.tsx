import { useQuery } from '@tanstack/react-query';
import { Alert, Descriptions, Modal, Spin, Tag } from 'antd';

import type { TronStatus } from '@aioption/shared';

import { api } from '../api/client';
import { TrxFeeDepositPanel } from './TrxFeeDepositPanel';

const CONNECTION_COLORS: Record<TronStatus['connectionStatus'], string> = {
  CONNECTED: 'green',
  DEGRADED: 'orange',
  DISCONNECTED: 'red',
  NOT_CONFIGURED: 'red',
};

/** Detailed Tron network status panel (opened from the sidebar indicator). */
export function TronStatusModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tron-status'],
    queryFn: api.tronStatus,
    refetchInterval: 15000,
    enabled: open,
  });

  const status =
    data && typeof data === 'object' && !Array.isArray(data) ? data : null;

  return (
    <Modal title="Tron network status" open={open} onCancel={onClose} footer={null} width={560}>
      {isLoading ? (
        <Spin />
      ) : error || !status ? (
        <Alert type="error" showIcon message={(error as Error)?.message ?? 'unavailable'} />
      ) : (
        <>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Network">
              {status.networkName}{' '}
              <Tag color={status.mode === 'SIMULATED' ? 'default' : 'blue'}>{status.mode}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Connection">
              <Tag color={CONNECTION_COLORS[status.connectionStatus]}>
                {status.connectionStatus}
              </Tag>{' '}
                <Tag
                  color={
                    status.readiness === 'READY_TO_TRADE'
                      ? 'green'
                      : status.readiness === 'FEE_RESOURCE_LOW'
                        ? 'orange'
                        : 'red'
                  }
                >
                  {(status.readiness ?? '').replaceAll('_', ' ')}
                </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Last check">
              {status.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleString() : 'never'}
            </Descriptions.Item>
            <Descriptions.Item label="Deposit address">{status.depositAddress || '—'}</Descriptions.Item>
            <Descriptions.Item label="Hot wallet">
              {status.hotWalletAddress || 'not configured'}
            </Descriptions.Item>
            <Descriptions.Item label="USDC contract">
              {status.usdcContractAddress || 'not configured'}
            </Descriptions.Item>
            <Descriptions.Item label="Required confirmations">
              {status.requiredConfirmations}
            </Descriptions.Item>
            <Descriptions.Item label="TRX balance">{status.trxBalance}</Descriptions.Item>
            <Descriptions.Item label="Energy available">{status.energyAvailable}</Descriptions.Item>
            <Descriptions.Item label="Bandwidth available">{status.bandwidthAvailable}</Descriptions.Item>
            <Descriptions.Item label="Deposits enabled">
              {status.depositsEnabled ? 'Yes' : 'No'}
            </Descriptions.Item>
            <Descriptions.Item label="Withdrawals enabled">
              {status.withdrawalsEnabled ? 'Yes' : 'No'}
            </Descriptions.Item>
            <Descriptions.Item label="Live withdrawals">
              {status.liveWithdrawalsEnabled ? 'Yes' : 'No'}
            </Descriptions.Item>
          </Descriptions>
          {status.warnings.map((warning) => (
            <Alert
              key={warning}
              type={status.lowFeeResource ? 'warning' : 'info'}
              showIcon
              message={warning}
              style={{ marginTop: 8 }}
            />
          ))}
          <div style={{ marginTop: 16 }}>
            <TrxFeeDepositPanel compact />
          </div>
        </>
      )}
    </Modal>
  );
}
