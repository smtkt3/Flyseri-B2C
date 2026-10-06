CREATE TABLE public.visa_assistance_fee_settings (
 id varchar(32) PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
 amount numeric(18,2) NOT NULL CHECK (amount > 0 AND amount <= 9999999),
 currency varchar(3) NOT NULL CHECK (currency IN ('MYR','USD','SGD','EUR','GBP','AUD')),
 basis varchar(16) NOT NULL CHECK (basis IN ('APPLICATION','APPLICANT')),
 active boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.visa_assistance_fee_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.visa_assistance_fee_settings TO flyseri_api;
