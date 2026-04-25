export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/moneybox',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  broker: {
    kiteApiKey: process.env.KITE_API_KEY ?? '',
    kiteApiSecret: process.env.KITE_API_SECRET ?? '',
    kiteRedirectUrl: process.env.KITE_REDIRECT_URL ?? '',
  },
});
