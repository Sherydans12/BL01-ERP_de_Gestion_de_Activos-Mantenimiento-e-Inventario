import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

type FleetStateMessage = {
  type: 'equipment-updated';
  equipmentId: string;
  sourceId: string;
  at: number;
};

const CHANNEL_NAME = 'tpm-fleet-state-v1';
const STORAGE_KEY = 'tpm_fleet_state_event';

@Injectable({ providedIn: 'root' })
export class FleetStateService {
  readonly equipmentUpdated$ = new Subject<string>();

  private readonly sourceId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private readonly channel: BroadcastChannel | null = this.openChannel();
  private readonly seenRemoteEvents = new Set<string>();

  constructor() {
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<FleetStateMessage>) => {
        this.consumeRemote(event.data);
      };
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY || !event.newValue) return;
        try {
          this.consumeRemote(JSON.parse(event.newValue) as FleetStateMessage);
        } catch {
          /* ignore malformed cross-tab payloads */
        }
      });
    }
  }

  notify(equipmentId: string): void {
    const id = equipmentId.trim();
    if (!id) return;

    this.equipmentUpdated$.next(id);
    const message: FleetStateMessage = {
      type: 'equipment-updated',
      equipmentId: id,
      sourceId: this.sourceId,
      at: Date.now(),
    };

    this.channel?.postMessage(message);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
    } catch {
      /* localStorage may be unavailable in tests or restricted contexts */
    }
  }

  private consumeRemote(message: FleetStateMessage | null | undefined): void {
    if (
      !message ||
      message.type !== 'equipment-updated' ||
      message.sourceId === this.sourceId ||
      !message.equipmentId
    ) {
      return;
    }
    const key = `${message.sourceId}:${message.at}:${message.equipmentId}`;
    if (this.seenRemoteEvents.has(key)) return;
    this.seenRemoteEvents.add(key);
    if (this.seenRemoteEvents.size > 100) {
      this.seenRemoteEvents.clear();
    }
    this.equipmentUpdated$.next(message.equipmentId);
  }

  private openChannel(): BroadcastChannel | null {
    try {
      return typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(CHANNEL_NAME)
        : null;
    } catch {
      return null;
    }
  }
}
