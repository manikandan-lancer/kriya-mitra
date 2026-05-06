export type WaIncomingMessage = {
  from: string; // farmer phone (wa_id)
  id: string;   // wamid....
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'interactive' | 'location' | 'button' | string;
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256?: string; caption?: string };
  audio?: { id: string; mime_type: string };
  location?: { latitude: number; longitude: number };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  button?: { text: string; payload?: string };
  context?: { from: string; id: string };
};

export type WaContact = {
  profile: { name: string };
  wa_id: string;
};

export type WaWebhookPayload = {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        messaging_product: 'whatsapp';
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: WaContact[];
        messages?: WaIncomingMessage[];
        statuses?: unknown[];
      };
    }>;
  }>;
};

export type ParsedInbound = {
  waId: string;
  profileName?: string;
  message: WaIncomingMessage;
};
