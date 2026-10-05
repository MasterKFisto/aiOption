import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Input, Space, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';

import type { TokenContractSource } from '@aioption/shared';

import { api } from '../api/client';

const SOURCE_LABEL: Record<TokenContractSource, { label: string; color: string }> = {
  DATABASE: { label: 'Database', color: 'blue' },
  ENVIRONMENT: { label: 'Environment', color: 'purple' },
  NOT_SET: { label: 'Not Set', color: 'red' },
};

/**
 * Phase 7.4: "USDT Token Connection" panel — shows the configured TRC20 token
 * contract, the on-chain metadata (name/symbol/decimals), the token balances of
 * the deposit and hot wallet addresses (distinct from the TRX balance), and a
 * manual "Test Token Connection" refresh. The contract address can be saved
 * from the UI (DB overrides the env default; the change is audit-logged).
 * Never displays private keys.
 */
export function TokenConnectionPanel({ active = true }: { active?: boolean }) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [draft, setDraft] = useState<string | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ['tron-token-status'],
    queryFn: api.tronTokenStatus,
    enabled: active,
  });

  // Keep the editor in sync with the effective value until the user edits it.
  useEffect(() => {
    if (draft === null && data) {
      setDraft(data.tokenContractAddress);
    }
  }, [data, draft]);

  const testMutation = useMutation({
    mutationFn: api.testTronTokenConnection,
    onSuccess: (status) => {
      queryClient.setQueryData(['tron-token-status'], status);
      if (status.tokenConnected) {
        messageApi.success(`Token connected: ${status.tokenSymbol ?? 'unknown symbol'}`);
      } else {
        messageApi.warning('Token connection failed — see errors below');
      }
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const saveMutation = useMutation({
    mutationFn: api.saveTronTokenContract,
    onSuccess: (status) => {
      queryClient.setQueryData(['tron-token-status'], status);
      messageApi.success('USDT token contract saved');
      void queryClient.invalidateQueries({ queryKey: ['tron-status'] });
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const status = data && typeof data === 'object' && !Array.isArray(data) ? data : null;

  return (
    <Card size="small" title="USDT Token Connection" data-testid="token-connection-panel">
      {contextHolder}
      {isLoading && !status ? null : error || !status ? (
        <Alert type="error" showIcon message={(error as Error)?.message ?? 'token status unavailable'} />
      ) : (
        <>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Network">{status.networkName}</Descriptions.Item>
            {status.rpcUrl && <Descriptions.Item label="RPC URL">{status.rpcUrl}</Descriptions.Item>}
            <Descriptions.Item label="Deposit address">
              <Typography.Text style={{ wordBreak: 'break-all' }}>{status.depositAddress || '—'}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="Hot wallet address">
              <Typography.Text style={{ wordBreak: 'break-all' }}>
                {status.hotWalletAddress || 'not configured'}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="Token contract">
              <Typography.Text style={{ wordBreak: 'break-all' }} data-testid="token-contract-address">
                {status.tokenContractAddress || 'not configured'}
              </Typography.Text>{' '}
              <Tag color={SOURCE_LABEL[status.tokenContractSource].color}>
                {SOURCE_LABEL[status.tokenContractSource].label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Token name">{status.tokenName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Token symbol">{status.tokenSymbol ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Token decimals">{status.tokenDecimals ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Deposit token balance">
              {status.depositTokenBalance ?? '—'} {status.tokenSymbol ?? ''}
            </Descriptions.Item>
            <Descriptions.Item label="Hot wallet token balance">
              {status.hotWalletTokenBalance ?? '—'} {status.tokenSymbol ?? ''}
            </Descriptions.Item>
            <Descriptions.Item label="Hot wallet TRX balance">
              {status.hotWalletTrxBalance ?? '—'} TRX
            </Descriptions.Item>
            <Descriptions.Item label="Token connection">
              <Tag
                data-testid="token-connection-status"
                color={status.tokenConnected ? 'green' : status.tokenConfigured ? 'orange' : 'red'}
              >
                {status.tokenConnected ? 'CONNECTED' : status.tokenConfigured ? 'NOT CONNECTED' : 'NOT CONFIGURED'}
              </Tag>
              {status.simulated && <Tag color="default">simulated</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Last checked">
              {status.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleString() : 'never'}
            </Descriptions.Item>
          </Descriptions>

          {status.errors.map((code) => (
            <Alert key={code} type="error" showIcon message={code} style={{ marginTop: 8 }} data-testid="token-error" />
          ))}
          {status.warnings.map((warning) => (
            <Alert key={warning} type="warning" showIcon message={warning} style={{ marginTop: 8 }} data-testid="token-warning" />
          ))}

          <div style={{ marginTop: 12 }}>
            <Typography.Text strong>USDT Token Contract Address</Typography.Text>
            <Space.Compact style={{ width: '100%', marginTop: 4 }}>
              <Input
                value={draft ?? ''}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="T… (Nile test token contract)"
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                data-testid="token-contract-input"
              />
              <Button
                onClick={() => saveMutation.mutate((draft ?? '').trim())}
                loading={saveMutation.isPending}
              >
                Save
              </Button>
            </Space.Compact>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
              Saved to the database (overrides the environment default); empty restores the
              environment value. The change is recorded in the settings audit log.
            </Typography.Paragraph>
          </div>

          <Button
            type="primary"
            onClick={() => testMutation.mutate()}
            loading={testMutation.isPending}
            style={{ marginTop: 8 }}
            data-testid="test-token-connection"
          >
            Test Token Connection
          </Button>
        </>
      )}
    </Card>
  );
}