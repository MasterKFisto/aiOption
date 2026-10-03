import { useQuery } from '@tanstack/react-query';
import { Card, Spin, Tag, Typography } from 'antd';

import type { MarketConnectionStatus } from '@aioption/shared';

import { api } from '../api/client';

const STATUS_COLORS: Record<MarketConnectionStatus, string> = {
  connected: 'green',
  polling: 'orange',
  disconnected: 'default',
  error: 'red',
};

/** Live BTC/USDT price panel with connection status and source labels. */
export function MarketPricePanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ticker'],
    queryFn: api.ticker,
    refetchInterval: 3000,
  });

  if (isLoading) {
    return (
      <Card title="Live market">
        <Spin />
      </Card>
    );
  }
  if (error || !data?.ticker) {
    return (
      <Card title="Live market">
        <Typography.Text type="danger">
          {error ? (error as Error).message : 'Waiting for the first price update…'}
        </Typography.Text>
      </Card>
    );
  }

  const ticker = data.ticker;
  const changeUp = ticker.priceChange24h >= 0;

  return (
    <Card
      title={`Live market — ${ticker.symbol}`}
      extra={<Tag color={STATUS_COLORS[ticker.status]}>{ticker.status.toUpperCase()}</Tag>}
    >
      <Typography.Title level={2} style={{ marginTop: 0, marginBottom: 4 }}>
        ${ticker.lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </Typography.Title>
      <Typography.Text style={{ color: changeUp ? '#3f8600' : '#cf1322' }}>
        {changeUp ? '+' : ''}
        {ticker.priceChangePercent24h.toFixed(2)}% (24h)
      </Typography.Text>
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        Source: {ticker.source}
        {ticker.usingFallback && (
          <>
            {' · '}
            <Typography.Text type="warning">
              fallback symbol (requested {ticker.requestedSymbol})
            </Typography.Text>
          </>
        )}
        <br />
        Updated: {new Date(ticker.lastUpdatedAt).toLocaleTimeString()}
      </Typography.Paragraph>
    </Card>
  );
}
