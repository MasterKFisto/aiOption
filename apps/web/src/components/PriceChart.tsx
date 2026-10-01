import { useQuery } from '@tanstack/react-query';
import { Card, Segmented, Typography } from 'antd';
import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';

import { api } from '../api/client';

type Interval = '1m' | '5m' | '1h';

const palette = {
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderVisible: false,
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
};

/** Real-time candlestick chart for the live market symbol. */
export function PriceChart({ interval, onIntervalChange }: { interval: Interval; onIntervalChange: (v: Interval) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null);

  const { data, error } = useQuery({
    queryKey: ['candles', interval],
    queryFn: () => api.candles(interval, 300),
    refetchInterval: 3000,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const chart = createChart(container, {
      autoSize: true,
      height: 320,
      layout: { background: { color: '#ffffff' }, textColor: '#333' },
      grid: {
        vertLines: { color: '#eeeeee' },
        horzLines: { color: '#eeeeee' },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;
    const series = chart.addSeries(CandlestickSeries, palette);
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !data) {
      return;
    }
    series.setData(
      data.candles.map((candle) => ({
        time: (candle.timestamp / 1000) as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return (
    <Card
      title="BTC/USDC chart"
      extra={
        <Segmented
          options={['1m', '5m', '1h']}
          value={interval}
          onChange={(value) => onIntervalChange(value as Interval)}
        />
      }
    >
      {error ? (
        <Typography.Text type="danger">{(error as Error).message}</Typography.Text>
      ) : (
        <div ref={containerRef} style={{ height: 320 }} />
      )}
    </Card>
  );
}
