import env from 'env-var';

export const config = {
  nodeEnv: env.get('NODE_ENV').default('development').asString(),
  port: env.get('PORT').default('3001').asPortNumber(),
  host: env.get('HOST').default('0.0.0.0').asString(),

  database: {
    url: env.get('DATABASE_URL').required().asString(),
  },

  redis: {
    url: env.get('REDIS_URL').default('redis://localhost:6379').asString(),
  },

  jwt: {
    secret: env.get('JWT_SECRET').required().asString(),
    expiresIn: env.get('JWT_EXPIRES_IN').default('7d').asString(),
  },

  admin: {
    email: env.get('ADMIN_EMAIL').required().asString(),
  },

  trading: {
    loopEnabled: env.get('TRADING_LOOP_ENABLED').default('true').asBool(),
    loopIntervalMs: env.get('TRADING_LOOP_INTERVAL_MS').default('30000').asIntPositive(),
    paperTrading: env.get('PAPER_TRADING').default('true').asBool(),
    liveTradingEnabled: env.get('LIVE_TRADING_ENABLED').default('false').asBool(),
    defaultMaxTradeUsd: env.get('DEFAULT_MAX_TRADE_USD').default('10').asString(),
    defaultDailyLossLimitUsd: env.get('DEFAULT_DAILY_LOSS_LIMIT_USD').default('20').asString(),
    defaultWeeklyLossLimitUsd: env.get('DEFAULT_WEEKLY_LOSS_LIMIT_USD').default('50').asString(),
    defaultMaxOpenPositions: env.get('DEFAULT_MAX_OPEN_POSITIONS').default('3').asIntPositive(),
  },

  assets: {
    supported: env.get('SUPPORTED_ASSETS').default('USDC,ETH,BTC').asString().split(','),
    baseAsset: env.get('BASE_ASSET').default('USDC').asString(),
  },

  wallet: {
    mode: env.get('WALLET_MODE').default('PAPER').asString(),
    metamaskEnabled: env.get('METAMASK_ENABLED').default('false').asBool(),
    smartWalletEnabled: env.get('SMART_WALLET_ENABLED').default('false').asBool(),
  },

  options: {
    venueMode: env.get('OPTIONS_VENUE_MODE').default('PAPER').asString(),
  },

  ai: {
    engineMode: env.get('AI_ENGINE_MODE').default('MOCK').asString(),
    openaiApiKey: env.get('OPENAI_API_KEY').default('').asString(),
  },

  cors: {
    origin: env.get('CORS_ORIGIN').default('http://localhost:5173').asString(),
  },

  rateLimit: {
    max: env.get('RATE_LIMIT_MAX').default('100').asIntPositive(),
    windowMs: env.get('RATE_LIMIT_WINDOW_MS').default('60000').asIntPositive(),
  },

  logging: {
    level: env.get('LOG_LEVEL').default('info').asString(),
    pretty: env.get('LOG_PRETTY').default('true').asBool(),
  },

  isDevelopment: (): boolean => config.nodeEnv === 'development',
  isProduction: (): boolean => config.nodeEnv === 'production',
  isTest: (): boolean => config.nodeEnv === 'test',
} as const;