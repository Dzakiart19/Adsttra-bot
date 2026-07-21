import { EventEmitter } from 'events';

export interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'success';
  msg: string;
}

export interface LiveState {
  status: 'starting' | 'loading_proxies' | 'running' | 'cooldown' | 'done' | 'error';
  uptime: number;

  round: number;
  cooldownEndsAt: number;

  sessionIndex: number;
  sessionsPerRound: number;
  attempt: number;
  maxAttempts: number;

  step: number;
  totalSteps: number;
  stepStartAt: number;
  stepDurationMs: number;

  proxy: string | null;
  proxyBurnt: boolean;

  targetUrl: string;
  referrer: string | null;
  action: string;

  totalSessions: number;
  successSessions: number;
  failedSessions: number;
  proxyRetries: number;
  proxyPoolSize: number;

  log: LogEntry[];
}

class StateServiceSingleton extends EventEmitter {
  private startedAt = Date.now();
  private _state: LiveState = {
    status: 'starting',
    uptime: 0,
    round: 0,
    cooldownEndsAt: 0,
    sessionIndex: 0,
    sessionsPerRound: 0,
    attempt: 0,
    maxAttempts: 1,
    step: 0,
    totalSteps: 4,
    stepStartAt: 0,
    stepDurationMs: 0,
    proxy: null,
    proxyBurnt: false,
    targetUrl: '',
    referrer: null,
    action: 'Initializing...',
    totalSessions: 0,
    successSessions: 0,
    failedSessions: 0,
    proxyRetries: 0,
    proxyPoolSize: 0,
    log: [],
  };

  update(patch: Partial<Omit<LiveState, 'uptime' | 'log'>>): void {
    Object.assign(this._state, patch);
    this._state.uptime = Math.floor((Date.now() - this.startedAt) / 1000);
    this.emit('update', this.getState());
  }

  addLog(level: LogEntry['level'], msg: string): void {
    this._state.log.unshift({ ts: Date.now(), level, msg });
    if (this._state.log.length > 300) {
      this._state.log = this._state.log.slice(0, 300);
    }
    this._state.uptime = Math.floor((Date.now() - this.startedAt) / 1000);
    this.emit('update', this.getState());
  }

  getState(): LiveState {
    return { ...this._state, log: this._state.log.slice() };
  }
}

export const StateService = new StateServiceSingleton();
