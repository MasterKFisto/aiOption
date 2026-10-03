import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Col, Collapse, Form, InputNumber, Row, Space, Switch, Tag, Typography, message } from 'antd';
import { useEffect } from 'react';

import type { ClassicDirectionState } from '@aioption/shared';

import { api } from '../api/client';

interface FormValues {
  rsiOverbought: number;
  rsiOversold: number;
  rsiPeriod: number;
  maxConsecutiveSameDirection: number;
  cooldownMinutes: number;
  requireNeutralCooldown: boolean;
}

/** Live AI streak + per-direction cooldown tags. */
function DirectionState({ direction }: { direction: ClassicDirectionState | undefined }) {
  const blocked = (label: 'PUT' | 'CALL', until: string | null | undefined) =>
    until ? (
      <Tag color="red">
        {label} blocked until {new Date(until).toLocaleTimeString()}
      </Tag>
    ) : (
      <Tag color="green">{label} allowed</Tag>
    );
  return (
    <Space wrap style={{ marginBottom: 8 }} data-testid="direction-state">
      <Typography.Text type="secondary">AI streak:</Typography.Text>
      <Tag color={direction?.consecutivePutCount ? 'volcano' : 'default'}>
        {direction?.consecutivePutCount ?? 0} consecutive PUT
      </Tag>
      <Tag color={direction?.consecutiveCallCount ? 'geekblue' : 'default'}>
        {direction?.consecutiveCallCount ?? 0} consecutive CALL
      </Tag>
      {blocked('PUT', direction?.putBlockedUntil)}
      {blocked('CALL', direction?.callBlockedUntil)}
    </Space>
  );
}

/**
 * "Advanced AI Settings" (Phase 6.5.2): RSI regime thresholds and the anti
 * one-sided-loop controls. Saved to app_settings and applied to the live
 * trading loop immediately (the engine reads them on every tick).
 */
export function AdvancedAiSettings() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<FormValues>();

  const { data } = useQuery({
    queryKey: ['classic-strategy'],
    queryFn: api.classicStrategy,
    refetchInterval: 5000,
  });

  const toForm = (settings: NonNullable<typeof data>['settings']): FormValues => ({
    ...settings,
    cooldownMinutes: settings.cooldownAfterMaxConsecutiveMs / 60_000,
  });

  // Defensive: never crash the Classic page on an unexpected payload.
  const settings = data && typeof data === 'object' && 'settings' in data ? data.settings : undefined;
  const direction = data && typeof data === 'object' && 'direction' in data ? data.direction : undefined;

  useEffect(() => {
    if (settings && !form.isFieldsTouched()) {
      form.setFieldsValue(toForm(settings));
    }
  }, [settings, form]);

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      api.updateClassicStrategy({
        rsiOverbought: values.rsiOverbought,
        rsiOversold: values.rsiOversold,
        rsiPeriod: values.rsiPeriod,
        maxConsecutiveSameDirection: values.maxConsecutiveSameDirection,
        cooldownAfterMaxConsecutiveMs: Math.round(values.cooldownMinutes * 60_000),
        requireNeutralCooldown: values.requireNeutralCooldown,
      }),
    onSuccess: (saved) => {
      messageApi.success('Advanced AI settings saved — applied to the live loop');
      form.resetFields();
      form.setFieldsValue(toForm(saved.settings));
      void queryClient.invalidateQueries({ queryKey: ['classic-strategy'] });
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  return (
    <Collapse
      size="small"
      style={{ marginTop: 12 }}
      items={[
        {
          key: 'advanced',
          label: 'Advanced AI Settings',
          forceRender: true,
          children: (
            <>
              {contextHolder}
              <DirectionState direction={direction} />
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="The AI will not open a PUT when RSI is oversold, nor a CALL when RSI is overbought. After the max number of same-direction trades, that direction is paused for the cooldown."
              />
              <Form form={form} layout="vertical" size="small" onFinish={(values) => save.mutate(values)}>
                <Row gutter={8}>
                  <Col span={8}>
                    <Form.Item name="rsiOverbought" label="RSI Overbought (51–99)" rules={[{ required: true }]}>
                      <InputNumber min={51} max={99} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="rsiOversold" label="RSI Oversold (1–49)" rules={[{ required: true }]}>
                      <InputNumber min={1} max={49} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="rsiPeriod" label="RSI period" rules={[{ required: true }]}>
                      <InputNumber min={2} max={100} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      name="maxConsecutiveSameDirection"
                      label="Max consecutive same direction"
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={1} max={20} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      name="cooldownMinutes"
                      label="Cooldown after max consecutive (min)"
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={0} max={1440} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item
                      name="requireNeutralCooldown"
                      label="Require a NEUTRAL signal before switching CALL ↔ PUT"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="ON" unCheckedChildren="OFF" />
                    </Form.Item>
                  </Col>
                </Row>
                <Button htmlType="submit" loading={save.isPending} block>
                  Save AI Settings
                </Button>
              </Form>
            </>
          ),
        },
      ]}
    />
  );
}
