import { Button, Modal, Typography } from 'antd';

import { BASE_CURRENCY_LABEL } from '@aioption/shared';

export interface PostTradePrompt {
  fingerprint: string;
  title: string;
  message: string;
}

/**
 * Shown when trading stops (position closed, user stopped trading, or a risk
 * stop). Offers: keep funds in the wallet, or withdraw.
 */
export function PostTradeActionModal({
  prompt,
  availableBalance,
  onKeep,
  onWithdraw,
  onClose,
}: {
  prompt: PostTradePrompt | null;
  availableBalance: number;
  onKeep: () => void;
  onWithdraw: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={prompt?.title ?? 'Trade stopped'}
      open={prompt !== null}
      onCancel={onClose}
      footer={[
        <Button key="keep" type="primary" onClick={onKeep}>
          Keep in wallet for next trade
        </Button>,
        <Button key="withdraw" danger onClick={onWithdraw}>
          Withdraw
        </Button>,
      ]}
    >
      <Typography.Paragraph>{prompt?.message}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        Available balance: ${availableBalance.toFixed(2)} {BASE_CURRENCY_LABEL}. You can keep the funds for the
        next trade or withdraw them to your Tron address.
      </Typography.Paragraph>
    </Modal>
  );
}
