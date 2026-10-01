import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect, useState } from 'react';

import type { Withdrawal } from '@aioption/shared';

import { api } from '../api/client';
import { emitUiEvent } from '../api/events';
import { WithdrawalHistoryTable } from './HistoryTables';

const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

interface FormValues {
  amount: number;
  destinationAddress: string;
  confirmed: boolean;
}

/**
 * Tron USDC (TRC20) withdrawal flow. Network/asset/token standard are fixed.
 * Requires explicit user confirmation before submitting.
 */
export function WithdrawModal({
  open,
  onClose,
  prefillAmount,
}: {
  open: boolean;
  onClose: () => void;
  prefillAmount?: number | undefined;
}) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<FormValues>();
  const [result, setResult] = useState<Withdrawal | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: api.summary,
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setResult(null);
      form.resetFields();
      if (prefillAmount !== undefined) {
        form.setFieldValue('amount', prefillAmount);
      }
    }
  }, [open, prefillAmount, form]);

  const mutation = useMutation({
    mutationFn: api.createWithdrawal,
    onSuccess: (data) => {
      if (data.withdrawal) {
        setResult(data.withdrawal);
      }
      messageApi.success(data.message ?? 'Withdrawal submitted');
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
      void queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet-records'] });
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const amount = Form.useWatch('amount', form) as number | undefined;
  const destination = Form.useWatch('destinationAddress', form) as string | undefined;

  const { data: feeEstimate } = useQuery({
    queryKey: ['tron-fee-estimate', amount, destination],
    queryFn: () => api.tronFeeEstimate(amount ?? 0, destination ?? ''),
    enabled:
      open &&
      amount !== undefined &&
      amount > 0 &&
      destination !== undefined &&
      TRON_ADDRESS_PATTERN.test(destination),
  });

  const available = summary?.account.cashBalance ?? 0;
  const feeBlocked = feeEstimate !== undefined && !feeEstimate.sufficientFeeResources;

  const submit = (values: FormValues) => {
    mutation.mutate({
      amount: values.amount,
      destinationAddress: values.destinationAddress.trim(),
      confirmed: values.confirmed,
    });
  };

  return (
    <Modal title="Withdraw USDC" open={open} onCancel={onClose} footer={null} width={560}>
      {contextHolder}
      {result ? (
        <Result
          status={result.status === 'SIMULATED' || result.status === 'BROADCAST' ? 'success' : 'info'}
          title={`Withdrawal ${result.status}`}
          subTitle={
            <>
              ${result.amount.toFixed(2)} USDC → {result.destinationAddress.slice(0, 10)}…
              {result.txid && (
                <>
                  <br />
                  <Typography.Text type="secondary">txid: {result.txid}</Typography.Text>
                </>
              )}
            </>
          }
          extra={<Button onClick={onClose}>Close</Button>}
        />
      ) : (
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ confirmed: false }}>
          <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Asset">USDC</Descriptions.Item>
            <Descriptions.Item label="Network">Tron (fixed)</Descriptions.Item>
            <Descriptions.Item label="Token standard">TRC20</Descriptions.Item>
            <Descriptions.Item label="Available">${available.toFixed(2)}</Descriptions.Item>
          </Descriptions>

          <Form.Item
            name="amount"
            label="Amount"
            rules={[
              { required: true, message: 'enter an amount' },
              {
                validator: (_rule, value: number) =>
                  value !== undefined && value > 0 && value <= available
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(`amount must be > 0 and <= $${available.toFixed(2)}`),
                      ),
              },
            ]}
          >
            <InputNumber min={0.01} max={available} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="destinationAddress"
            label="Destination Tron address"
            rules={[
              { required: true, message: 'enter the destination address' },
              {
                pattern: TRON_ADDRESS_PATTERN,
                message: 'invalid Tron address (base58, T-prefixed, 34 chars)',
              },
            ]}
          >
            <Input placeholder="T..." />
          </Form.Item>

          {feeEstimate && (
            <Alert
              type={feeBlocked ? 'error' : 'info'}
              showIcon
              style={{ marginBottom: 16 }}
              message={
                <>
                  <div>
                    Estimated network fee: <b>{feeEstimate.estimatedFeeTrx} TRX</b>{' '}
                    (≈ ${feeEstimate.estimatedFeeUsd.toFixed(2)}) · paid by{' '}
                    <b>{feeEstimate.feePayer === 'HOT_WALLET' ? 'hot wallet (sender)' : 'deducted from the withdrawal amount'}</b>
                  </div>
                  <div>
                    Hot wallet TRX: {feeEstimate.hotWalletTrxBalance} · Energy:{' '}
                    {feeEstimate.hotWalletEnergyAvailable}
                  </div>
                  {feeBlocked ? (
                    <div>
                      <b>Fee resources insufficient.</b> Fund the hot wallet with TRX or energy
                      before withdrawing USDC.
                      <div style={{ marginTop: 8 }}>
                        <Button
                          size="small"
                          type="primary"
                          onClick={() =>
                            emitUiEvent({ type: 'request-tron-status', payload: { reason: 'fee reserve low' } })
                          }
                        >
                          Open TRX fee deposit panel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      Tron network fees are paid by the sender in TRX or energy. The receiver
                      does not normally settle the network fee.
                    </div>
                  )}
                </>
              }
            />
          )}

          <Alert
            type="warning"
            showIcon
            message="Tron transfers may require TRX for energy or bandwidth fees."
            style={{ marginBottom: 16 }}
          />

          <Form.Item
            name="confirmed"
            valuePropName="checked"
            rules={[
              {
                validator: (_rule, value: boolean) =>
                  value === true
                    ? Promise.resolve()
                    : Promise.reject(new Error('confirm the withdrawal to continue')),
              },
            ]}
          >
            <Checkbox>I confirm this withdrawal to the address above.</Checkbox>
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            loading={mutation.isPending}
            block
            disabled={feeBlocked}
          >
            Submit withdrawal
          </Button>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            Status: <Tag>REQUESTED</Tag> → <Tag>APPROVED</Tag> → <Tag>BROADCAST</Tag> →{' '}
            <Tag>CONFIRMED</Tag> · <Tag>SIMULATED</Tag> in simulated mode
          </Typography.Paragraph>
        </Form>
      )}
      <div style={{ marginTop: 24 }}>
        <Typography.Title level={5}>Withdrawal history</Typography.Title>
        <WithdrawalHistoryTable />
      </div>
    </Modal>
  );
}
