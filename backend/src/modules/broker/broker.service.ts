import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BrokerAccount,
  BrokerAccountDocument,
  BrokerAccountStatus,
  BrokerName,
} from './schemas/broker-account.schema';
import { KiteAdapterService } from './kite-adapter.service';

@Injectable()
export class BrokerService {
  constructor(
    @InjectModel(BrokerAccount.name) private brokerModel: Model<BrokerAccountDocument>,
    private kite: KiteAdapterService,
  ) {}

  getLoginUrl(): string {
    if (!this.kite.isConfigured()) {
      throw new BadRequestException('Kite API credentials not configured. Set KITE_API_KEY and KITE_API_SECRET in .env');
    }
    return this.kite.getLoginUrl();
  }

  async handleCallback(userId: string, requestToken: string): Promise<BrokerAccountDocument> {
    try {
      console.log(`[OAuth] Starting callback for user: ${userId}, requestToken: ${requestToken.substring(0, 20)}...`);
      const session = await this.kite.generateSession(requestToken);
      console.log(`[OAuth] Session generated, access_token: ${session.accessToken.substring(0, 20)}...`);

      const { accessToken } = session;
      const profile = await this.kite.getProfile(accessToken);
      console.log(`[OAuth] Profile fetched: ${profile.user_id}`);

      const tokenExpiresAt = this.nextMidnight();
      console.log(`[OAuth] About to save account with status: CONNECTED`);

      const account = await this.brokerModel.findOneAndUpdate(
        { userId: new Types.ObjectId(userId), broker: BrokerName.ZERODHA },
        {
          accessToken,
          tokenExpiresAt,
          clientId: profile.user_id,
          status: BrokerAccountStatus.CONNECTED,
          isPaper: false,
          meta: { userName: profile.user_name, email: profile.email },
        },
        { upsert: true, new: true },
      );
      console.log(`[OAuth] Account saved! ID: ${account?._id}, Status: ${account?.status}`);
      return account!;
    } catch (err: any) {
      console.error(`[OAuth] Error in callback:`, {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
        code: err.code,
        stack: err.stack,
      });
      throw err;
    }
  }

  async getConnectedAccount(userId: string): Promise<BrokerAccountDocument | null> {
    return this.brokerModel
      .findOne({
        userId: new Types.ObjectId(userId),
        broker: BrokerName.ZERODHA,
        status: BrokerAccountStatus.CONNECTED,
      })
      .select('+accessToken');
  }

  async getValidAccessToken(userId: string): Promise<string> {
    const account = await this.getConnectedAccount(userId);
    if (!account?.accessToken) {
      throw new BadRequestException('No connected broker account. Please re-authenticate via /api/broker/zerodha/login');
    }
    if (account.tokenExpiresAt && new Date() > account.tokenExpiresAt) {
      await this.brokerModel.findByIdAndUpdate(account._id, { status: BrokerAccountStatus.DISCONNECTED });
      throw new BadRequestException('Broker session expired. Please re-authenticate via /api/broker/zerodha/login');
    }
    return account.accessToken;
  }

  async disconnect(userId: string): Promise<void> {
    await this.brokerModel.updateMany(
      { userId: new Types.ObjectId(userId) },
      { status: BrokerAccountStatus.DISCONNECTED, accessToken: undefined },
    );
  }

  async getStatus(userId: string) {
    const account = await this.brokerModel.findOne({ userId: new Types.ObjectId(userId), broker: BrokerName.ZERODHA });
    if (!account) return { connected: false, broker: BrokerName.ZERODHA };
    return {
      connected: account.status === BrokerAccountStatus.CONNECTED,
      broker: account.broker,
      clientId: account.clientId,
      tokenExpiresAt: account.tokenExpiresAt,
      status: account.status,
      meta: account.meta,
    };
  }

  async initPaperTrading(userId: string): Promise<BrokerAccountDocument> {
    const account = await this.brokerModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), broker: BrokerName.PAPER },
      {
        status: BrokerAccountStatus.CONNECTED,
        clientId: `paper_${userId.substring(0, 8)}`,
        isPaper: true,
        tokenExpiresAt: this.nextMidnight(),
        meta: { type: 'paper_trading', initDate: new Date().toISOString() },
      },
      { upsert: true, new: true },
    );
    return account!;
  }

  async getFirstValidAccessToken(): Promise<string | null> {
    const account = await this.brokerModel
      .findOne({ status: BrokerAccountStatus.CONNECTED, broker: BrokerName.ZERODHA })
      .select('+accessToken');
    if (!account?.accessToken) return null;
    if (account.tokenExpiresAt && new Date() > account.tokenExpiresAt) return null;
    return account.accessToken;
  }

  async getPaperStatus(userId: string) {
    const account = await this.brokerModel.findOne({
      userId: new Types.ObjectId(userId),
      broker: BrokerName.PAPER,
    });
    if (!account) return { connected: false, broker: 'paper' };
    return {
      connected: account.status === BrokerAccountStatus.CONNECTED,
      broker: 'paper',
      clientId: account.clientId,
      status: account.status,
      isPaper: true,
    };
  }

  private nextMidnight(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
