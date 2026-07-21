import { logger } from '../logging/logger';

export interface IPDetails {
  ip: string;
  status: string;
  country: string;
  city: string;
  isp: string;
  hosting: boolean;
  proxy: boolean;
  vpn: boolean;
}

export class ReputationService {
  private static CACHE = new Map<string, { data: IPDetails; cachedAt: number }>();

  // Cache TTL: proxy bersih di-cache lebih lama (reputasi stabil),
  // proxy burnt lebih singkat (mungkin dilepas dari datacenter/VPN pool).
  private static TTL_CLEAN_MS  = 60 * 60 * 1000;  // 1 jam untuk IP bersih
  private static TTL_BURNT_MS  = 15 * 60 * 1000;  // 15 menit untuk IP burnt

  /**
   * Checks the reputation of an IP address using ip-api.com
   * Note: Free tier has a 45 req/min limit.
   */
  public static async checkIP(proxyServer?: string): Promise<IPDetails | null> {
    const cacheKey = proxyServer || 'direct';
    const cached = this.CACHE.get(cacheKey);
    if (cached) {
      const isBurnt = cached.data.hosting || cached.data.proxy || cached.data.vpn;
      const ttl = isBurnt ? this.TTL_BURNT_MS : this.TTL_CLEAN_MS;
      if (Date.now() - cached.cachedAt < ttl) {
        return cached.data;
      }
      // TTL expired — hapus dan fetch ulang
      this.CACHE.delete(cacheKey);
    }

    try {
      // Jika ada proxy, ekstrak host-nya dan cek reputasi IP tersebut secara langsung.
      // Kalau langsung fetch tanpa path IP, ip-api.com akan mengembalikan IP server sendiri (bukan IP proxy).
      const proxyHost = proxyServer ? proxyServer.split(':')[0] : null;
      const apiPath = proxyHost
        ? `http://ip-api.com/json/${proxyHost}?fields=status,message,country,city,isp,query,hosting,proxy,vpn`
        : 'http://ip-api.com/json/?fields=status,message,country,city,isp,query,hosting,proxy,vpn';

      const response = await fetch(apiPath);
      
      if (!response.ok) {
        throw new Error(`IP Check failed: ${response.statusText}`);
      }

      const data = await response.json() as any;

      if (data.status === 'fail') {
        logger.warn('IP Reputation check failed', { message: data.message });
        return null;
      }

      const details: IPDetails = {
        ip: data.query,
        status: data.status,
        country: data.country,
        city: data.city,
        isp: data.isp,
        hosting: data.hosting || false,
        proxy: data.proxy || false,
        vpn: data.vpn || false,
      };

      this.CACHE.set(cacheKey, { data: details, cachedAt: Date.now() });
      
      const isBurnt = details.hosting || details.proxy || details.vpn;
      if (isBurnt) {
        logger.warn('Proxy Reputation Alert: IP looks suspicious/burnt', { 
           ip: details.ip, 
           hosting: details.hosting, 
           proxy: details.proxy, 
           vpn: details.vpn 
        });
      } else {
        logger.info('Proxy Reputation Clean', { ip: details.ip, isp: details.isp });
      }

      return details;

    } catch (error) {
      logger.error('Failed to perform IP reputation check', { error });
      return null;
    }
  }
}
