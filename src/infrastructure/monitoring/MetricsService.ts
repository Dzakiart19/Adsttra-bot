import { logger } from '../logging/logger';

export interface TrafficMetrics {
  totalSessions: number;
  successfulSessions: number;
  failedSessions: number;
  totalDurationMs: number;
  averageDurationMs: number;
  lastSessionStatus: 'success' | 'failure' | 'none';
  activeSessions: number;
}

export class MetricsService {
  private static instance: MetricsService;
  private metrics: TrafficMetrics = {
    totalSessions: 0,
    successfulSessions: 0,
    failedSessions: 0,
    totalDurationMs: 0,
    averageDurationMs: 0,
    lastSessionStatus: 'none',
    activeSessions: 0,
  };

  private constructor() {}

  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  public trackSessionStart(): void {
    this.metrics.totalSessions++;
    this.metrics.activeSessions++;
    logger.debug('Metric: Session started', { active: this.metrics.activeSessions });
  }

  public trackSessionEnd(success: boolean, durationMs: number): void {
    this.metrics.activeSessions--;
    if (success) {
      this.metrics.successfulSessions++;
      this.metrics.lastSessionStatus = 'success';
    } else {
      this.metrics.failedSessions++;
      this.metrics.lastSessionStatus = 'failure';
    }
    
    this.metrics.totalDurationMs += durationMs;
    this.metrics.averageDurationMs = Math.floor(this.metrics.totalDurationMs / (this.metrics.successfulSessions + this.metrics.failedSessions));

    logger.debug('Metric: Session ended', { 
      success, 
      durationMs, 
      total: this.metrics.totalSessions,
      failed: this.metrics.failedSessions 
    });
  }

  public getMetrics(): TrafficMetrics {
    return { ...this.metrics };
  }

  public printSummary(): void {
    const successRate = ((this.metrics.successfulSessions / Math.max(1, this.metrics.totalSessions - this.metrics.activeSessions)) * 100).toFixed(1);
    const avgDuration = (this.metrics.averageDurationMs / 1000).toFixed(1);
    logger.info(
      `[Dashboard] active=${this.metrics.activeSessions} total=${this.metrics.totalSessions} ` +
      `success=${successRate}% avg=${avgDuration}s last=${this.metrics.lastSessionStatus.toUpperCase()}`
    );
  }
}
