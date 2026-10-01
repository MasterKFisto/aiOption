import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, InputNumber, Row, Space, Statistic, Switch, message } from 'antd';
import { useEffect, useState } from 'react';

import type { BinarySessionSettingsUpdate } from '@aioption/shared';

import { api } from '../api/client';
import { emitUiEvent } from '../api/events';

/**
 * Binary session gain limit panel: enable/limits/current gain/reset.
 * Shows the blocking banner when the session gain limit is reached.
 */
export function BinarySessionGainPanel() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const { data: stats } = useQuery({
    queryKey: ['binary-session'],
    queryFn: api.binarySessionStats,
    refetchInterval: 2000,
  });

  const [enabled, setEnabled] = useState(true);
  const [maxUsdc, setMaxUsdc] = useState(50);
  const [maxPercent, setMaxPercent] = useState(0);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (stats && !seeded) {
      setEnabled(stats.gainLimitEnabled);
      setMaxUsdc(stats.maxSessionGainUsdc || 50);
      setMaxPercent(stats.maxSessionGainPercent);
      setSeeded(true);
    }
  }, [stats, seeded]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['binary-session'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  const saveMutation = useMutation({
    mutationFn: api.binarySessionSettings,
    onSuccess: () => {
      messageApi.success('Binary session gain settings saved');
      refresh();
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const resetMutation = useMutation({
    mutationFn: api.binarySessionReset,
    onSuccess: () => {
      messageApi.success('Binary session reset');
      refresh();
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const save = () => {
    const patch: BinarySessionSettingsUpdate = {
      gainLimitEnabled: enabled,
      maxSessionGainUsdc: maxUsdc,
      maxSessionGainPercent: maxPercent,
    };
    saveMutation.mutate(patch);
  };

  const reached = stats?.gainLimitReached ?? false;

  return (
    <Card title="Binary Max Session Gain" size="small">
      {contextHolder}
      {reached && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Binary session gain limit reached. New binary trades are blocked. You may reset the session, keep funds in the wallet, or withdraw."
        />
      )}
      <Row gutter={[8, 8]}>
        <Col span={24}>
          <Space>
            <Switch checked={enabled} onChange={setEnabled} />
            <span>Enable session gain limit</span>
          </Space>
        </Col>
        <Col span={12}>
          <div style={{ fontSize: 12, color: '#888' }}>Max session gain (USDC)</div>
          <InputNumber min={1} value={maxUsdc} onChange={(value) => setMaxUsdc(value ?? 50)} style={{ width: '100%' }} />
        </Col>
        <Col span={12}>
          <div style={{ fontSize: 12, color: '#888' }}>Max gain % of equity (0 = off)</div>
          <InputNumber min={0} max={100} value={maxPercent} onChange={(value) => setMaxPercent(value ?? 0)} style={{ width: '100%' }} />
        </Col>
        <Col span={8}>
          <Statistic
            title="Session net gain"
            value={stats?.combinedNetGain ?? 0}
            precision={2}
            prefix="$"
            valueStyle={{ fontSize: 16, color: (stats?.combinedNetGain ?? 0) >= 0 ? '#3f8600' : '#cf1322' }}
          />
        </Col>
        <Col span={8}>
          <Statistic title="Manual" value={stats?.manualNetGain ?? 0} precision={2} prefix="$" valueStyle={{ fontSize: 16 }} />
        </Col>
        <Col span={8}>
          <Statistic title="AI" value={stats?.aiNetGain ?? 0} precision={2} prefix="$" valueStyle={{ fontSize: 16 }} />
        </Col>
        <Col span={8}>
          <Statistic title="Remaining" value={stats?.remainingSessionGain ?? 0} precision={2} prefix="$" valueStyle={{ fontSize: 16 }} />
        </Col>
        <Col span={8}>
          <Statistic title="Wins" value={stats?.wins ?? 0} valueStyle={{ fontSize: 16 }} />
        </Col>
        <Col span={8}>
          <Statistic title="Losses" value={stats?.losses ?? 0} valueStyle={{ fontSize: 16 }} />
        </Col>
        <Col span={24}>
          <div style={{ fontSize: 12, color: '#888' }}>
            Session started: {stats ? new Date(stats.sessionStartedAt).toLocaleString() : '—'}
          </div>
        </Col>
        <Col span={24}>
          <Space wrap>
            <Button size="small" type="primary" loading={saveMutation.isPending} onClick={save}>
              Save settings
            </Button>
            <Button size="small" loading={resetMutation.isPending} onClick={() => resetMutation.mutate()}>
              Reset session
            </Button>
            <Button
              size="small"
              onClick={() => emitUiEvent({ type: 'request-withdraw', payload: { reason: 'binary session gain' } })}
            >
              Withdraw
            </Button>
          </Space>
        </Col>
      </Row>
    </Card>
  );
}
