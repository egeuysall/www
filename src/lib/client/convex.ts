import { ConvexReactClient } from "convex/react";

const clients = new Map<string, ConvexReactClient>();

export function getConvexClient(url: string): ConvexReactClient {
  const existing = clients.get(url);
  if (existing) return existing;
  const client = new ConvexReactClient(url);
  clients.set(url, client);
  return client;
}
