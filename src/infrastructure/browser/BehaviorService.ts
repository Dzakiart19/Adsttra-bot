import { BrowserEngine } from '../../domain/interfaces/BrowserEngine';
import { logger } from '../logging/logger';
import { StateService } from '../monitoring/StateService';

export interface BehaviorOptions {
  intensity: 'low' | 'medium' | 'high';
}

export class BehaviorService {
  /**
   * Performs a random human-like action (scroll, move, or wait)
   */
  static async simulateRandomAction(
    engine: BrowserEngine, 
    viewport: { width: number, height: number },
    options: BehaviorOptions
  ): Promise<void> {
    const rand = Math.random();
    
    // Adjust probability based on intensity
    const thresholds = options.intensity === 'high' 
      ? { scroll: 0.35, move: 0.7, pause: 0.9 } 
      : options.intensity === 'medium' 
        ? { scroll: 0.25, move: 0.5, pause: 0.8 }
        : { scroll: 0.1, move: 0.2, pause: 0.7 };

    if (rand < thresholds.scroll) {
      await this.simulateScroll(engine);
    } else if (rand < thresholds.move) {
      await this.simulateMouseMove(engine, viewport);
    } else if (rand < thresholds.pause) {
      const pauseDuration = Math.floor(Math.random() * 3000) + 2000;
      const pauseSec = (pauseDuration / 1000).toFixed(1);
      StateService.update({ action: `📖 Membaca konten halaman... (${pauseSec}s)` });
      logger.debug(`Simulating reading pause: ${pauseSec}s`);
      const start = Date.now();
      while (Date.now() - start < pauseDuration) {
        if (Math.random() > 0.8) {
          const nudgeX = Math.floor(Math.random() * 10) - 5;
          const nudgeY = Math.floor(Math.random() * 10) - 5;
          await engine.mouseMove(viewport.width / 2 + nudgeX, viewport.height / 2 + nudgeY);
        }
        await engine.wait(500);
      }
    } else {
      const ms = Math.floor(Math.random() * 500) + 100;
      StateService.update({ action: `⏸ Jeda sejenak... (${ms}ms)` });
      await engine.wait(ms);
    }
  }

  private static async simulateScroll(engine: BrowserEngine): Promise<void> {
    const direction = Math.random() > 0.3 ? 1 : -1;
    const distance = Math.floor(Math.random() * 400) + 100;
    const dir = direction > 0 ? '↓' : '↑';
    StateService.update({ action: `📜 Scroll ${dir} ${distance}px` });
    logger.debug(`Simulating scroll: ${direction * distance}px`);
    
    const steps = 5;
    const stepDistance = Math.floor(distance / steps);
    for (let i = 0; i < steps; i++) {
      await engine.scroll(0, direction * stepDistance);
      await engine.wait(Math.floor(Math.random() * 50) + 20);
    }
  }

  private static async simulateMouseMove(
    engine: BrowserEngine, 
    viewport: { width: number, height: number }
  ): Promise<void> {
    const targetX = Math.floor(Math.random() * viewport.width);
    const targetY = Math.floor(Math.random() * viewport.height);
    StateService.update({ action: `🖱️ Gerakkan mouse ke koordinat (${targetX}, ${targetY})` });
    logger.debug(`Simulating mouse move to: ${targetX}, ${targetY}`);
    await engine.mouseMove(targetX, targetY);
  }
}
