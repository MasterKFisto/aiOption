import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect } from 'react';

import type { ClassicBlockedReason, ClassicSettingsUpdate } from '@aioption/shared';

import { api } from '../api/client';
import { emitUiEvent } from '../api/events';

export const durationLabel = (seconds: number): string =>
  seconds >= 60 ? `${seconds / 60} min` : `${seconds}s`;

/** Status label per blocked reason (Phase 6.5.1 spec wording). */
const STATUS: Record<'ENABLED' | ClassicBlockedReason, { label: string; color: string }> = {
  ENABLED: { label: 'Trading Enabled', color: 'green' },
  TRADING_DISABLED: { label: 'Trading Disabled', color: 'default' },
  LOSS_LIMIT_REACHED: { label: 'Loss Limit Reached', color: 'red' },
  DAILY_LOSS_LIMIT_REACHED: { label: 'Daily Loss Limit Reached', color: 'red' },
  MARKET_DATA_STALE: { label: 'Market Data Stale', color: 'orange' },
  RISK_ENGINE_BLOCKED: { label: 'Trading Blocked by Risk Engine', color: 'volcano' },
};

/**
 * Classic Options trading control panel (Phase 6.5.1): Start/Stop with
 * confirmation, live status, and the classic settings form — all on the
 * Classic Options page (no longer hidden in Settings).
 */
export function ClassicTradingPanel() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const [form] = Form.useForm<ClassicSettingsUpdate>();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['classic-settings'],
    queryFn: api.classicSettings,
    refetchInterval: 5000,
  });
  const { data: status } = useQuery({
    queryKey: ['classic-status'],
    queryFn: api.classicStatus,
    refetchInterval: 2000,
  });
  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: api.summary });
  const mode = summary?.account.mode ?? 'PAPER';

  // Populate the form once settings arrive (and when the server changes them).
  useEffect(() => {
    if (settings && !form.isFieldsTouched()) {
      form.setFieldsValue({
        defaultStakeUsd: settings.defaultStakeUsd,
        maxStakeUsd: settings.maxStakeUsd,
        defaultDurationSeconds: settings.defaultDurationSeconds,
        dailyLossLimitPercent: settings.dailyLossLimitPercent,
        totalLossLimitPercent: settings.totalLossLimitPercent,
      });
    }
  }, [settings, form]);

  const refresh = () => {
    for (const key of ['classic-settings', 'classic-status', 'summary', 'options-config']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const startMutation = useMutation({
    mutationFn: api.classicStart,
    onSuccess: () => {
      messageApi.success('Classic Options trading started');
      refresh();
    },
    onError: (err) => messageApi.error((err as Error).message),
  });
  const stopMutation = useMutation({
    mutationFn: api.classicStop,
    onSuccess: () => {
      messageApi.success('Classic Options trading stopped — open positions will settle at expiry');
      emitUiEvent({ type: 'trading-stopped', payload: { reason: 'manual' } });
      refresh();
    },
    onError: (err) => messageApi.error((err as Error).message),
  });
  const saveMutation = useMutation({
    mutationFn: api.updateClassicSettings,
    onSuccess: (saved) => {
      messageApi.success('Classic Options settings saved');
      form.resetFields();
      form.setFieldsValue(saved);
      refresh();
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const confirmStart = () => {
    const live = mode === 'LIVE';
    void modal.confirm({
      title: live ? 'Start LIVE Classic Options trading?' : 'Start Classic Options trading?',
      okText: 'Start Trading',
      okButtonProps: { danger: live },
      content: live ? (
        <Alert
          type="error"
          showIcon
          message="LIVE mode — real funds at risk"
          description="Classic Options can lose the full stake of every position. Only trade money you can afford to lose. Losses are limited only by your stake size and the configured loss limits."
        />
      ) : (
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          New Classic Options (manual and AI) will be allowed. Each position locks only its own
          stake; the daily loss limit ({settings?.dailyLossLimitPercent ?? 40}%) still applies.
        </Typography.Paragraph>
      ),
      onOk: () => startMutation.mutateAsync(),
    });
  };

  const confirmStop = () => {
    void modal.confirm({
      title: 'Stop Classic Options trading?',
      okText: 'Stop Trading',
      okButtonProps: { danger: true },
      content:
        'No new Classic Options will be opened. Existing open positions are NOT closed — they keep running and settle automatically at expiry.',
      onOk: () => stopMutation.mutateAsync(),
    });
  };

  const statusKey = status?.blockedReason ?? (status?.tradingEnabled ? 'ENABLED' : 'TRADING_DISABLED');
  const statusInfo = STATUS[statusKey];
  const enabled = status?.tradingEnabled ?? settings?.tradingEnabled ?? false;
  const durations = settings?.allowedDurationsSeconds ?? [60, 180, 300, 600, 900, 1800, 3600];
  const ceiling = settings?.maxStakeCeilingUsd ?? 100;

  return (
    <Card
      title="Classic Options trading"
      size="small"
      loading={isLoading}
      extra={
        <Tag color={statusInfo.color} data-testid="classic-status">
          {statusInfo.label}
        </Tag>
      }
    >
      {contextHolder}
      {modalContextHolder}
      <Space wrap style={{ marginBottom: 12 }}>
        <Button
          type="primary"
          onClick={confirmStart}
          disabled={enabled}
          loading={startMutation.isPending}
        >
          Start Trading
        </Button>
        <Button danger onClick={confirmStop} disabled={!enabled} loading={stopMutation.isPending}>
          Stop Trading
        </Button>
        <Space size={4}>
          <Typography.Text type="secondary">Classic Options</Typography.Text>
          <Switch
            aria-label="Enable Classic Options trading"
            checked={enabled}
            loading={startMutation.isPending || stopMutation.isPending}
            onChange={(checked) => (checked ? confirmStart() : confirmStop())}
            checkedChildren="ON"
            unCheckedChildren="OFF"
          />
        </Space>
      </Space>
      {status?.blockedMessage && status.blockedReason !== 'TRADING_DISABLED' && (
        <Alert type="warning" showIcon message={status.blockedMessage} style={{ marginBottom: 12 }} />
      )}
      <Row gutter={8} style={{ marginBottom: 12 }}>
        <Col span={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Open positions</Typography.Text>
          <div>{status?.openPositions ?? 0}</div>
        </Col>
        <Col span={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Locked (open stakes)</Typography.Text>
          <div>${(status?.openClassicStakeUsd ?? 0).toFixed(2)}</div>
        </Col>
        <Col span={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Available</Typography.Text>
          <div>${(status?.availableBalance ?? 0).toFixed(2)}</div>
        </Col>
      </Row>

      <Form form={form} layout="vertical" size="small" onFinish={(values) => saveMutation.mutate(values)}>
        <Row gutter={8}>
          <Col span={12}>
            <Form.Item name="defaultStakeUsd" label="Default stake (USDC)" rules={[{ required: true }]}>
              <InputNumber min={settings?.minStakeUsd ?? 1} max={ceiling} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="maxStakeUsd" label={`Maximum stake (≤ ${ceiling})`} rules={[{ required: true }]}>
              <InputNumber min={settings?.minStakeUsd ?? 1} max={ceiling} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="defaultDurationSeconds" label="Default duration" rules={[{ required: true }]}>
              <Select
                options={durations.map((d) => ({ value: d, label: durationLabel(d) }))}
                aria-label="Default duration"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="dailyLossLimitPercent" label="Daily loss limit (%)" rules={[{ required: true }]}>
              <InputNumber min={1} max={80} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="totalLossLimitPercent"
              label="Total loss limit (%, 0 = off)"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Button htmlType="submit" loading={saveMutation.isPending} block>
          Save Settings
        </Button>
      </Form>
    </Card>
  );
}

