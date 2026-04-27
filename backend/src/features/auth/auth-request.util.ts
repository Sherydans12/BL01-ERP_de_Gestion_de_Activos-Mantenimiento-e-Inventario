import type { Request } from 'express';

export type LoginRequestMeta = {
  clientIp: string;
  userAgent: string;
};

/** IP del cliente (proxy-aware). */
export function extractClientIp(req: Request): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  if (Array.isArray(xf) && xf[0]) {
    return xf[0].split(',')[0].trim();
  }
  const ip = req.ip || req.socket?.remoteAddress;
  return typeof ip === 'string' && ip ? ip : '';
}

export function extractUserAgent(req: Request): string {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : '';
}

export function extractLoginMeta(req: Request): LoginRequestMeta {
  return {
    clientIp: extractClientIp(req),
    userAgent: extractUserAgent(req),
  };
}
