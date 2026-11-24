/** Bağlantı adresini (IP) okuyabilen en küçük sunucu arayüzü (Bun sunucusu bunu karşılar). */
export interface IpResolver {
  requestIP(request: Request): { address: string } | null;
}

/**
 * Çalışan Bun sunucusu için paylaşılan referans. index.ts, listen() sonrası burayı doldurur.
 * Elysia'nın hook bağlamındaki `server` her istekte dolu gelmediği için IP buradan okunur.
 */
export const serverRef: { current: IpResolver | null } = { current: null };