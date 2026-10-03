import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

import type { AddressSource, AddressValidation, WalletAddressesUpdate } from '@aioption/shared';
import { BASE_CURRENCY_LABEL } from '@aioption/shared';

import { api } from '../api/client';

export const ADDRESS_WARNING =
  'Please verify the Tron address carefully. Incorrect addresses may cause loss of funds or failed deposits/withdrawals.';

const SOURCE_LABEL: Record<AddressSource, { label: string; color: string }> = {
  DATABASE: { label: 'Database', color: 'blue' },
  ENVIRONMENT: { label: 'Environment', color: 'purple' },
  SIMULATED: { label: 'Simulated placeholder', color: 'default' },
  NOT_SET: { label: 'Not Set', color: 'red' },
};

function ValidationTag({ validation }: { validation: AddressValidation | null }) {
  if (!validation) {
    return <Tag>Uses trade address</Tag>;
  }
  return validation.valid ? (
    <Tag color="green">Valid Tron address</Tag>
  ) : (
    <Tag color="orange">{validation.reason ?? 'Invalid'}</Tag>
  );
}

interface FormValues {
  usdtTradeAddress: string;
  withdrawalDestinationAddress: string;
  trxFeeWalletAddress: string;
}

/**
 * User-editable USDT Tron trade address (Phase 6.5.1): shows the current
 * address, source, QR, copy, last update and validation; edits are
 * validated server-side and require confirmation before saving.
 */
export function TradeAddressPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const { data } = useQuery({
    queryKey: ['wallet-addresses'],
    queryFn: api.walletAddresses,
    refetchInterval: 15000,
  });

  const saveMutation = useMutation({
    mutationFn: api.updateWalletAddresses,
    onSuccess: () => {
      messageApi.success('Tron addresses saved');
      setEditing(false);
      for (const key of ['wallet-addresses', 'deposits-info', 'tron-status', 'tron-fee-deposit-info', 'tron-fee-status']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  /** Server-side validation used by the form rules (same checks as on save). */
  const tronRule = (optional: boolean) => ({
    validator: async (_rule: unknown, value: string | undefined) => {
      const trimmed = (value ?? '').trim();
      if (trimmed === '') {
        return optional ? Promise.resolve() : Promise.reject(new Error('Address is required.'));
      }
      const result = await api.validateAddress(trimmed);
      return result.valid ? Promise.resolve() : Promise.reject(new Error(result.reason ?? 'Invalid Tron address'));
    },
  });

  const startEdit = () => {
    if (data) {
      form.setFieldsValue({
        usdtTradeAddress: data.usdtTradeAddressSource === 'SIMULATED' ? '' : data.usdtTradeAddress,
        withdrawalDestinationAddress: data.withdrawalDestinationAddress,
        trxFeeWalletAddress: data.trxFeeWalletAddressSource === 'DATABASE' ? data.trxFeeWalletAddress : '',
      });
    }
    setEditing(true);
  };

  const submit = (values: FormValues) => {
    const patch: WalletAddressesUpdate = {
      usdtTradeAddress: values.usdtTradeAddress.trim(),
      withdrawalDestinationAddress: (values.withdrawalDestinationAddress ?? '').trim(),
      trxFeeWalletAddress: (values.trxFeeWalletAddress ?? '').trim(),
    };
    void modal.confirm({
      title: 'Save new Tron address?',
      okText: 'Yes, save address',
      content: (
        <>
          <Alert type="warning" showIcon message={ADDRESS_WARNING} style={{ marginBottom: 12 }} />
          <Typography.Paragraph style={{ marginBottom: 4 }}>New {BASE_CURRENCY_LABEL} trade address:</Typography.Paragraph>
          <Typography.Text code style={{ wordBreak: 'break-all' }}>
            {patch.usdtTradeAddress}
          </Typography.Text>
        </>
      ),
      onOk: () => saveMutation.mutateAsync(patch),
    });
  };

  const copy = () => {
    if (data?.usdtTradeAddress) {
      void navigator.clipboard?.writeText(data.usdtTradeAddress);
      messageApi.success('Trade address copied');
    }
  };

  const source = data ? SOURCE_LABEL[data.usdtTradeAddressSource] : null;

  return (
    <Card
      title={`${BASE_CURRENCY_LABEL} Tron trade address`}
      size="small"
      extra={
        <Space size={4}>
          <Button size="small" onClick={copy} disabled={!data?.usdtTradeAddress}>
            Copy
          </Button>
          <Button size="small" type="primary" onClick={startEdit} disabled={!data || editing}>
            Edit
          </Button>
        </Space>
      }
    >
      {contextHolder}
      {modalContextHolder}
      {!data ? (
        <Typography.Text type="secondary">Loading addresses…</Typography.Text>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {!compact && data.usdtTradeAddress && (
            <div style={{ padding: 8, background: '#fff', border: '1px solid #eee' }}>
              <QRCodeSVG value={data.usdtTradeAddress} size={112} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 260 }}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Trade address">
                <Typography.Text style={{ wordBreak: 'break-all' }} data-testid="usdt-trade-address">
                  {data.usdtTradeAddress || '—'}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Source">
                {source && <Tag color={source.color}>{source.label}</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Validation">
                <ValidationTag validation={data.validationStatus.usdtTradeAddress} />
              </Descriptions.Item>
              <Descriptions.Item label="Last updated">
                {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'never'}
              </Descriptions.Item>
              <Descriptions.Item label="Withdrawal destination">
                <Typography.Text style={{ wordBreak: 'break-all' }}>
                  {data.effectiveWithdrawalDestinationAddress || '—'}
                </Typography.Text>{' '}
                {!data.withdrawalDestinationAddress && <Tag>same as trade address</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="TRX fee wallet">
                <Typography.Text style={{ wordBreak: 'break-all' }}>
                  {data.trxFeeWalletAddress || 'not configured'}
                </Typography.Text>{' '}
                <Tag>{SOURCE_LABEL[data.trxFeeWalletAddressSource].label}</Tag>
              </Descriptions.Item>
            </Descriptions>
          </div>
        </div>
      )}

      {editing && (
        <Form form={form} layout="vertical" size="small" onFinish={submit} style={{ marginTop: 12 }}>
          <Alert type="warning" showIcon message={ADDRESS_WARNING} style={{ marginBottom: 12 }} />
          <Form.Item
            name="usdtTradeAddress"
            label={`${BASE_CURRENCY_LABEL} Tron trade address (TRC20)`}
            validateTrigger="onBlur"
            rules={[tronRule(false)]}
          >
            <Input placeholder="T…" maxLength={64} autoComplete="off" spellCheck={false} />
          </Form.Item>
          <Form.Item
            name="withdrawalDestinationAddress"
            label="Withdrawal destination (optional — empty uses the trade address)"
            validateTrigger="onBlur"
            rules={[tronRule(true)]}
          >
            <Input placeholder="T… (optional)" maxLength={64} autoComplete="off" spellCheck={false} />
          </Form.Item>
          <Form.Item
            name="trxFeeWalletAddress"
            label="TRX fee wallet (optional — empty uses the configured default)"
            validateTrigger="onBlur"
            rules={[tronRule(true)]}
          >
            <Input placeholder="T… (optional)" maxLength={64} autoComplete="off" spellCheck={false} />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            Live withdrawals are always sent from the server hot wallet (which needs TRX for fees);
            this address is used for display, deposits and as the default withdrawal destination.
          </Typography.Paragraph>
          <Space>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
              Save address
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </Space>
        </Form>
      )}
    </Card>
  );
}

