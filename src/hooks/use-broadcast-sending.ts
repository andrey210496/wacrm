'use client';

import { useState } from 'react';
import { useUnitScope } from '@/components/units/unit-scope-provider';
import type {
  AudienceConfig,
  CustomFieldFilter,
  CustomFieldOperator,
  VariableMapping,
} from '@/lib/whatsapp/broadcast-audience';
import type { MessageTemplate } from '@/types';

// Re-exported so existing imports of these types from this module keep
// working; the actual definitions now live server-side in
// broadcast-audience.ts (ported there in the onda 3 server-side migration).
export type { AudienceConfig, CustomFieldFilter, CustomFieldOperator, VariableMapping };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /**
   * Media URL for an IMAGE/VIDEO/DOCUMENT header. Required at send
   * time for media-header templates — Meta rejects the send without
   * it.
   */
  headerMediaUrl?: string;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Thin client for the broadcast wizard (onda 3 — server-side dispatch,
 * issue #472). The audience resolution, CSV upsert, variable resolution,
 * recipient batching and send loop that used to run here — tied to a
 * browser tab that could be closed mid-send — now run server-side behind
 * POST /api/whatsapp/broadcasts/dispatch, which creates the broadcast +
 * pending recipients and kicks off the first delivery pass; the /drain
 * cron finishes the rest and auto-recovers stuck campaigns.
 *
 * This hook now only builds the request payload, POSTs it, and returns
 * the new broadcast id so the wizard can redirect to the detail page.
 */
export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { selectedUnitId } = useUnitScope();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);
    try {
      const res = await fetch('/api/whatsapp/broadcasts/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          template: {
            name: payload.template.name,
            language: payload.template.language ?? 'en_US',
            header_type: payload.template.header_type,
          },
          variables: payload.variables,
          audience: payload.audience,
          headerMediaUrl: payload.headerMediaUrl,
          selectedUnitId: selectedUnitId ?? undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch broadcast');
      }

      setProgress(100);
      return data.broadcast_id as string;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
