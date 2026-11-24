/** Bağlantının IP adresini, Bun'ın fetch kancasında isteğe iliştirir; hook'lar buradan okur. */
const addresses = new WeakMap<Request, string>();

export const setSocketIp = (request: Request, address: string): void => void addresses.set(request, address);
export const getSocketIp = (request: Request): string | undefined => addresses.get(request);