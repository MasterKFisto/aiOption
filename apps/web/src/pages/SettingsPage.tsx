import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Divider, Form, InputNumber, Switch, Typography, message } from 'antd';
import { useEffect } from 'react';

import { api } from '../api/client';
import type { RiskSettingsUpdate } from '../api/client';
import { emitUiEvent } from '../api/events';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<RiskSettingsUpdate>();
  const [messageApi, contextHolder] = message.useMessage();

  const { data: summary, isLoading } = useQuery({
    queryKey: ['summary'],
    queryFn: api.summary,
  });

  useEffect(() => {
    if (summary) {
      form.setFieldsValue({
        maxOpenPositions: summary.account.maxOpenPositions,
        lossLimitPercent: summary.account.lossLimitPercent,
        fixedTradeSizeUsd: summary.account.fixedTradeSizeUsd,
        postTradePromptEnabled: summary.account.postTradePromptEnabled,
        maxOptionStakeUsd: summary.account.maxOptionStakeUsd,
        optionDefaultDurationSeconds: summary.account.optionDefaultDurationSeconds,
      });
    }
  }, [summary, form]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  const updateMutation = useMutation({
    mutationFn: api.updateRiskSettings,
    onSuccess: () => {
      messageApi.success('Risk settings updated');
      invalidate();
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const toggleMutation = useMutation({
    mutationFn: (enable: boolean) => (enable ? api.startTrading() : api.stopTrading()),
    onSuccess: (result) => {
      messageApi.success(result.running ? 'Trading started' : 'Trading stopped');
      if (!result.running) {
        emitUiEvent({ type: 'trading-stopped', payload: { reason: 'manual' } });
      }
      invalidate();
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const tradingEnabled = summary?.loopRunning ?? false;

  return (
    <div style={{ maxWidth: 480 }}>
      {contextHolder}
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Settings
      </Typography.Title>

      <Card title="Risk limits" loading={isLoading}>
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => updateMutation.mutate(values)}
        >
          <Form.Item name="maxOpenPositions" label="Max open positions" rules={[{ required: true }]}>
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="lossLimitPercent"
            label="Daily loss limit (%) — default 40%, max 80%"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={80} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="maxOptionStakeUsd"
            label="Max option stake (USD) — max 100"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="optionDefaultDurationSeconds"
            label="Option default duration (seconds)"
            rules={[{ required: true }]}
          >
            <InputNumber min={60} max={600} step={60} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="fixedTradeSizeUsd" label="Fixed trade size (USD)" rules={[{ required: true }]}>
            <InputNumber min={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="postTradePromptEnabled"
            label="Post-trade prompt"
            valuePropName="checked"
            extra="Ask whether to keep funds in the wallet or withdraw after a trade stops."
          >
            <Switch checkedChildren="ON" unCheckedChildren="OFF" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>
            Save settings
          </Button>
        </Form>
      </Card>

      <Divider />

      <Card title="Trading">
        <Typography.Paragraph>
          Trading status:{' '}
          <Switch
            checked={tradingEnabled}
            loading={toggleMutation.isPending}
            onChange={(checked) => toggleMutation.mutate(checked)}
            checkedChildren="ON"
            unCheckedChildren="OFF"
          />
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Starting the loop requires paper funds (use the wallet API to deposit). The loop then
          evaluates signals every minute and executes approved trades automatically.
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
