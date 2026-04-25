import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument, OrderSide, OrderStatus, OrderType, TradingMode } from './schemas/order.schema';
import { PortfolioService } from '../portfolio/portfolio.service';

export interface PaperOrderRequest {
  userId: string;
  strategyId: string;
  symbol: string;
  exchange: string;
  side: OrderSide;
  quantity: number;
  price: number;
  stopPrice: number;
  targetPrice: number;
  signalId?: string;
}

export interface PositionExitResult {
  positionId: string;
  symbol: string;
  exitPrice: number;
  realizedPnl: number;
  won: boolean;
  reason: 'STOP' | 'TARGET';
}

@Injectable()
export class PaperExecutionService {
  private readonly logger = new Logger(PaperExecutionService.name);

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private portfolioService: PortfolioService,
  ) {}

  async placeOrder(req: PaperOrderRequest): Promise<{ order: OrderDocument; positionId: string }> {
    const order = await this.orderModel.create({
      userId: new Types.ObjectId(req.userId),
      strategyId: new Types.ObjectId(req.strategyId),
      mode: TradingMode.PAPER,
      symbol: req.symbol,
      exchange: req.exchange,
      side: req.side,
      orderType: OrderType.MARKET,
      quantity: req.quantity,
      price: req.price,
      averagePrice: req.price,
      filledQuantity: req.quantity,
      status: OrderStatus.COMPLETE,
      signalId: req.signalId,
      meta: { stopPrice: req.stopPrice, targetPrice: req.targetPrice },
    });

    const position = await this.portfolioService.openPosition({
      userId: req.userId,
      strategyId: req.strategyId,
      symbol: req.symbol,
      exchange: req.exchange,
      mode: 'paper',
      quantity: req.quantity,
      entryPrice: req.price,
    });

    this.logger.log(
      `Paper FILL: ${req.side} ${req.quantity} ${req.symbol} @ ₹${req.price} | Stop ₹${req.stopPrice} Target ₹${req.targetPrice}`,
    );

    return { order, positionId: String(position._id) };
  }

  async checkAndExitPositions(
    userId: string,
    strategyId: string,
    latestCandles: Map<string, { high: number; low: number; close: number }>,
  ): Promise<PositionExitResult[]> {
    const positions = await this.portfolioService.getOpenPositions(userId, strategyId);
    const exits: PositionExitResult[] = [];

    for (const pos of positions) {
      const candle = latestCandles.get(`${pos.symbol}:${pos.exchange}`);
      if (!candle) {
        await this.portfolioService.updateUnrealizedPnl(String(pos._id), pos.lastPrice);
        continue;
      }

      const order = await this.orderModel
        .findOne({
          userId: pos.userId,
          strategyId: pos.strategyId,
          symbol: pos.symbol,
          status: OrderStatus.COMPLETE,
        })
        .sort({ createdAt: -1 });

      const stopPrice = (order?.meta as any)?.stopPrice as number | undefined;
      const targetPrice = (order?.meta as any)?.targetPrice as number | undefined;

      if (!stopPrice || !targetPrice) {
        await this.portfolioService.updateUnrealizedPnl(String(pos._id), candle.close);
        continue;
      }

      if (candle.low <= stopPrice) {
        const closed = await this.portfolioService.closePosition(String(pos._id), stopPrice);
        this.logger.log(`STOP hit: ${pos.symbol} @ ₹${stopPrice} | P&L ₹${closed.realizedPnl.toFixed(2)}`);
        exits.push({ positionId: String(pos._id), symbol: pos.symbol, exitPrice: stopPrice, realizedPnl: closed.realizedPnl, won: false, reason: 'STOP' });
        continue;
      }

      if (candle.high >= targetPrice) {
        const closed = await this.portfolioService.closePosition(String(pos._id), targetPrice);
        this.logger.log(`TARGET hit: ${pos.symbol} @ ₹${targetPrice} | P&L ₹${closed.realizedPnl.toFixed(2)}`);
        exits.push({ positionId: String(pos._id), symbol: pos.symbol, exitPrice: targetPrice, realizedPnl: closed.realizedPnl, won: true, reason: 'TARGET' });
        continue;
      }

      await this.portfolioService.updateUnrealizedPnl(String(pos._id), candle.close);
    }

    return exits;
  }
}
