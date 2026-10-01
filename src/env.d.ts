/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PAYMENT_SECRET?: string;
  readonly VITE_TWILIO_ACCOUNT_SID?: string;
  readonly VITE_TWILIO_AUTH_TOKEN?: string;
  readonly VITE_TWILIO_PHONE_NUMBER?: string;
  readonly VITE_TWILIO_WHATSAPP_NUMBER?: string;
  readonly VITE_SMS_GATEWAY_URL?: string;
  readonly VITE_WHATSAPP_GATEWAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
